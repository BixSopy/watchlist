'use strict';
/*
 * Proxy TMDB authentifié : GET /api/tmdb?path=/movie/603&language=fr-FR
 * - clé lue dans TMDB_API_KEY (clé v3, ou jeton de lecture v4 « eyJ... ») ;
 * - seuls les chemins et paramètres utilisés par l'app sont acceptés (pas de proxy ouvert) ;
 * - session Supabase d'un compte confirmé obligatoire (voir _lib/common.js) ;
 * - quota quotidien par compte (bucket « tmdb », chaque requête compte, cache compris :
 *   c'est le nombre d'appels au proxy qu'on limite, pas seulement les appels à TMDB) ;
 * - cache mémoire partagé entre utilisateurs (données TMDB publiques), borné à ~40 Mo.
 *
 * Extension navigateur (import de l'historique Netflix) : sans session Supabase, elle envoie le
 * jeton de suivi dans l'en-tête X-Cinepisode-Token. Seuls la recherche (film/série) et les fiches
 * film/série/saison sont alors accessibles ; même quota quotidien que le site, compté sur le
 * compte du propriétaire du jeton (RPC consume_api_quota_by_token, sans mode dégradé).
 */
const { send, fail, failQuota, makeCache, guard, queryParams, consumeQuota, timeoutSignal, UPSTREAM_TIMEOUT_MS,
  bearerToken, extensionToken, guardExtension } = require('./_lib/common');

const TMDB_BASE = 'https://api.themoviedb.org/3';

/* Chemins autorisés, avec la durée de cache associée (secondes) */
const ROUTES = [
  { re: /^\/(movie|tv)\/\d{1,9}$/, ttl: 6 * 3600 },
  { re: /^\/(movie|tv)\/\d{1,9}\/(videos|recommendations|similar|watch\/providers)$/, ttl: 6 * 3600 },
  { re: /^\/tv\/\d{1,9}\/season\/\d{1,4}(\/videos)?$/, ttl: 6 * 3600 },
  { re: /^\/collection\/\d{1,9}$/, ttl: 24 * 3600 },
  { re: /^\/search\/(multi|movie|tv)$/, ttl: 15 * 60 },
  { re: /^\/trending\/(all|movie|tv)\/(day|week)$/, ttl: 3600 },
  { re: /^\/discover\/(movie|tv)$/, ttl: 3600 },
];

/* Chemins accessibles avec le jeton de l'extension (sous-ensemble de ROUTES) */
const EXTENSION_ROUTES = [
  /^\/search\/(movie|tv)$/,
  /^\/(movie|tv)\/\d{1,9}$/,
  /^\/tv\/\d{1,9}\/season\/\d{1,4}$/,
];

/* Paramètres autorisés et leur format */
const PARAMS = {
  /* Langue de l'interface (fr-FR, en-US…) : fait partie de la clé de cache, comme tous les paramètres */
  language: /^[a-z]{2}(-[A-Z]{2})?$/,
  region: /^[A-Z]{2}$/,
  watch_region: /^[A-Z]{2}$/,
  page: /^([1-9]\d{0,2})$/,
  query: /^[\s\S]{1,200}$/,
  include_adult: /^(true|false)$/,
  append_to_response: /^(credits|images|keywords|watch\/providers|external_ids)(,(credits|images|keywords|watch\/providers|external_ids)){0,4}$/,
  sort_by: /^(popularity|vote_average|vote_count|primary_release_date|first_air_date)\.(asc|desc)$/,
  'vote_count.gte': /^\d{1,6}$/,
  'vote_average.gte': /^\d{1,2}(\.\d)?$/,
  with_genres: /^\d{1,6}([,|]\d{1,6}){0,9}$/,
  without_genres: /^\d{1,6}([,|]\d{1,6}){0,9}$/,
  with_keywords: /^\d{1,7}([,|]\d{1,7}){0,9}$/,
  with_origin_country: /^[A-Z]{2}$/,
  'primary_release_date.gte': /^\d{4}-\d{2}-\d{2}$/,
  'first_air_date.gte': /^\d{4}-\d{2}-\d{2}$/,
  year: /^(18|19|20)\d{2}$/,
  first_air_date_year: /^(18|19|20)\d{2}$/,
};

