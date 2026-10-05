'use strict';
/*
 * Distribution publique des releases de l'app de bureau (Tauri), alors que le dépôt
 * GitHub est privé : les assets d'une release privée ne sont pas téléchargeables sans
 * authentification, donc l'updater natif (requête HTTP brute, sans session Supabase)
 * ne peut pas taper directement sur github.com. Ce proxy authentifie côté serveur avec
 * GITHUB_TOKEN (lecture seule, scope contents:read sur BixSopy/watchlist) et republie :
 *  - GET /api/releases?f=manifest  -> latest.json réécrit (urls pointées vers ce proxy)
 *  - GET /api/releases?f=asset&id= -> binaire de l'asset (uniquement ceux de la dernière
 *    release, l'id est vérifié contre sa liste d'assets à chaque appel)
 * Aucune clé ni token ne sort jamais de la fonction. Pas de session requise (public).
 */
const { fail, makeCache } = require('./_lib/common');

const REPO = 'BixSopy/watchlist';
const GH_API = 'https://api.github.com/repos/' + REPO;
const cache = makeCache(10);

const buckets = new Map();
const RATE_PER_MIN = 60;
function rateLimited(ip) {
  const now = Date.now();
  let b = buckets.get(ip);
  if (!b || now - b.start > 60000) { b = { start: now, n: 0 }; buckets.set(ip, b); }
  b.n++;
  if (buckets.size > 2000) buckets.clear();
  return b.n > RATE_PER_MIN;
}
function clientIp(req) {
  const h = req.headers && req.headers['x-forwarded-for'];
  if (typeof h === 'string' && h.length) return h.split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

async function ghFetch(url, accept) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return { error: 'server_config' };
  let r;
  try {
    r = await fetch(url, {
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: accept || 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'watchlist-releases-proxy',
      },
    });
  } catch (e) {
    return { error: 'unreachable' };
  }
  return { response: r };
}

async function latestRelease() {
  const hit = cache.get('latest');
  if (hit) return hit;
  const r = await ghFetch(GH_API + '/releases/latest');
  if (r.error) return { error: r.error };
  if (!r.response.ok) return { error: 'upstream_' + r.response.status };
  let data;
  try { data = await r.response.json(); } catch (e) { return { error: 'bad_json' }; }
  cache.set('latest', data, 2 * 60 * 1000);
  return data;
}

/* tauri-action émet des URLs d'asset au format API GitHub
   (.../repos/OWNER/REPO/releases/assets/<id>), pas le format "download/TAG/<filename>"
   qu'on pourrait attendre — on extrait donc l'id numérique directement, jamais le nom
   de fichier (qui n'apparaît pas dans cette forme d'URL). */
function platformsAssetIds(manifest) {
  const out = [];
  const platforms = manifest && manifest.platforms;
  if (!platforms) return out;
  for (const key of Object.keys(platforms)) {
    const u = platforms[key] && platforms[key].url;
    const m = typeof u === 'string' && u.match(/\/releases\/assets\/(\d+)(?:[/?].*)?$/);
    if (m) out.push({ key, id: Number(m[1]) });
  }
  return out;
}

async function handleManifest(req, res) {
  const rel = await latestRelease();
  if (rel.error) return fail(res, rel.error === 'server_config' ? 500 : 502, rel.error, 'Releases indisponibles');
  const assets = rel.assets || [];
  const manifestAsset = assets.find((a) => a.name === 'latest.json');
  if (!manifestAsset) return fail(res, 404, 'no_manifest', 'Aucune release publiée');

  const r = await ghFetch(manifestAsset.url, 'application/octet-stream');
  if (r.error) return fail(res, 502, r.error, 'Manifeste injoignable');
  if (!r.response.ok) return fail(res, 502, 'upstream_' + r.response.status, 'Manifeste injoignable');
  let manifest;
  try { manifest = await r.response.json(); } catch (e) { return fail(res, 502, 'bad_manifest', 'Manifeste illisible'); }

  const host = 'https://' + (req.headers.host || 'watchlist-omega-three.vercel.app');
  for (const { key, id } of platformsAssetIds(manifest)) {
    const asset = assets.find((a) => a.id === id);
    if (asset) manifest.platforms[key].url = host + '/api/releases?f=asset&id=' + asset.id;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=120');
  res.end(JSON.stringify(manifest));
}

async function handleAsset(req, res, idParam) {
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) return fail(res, 400, 'bad_id', 'Identifiant invalide');

  const rel = await latestRelease();
  if (rel.error) return fail(res, rel.error === 'server_config' ? 500 : 502, rel.error, 'Releases indisponibles');
  const asset = (rel.assets || []).find((a) => a.id === id);
  if (!asset) return fail(res, 404, 'not_found', "Cet asset n'appartient pas à la dernière release");

  const r = await ghFetch(asset.url, 'application/octet-stream');
  if (r.error) return fail(res, 502, r.error, 'Téléchargement injoignable');
  if (!r.response.ok) return fail(res, 502, 'upstream_' + r.response.status, 'Téléchargement impossible');

  res.statusCode = 200;
  res.setHeader('Content-Type', asset.content_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', 'attachment; filename="' + asset.name.replace(/"/g, '') + '"');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  const buf = Buffer.from(await r.response.arrayBuffer());
  res.end(buf);
}

async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return fail(res, 405, 'method_not_allowed', 'GET uniquement'); }
  if (rateLimited(clientIp(req))) return fail(res, 429, 'rate_limited', 'Trop de requêtes');

  const params = new URL(req.url || '/', 'http://localhost').searchParams;
  const f = params.get('f');
  if (f === 'manifest') return handleManifest(req, res);
  if (f === 'asset') return handleAsset(req, res, params.get('id'));
  return fail(res, 400, 'bad_request', "Paramètre 'f' manquant ou invalide");
}

module.exports = handler;
module.exports._cache = cache;
module.exports._buckets = buckets;
