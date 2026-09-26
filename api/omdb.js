'use strict';
/*
 * Proxy OMDb authentifié : GET /api/omdb?i=tt0133093
 * - clé lue dans OMDB_API_KEY ; seul le paramètre « i » (identifiant IMDb) est accepté ;
 * - session Supabase obligatoire (voir _lib/common.js).
 */
const { send, fail, makeCache, guard, queryParams } = require('./_lib/common');

const OMDB_BASE = 'https://www.omdbapi.com/';
const TTL_S = 24 * 3600;
const cache = makeCache(400);

async function handler(req, res) {
  const auth = await guard(req, res);
  if (!auth) return;

  const key = process.env.OMDB_API_KEY;
  if (!key) return fail(res, 500, 'server_config', 'Configuration serveur incomplète');

  const params = queryParams(req);
  const imdbId = params.get('i') || '';
  if (!/^tt\d{5,10}$/.test(imdbId)) return fail(res, 400, 'bad_param', 'Paramètre invalide : i');

  const hit = cache.get(imdbId);
  if (hit) return send(res, 200, hit, 'private, max-age=3600');

  let r;
  try {
    r = await fetch(OMDB_BASE + '?i=' + encodeURIComponent(imdbId) + '&apikey=' + encodeURIComponent(key));
  } catch (e) {
    return fail(res, 502, 'upstream_unreachable', 'OMDb injoignable');
  }
  if (!r.ok) return fail(res, 502, 'upstream_error', 'Erreur OMDb (' + r.status + ')');
  let data;
  try { data = await r.json(); } catch (e) { return fail(res, 502, 'upstream_error', 'Réponse OMDb illisible'); }
  /* OMDb renvoie 200 même pour une clé invalide ou un quota dépassé : on ne relaie ni ne cache */
  if (data && data.Response === 'False' && /key|limit/i.test(String(data.Error || ''))) {
    return fail(res, 502, 'upstream_error', 'OMDb indisponible (clé ou quota)');
  }
  /* On ne renvoie que les champs utiles à l'app */
  const out = JSON.stringify({
    Response: data && data.Response,
    Error: data && data.Response === 'False' ? String(data.Error || '') : undefined,
    imdbID: data && data.imdbID,
    Ratings: Array.isArray(data && data.Ratings) ? data.Ratings.map((x) => ({ Source: String(x.Source || ''), Value: String(x.Value || '') })) : [],
  });
  cache.set(imdbId, out, TTL_S * 1000);
  return send(res, 200, out, 'private, max-age=3600');
}

module.exports = handler;
module.exports._cache = cache;