const cache = makeCache(3000, 40 * 1024 * 1024);

function buildUpstream(params) {
  const path = params.get('path') || '';
  if (path.length > 120) return { error: 'path' };
  const route = ROUTES.find((r) => r.re.test(path));
  if (!route) return { error: 'path' };
  const out = new URLSearchParams();
  for (const [k, v] of params.entries()) {
    if (k === 'path') continue;
    const re = PARAMS[k];
    if (!re) continue; /* paramètre inconnu : ignoré, jamais transmis */
    if (!re.test(v)) return { error: 'param', name: k };
    out.set(k, v);
  }
  if (out.has('page') && Number(out.get('page')) > 500) return { error: 'param', name: 'page' };
  out.sort();
  return { path, query: out.toString(), ttl: route.ttl };
}

async function handler(req, res) {
  /* Extension : jeton de suivi, seulement si aucune session n'est envoyée */
  const extToken = !bearerToken(req) ? extensionToken(req) : null;
  let auth = null;
  if (!extToken) {
    auth = await guard(req, res);
    if (!auth) return;
  }

  const key = process.env.TMDB_API_KEY;
  if (!key) return fail(res, 500, 'server_config', 'Configuration serveur incomplète');

  const up = buildUpstream(queryParams(req));
  if (up.error === 'path') return fail(res, 400, 'path_not_allowed', 'Chemin non autorisé');
  if (up.error === 'param') return fail(res, 400, 'bad_param', 'Paramètre invalide : ' + up.name);

  if (extToken) {
    if (req.method === 'GET' && !EXTENSION_ROUTES.some((re) => re.test(up.path))) return fail(res, 400, 'path_not_allowed', 'Chemin non autorisé');
    if (!(await guardExtension(req, res, extToken, 'tmdb'))) return;
    res.wlVaryToken = true;
  } else {
    const q = await consumeQuota(auth, 'tmdb', 1);
    if (!q.allowed) return failQuota(res, q, 'du catalogue');
  }

  const cacheKey = up.path + '?' + up.query;
  const browserCache = 'private, max-age=' + Math.min(up.ttl, 3600);
  const hit = cache.get(cacheKey);
  if (hit) return send(res, 200, hit, browserCache);

  const isBearer = /^eyJ/.test(key);
  const url = TMDB_BASE + up.path + '?' + up.query + (isBearer ? '' : (up.query ? '&' : '') + 'api_key=' + encodeURIComponent(key));
  let r;
  try {
    r = await fetch(url, {
      headers: isBearer ? { Authorization: 'Bearer ' + key, accept: 'application/json' } : { accept: 'application/json' },
      signal: timeoutSignal(UPSTREAM_TIMEOUT_MS),
    });
  } catch (e) {
    return fail(res, 502, 'upstream_unreachable', 'TMDB injoignable');
  }
  if (r.status === 404) return fail(res, 404, 'not_found', 'Introuvable');
  if (r.status === 429) return fail(res, 503, 'upstream_rate_limited', 'TMDB limite les requêtes, réessaie dans un instant', 10);
  if (!r.ok) return fail(res, 502, 'upstream_error', 'Erreur TMDB (' + r.status + ')');

  let text;
  try { text = await r.text(); JSON.parse(text); } catch (e) { return fail(res, 502, 'upstream_error', 'Réponse TMDB illisible'); }
  cache.set(cacheKey, text, up.ttl * 1000);
  return send(res, 200, text, browserCache);
}

module.exports = handler;
module.exports._buildUpstream = buildUpstream;
module.exports._cache = cache;
