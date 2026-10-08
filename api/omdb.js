'use strict';
/*
 * Proxy OMDb authentifié : GET /api/omdb?i=tt0133093
 * - clé lue dans OMDB_API_KEY ; seul le paramètre « i » (identifiant IMDb) est accepté ;
 * - session Supabase d'un compte confirmé obligatoire (voir _lib/common.js).
 *
 * La clé OMDb gratuite est limitée à 1 000 requêtes/jour POUR TOUT LE MONDE. D'où :
 *  1. cache mémoire (instance) puis cache partagé Supabase (table api_cache, 30 jours ;
 *     7 jours pour « introuvable ») — si SUPABASE_SECRET_KEY est configurée ;
 *  2. quota « omdb » compté uniquement sur les vrais appels à OMDb : par compte et global
 *     (900/jour par défaut, réglable dans public.api_quota_limits) ;
 *  3. disjoncteur : si OMDb répond « Request limit reached », plus aucun appel pendant
 *     1 h ; si le quota global est atteint, plus aucun appel jusqu'à minuit UTC.
 * Quand OMDb est indisponible, la réponse est un 503 « omdb_unavailable » : l'app
 * masque simplement les notes IMDb/Rotten Tomatoes/Metacritic, rien d'autre ne casse.
 */
const {
  send, fail, makeCache, guard, queryParams, consumeQuota, sharedCacheGet, sharedCachePut,
  secondsUntilUtcMidnight, timeoutSignal, UPSTREAM_TIMEOUT_MS,
} = require('./_lib/common');

const OMDB_BASE = 'https://www.omdbapi.com/';
const TTL_FOUND_S = 30 * 24 * 3600;
const TTL_NOT_FOUND_S = 7 * 24 * 3600;
const BROWSER_CACHE = 'private, max-age=86400';
const cache = makeCache(5000, 5 * 1024 * 1024);
const breaker = { until: 0 };

function unavailable(res, retryAfterS) {
  return fail(res, 503, 'omdb_unavailable', 'Notes IMDb / Rotten Tomatoes momentanément indisponibles', retryAfterS);
}

async function handler(req, res) {
  const auth = await guard(req, res);
  if (!auth) return;

  const key = process.env.OMDB_API_KEY;
  if (!key) return fail(res, 500, 'server_config', 'Configuration serveur incomplète');

  const params = queryParams(req);
  const imdbId = params.get('i') || '';
  if (!/^tt\d{5,10}$/.test(imdbId)) return fail(res, 400, 'bad_param', 'Paramètre invalide : i');

  const hit = cache.get(imdbId);
  if (hit) return send(res, 200, hit, BROWSER_CACHE);

  const shared = await sharedCacheGet('omdb:' + imdbId);
  if (shared && typeof shared === 'object') {
    const text = JSON.stringify(shared);
    cache.set(imdbId, text, 6 * 3600 * 1000);
    return send(res, 200, text, BROWSER_CACHE);
  }

  if (Date.now() < breaker.until) return unavailable(res, (breaker.until - Date.now()) / 1000);

  const q = await consumeQuota(auth, 'omdb', 1);
  if (!q.allowed) {
    if (q.scope === 'global') breaker.until = Date.now() + secondsUntilUtcMidnight() * 1000;
    return unavailable(res, q.retryAfter);
  }

  let r;
  try {
    r = await fetch(OMDB_BASE + '?i=' + encodeURIComponent(imdbId) + '&apikey=' + encodeURIComponent(key), {
      signal: timeoutSignal(UPSTREAM_TIMEOUT_MS),
    });
  } catch (e) {
    return fail(res, 502, 'upstream_unreachable', 'OMDb injoignable');
  }
  if (r.status === 401 || r.status === 429) {
    /* OMDb répond 401 « Request limit reached! » quand le quota du jour est épuisé */
    let body = null;
    try { body = await r.json(); } catch (e) { /* ignoré */ }
    if (body && /limit/i.test(String(body.Error || ''))) { breaker.until = Date.now() + 3600 * 1000; return unavailable(res, 3600); }
    return fail(res, 502, 'upstream_error', 'OMDb indisponible (clé ou quota)');
  }
  if (!r.ok) return fail(res, 502, 'upstream_error', 'Erreur OMDb (' + r.status + ')');
  let data;
  try { data = await r.json(); } catch (e) { return fail(res, 502, 'upstream_error', 'Réponse OMDb illisible'); }
  /* OMDb peut aussi renvoyer 200 pour une clé invalide ou un quota dépassé : ni relayé ni mis en cache */
  if (data && data.Response === 'False' && /limit/i.test(String(data.Error || ''))) {
    breaker.until = Date.now() + 3600 * 1000;
    return unavailable(res, 3600);
  }
  if (data && data.Response === 'False' && /key/i.test(String(data.Error || ''))) {
    return fail(res, 502, 'upstream_error', 'OMDb indisponible (clé ou quota)');
  }
  /* On ne renvoie (et ne stocke) que les champs utiles à l'app */
  const found = !!(data && data.Response === 'True');
  const obj = {
    Response: found ? 'True' : 'False',
    Error: found ? undefined : String((data && data.Error) || 'Not found').slice(0, 120),
    imdbID: found ? String(data.imdbID || imdbId) : undefined,
    Ratings: found && Array.isArray(data.Ratings)
      ? data.Ratings.slice(0, 10).map((x) => ({ Source: String(x.Source || '').slice(0, 60), Value: String(x.Value || '').slice(0, 20) }))
      : [],
  };
  const out = JSON.stringify(obj);
  const ttl = found ? TTL_FOUND_S : TTL_NOT_FOUND_S;
  cache.set(imdbId, out, Math.min(ttl, 24 * 3600) * 1000);
  await sharedCachePut('omdb:' + imdbId, obj, ttl);
  return send(res, 200, out, BROWSER_CACHE);
}

module.exports = handler;
module.exports._cache = cache;
module.exports._breaker = breaker;
