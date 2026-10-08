'use strict';
/*
 * Tests des fonctions /api avec un fetch simulé (aucun appel réseau réel).
 * Lancer : node --test tests/
 */
const test = require('node:test');
const assert = require('node:assert');

const FAKE_TMDB = 'faketmdbkey_0123456789abcdef';
const FAKE_OMDB = 'fakeomdbkey';
const FAKE_ANON = 'sb_publishable_fake_anon';
const FAKE_SECRET = 'sb_secret_fake_service_key_0123';
const GOOD = 'aaaa.bbbb.good';
const OTHER = 'aaaa.bbbb.other';
const UNCONF = 'aaaa.bbbb.unconfirmed';
const ANONU = 'aaaa.bbbb.anonymous';

process.env.TMDB_API_KEY = FAKE_TMDB;
process.env.OMDB_API_KEY = FAKE_OMDB;
process.env.SUPABASE_ANON_KEY = FAKE_ANON;
process.env.SUPABASE_URL = 'https://example.supabase.co';

const FAKE_GH_TOKEN = 'fakeghtoken_0123456789';
const FAKE_RELEASE = {
  assets: [
    { id: 111, name: 'latest.json', url: 'https://api.github.com/repos/BixSopy/watchlist/releases/assets/111', content_type: 'application/json' },
    { id: 222, name: 'Watchlist_1.0.0_x64-setup.exe', url: 'https://api.github.com/repos/BixSopy/watchlist/releases/assets/222', content_type: 'application/octet-stream' },
  ],
};
const FAKE_MANIFEST = { version: '1.0.0', platforms: { 'windows-x86_64': { signature: 'sig', url: 'https://api.github.com/repos/BixSopy/watchlist/releases/assets/222' } } };

/* ---- Faux Supabase : Auth, RPC consume_api_quota, table api_cache ---- */
const USERS = {
  [GOOD]: { id: 'u1', email: 'Moi@Example.com', email_confirmed_at: '2026-09-18T10:20:55Z' },
  [OTHER]: { id: 'u2', email: 'autre@example.com', confirmed_at: '2026-10-01T00:00:00Z' },
  [UNCONF]: { id: 'u3', email: 'pas.confirme@example.com', email_confirmed_at: null },
  [ANONU]: { id: 'u4', email: '', is_anonymous: true },
};
let fakeDb;
function resetDb() {
  fakeDb = { limits: { tmdb: { user: 4000 }, omdb: { user: 150, global: 900 } }, usage: {}, global: {}, cache: {}, rpcMode: 'ok' };
}
function rpcQuota(opts) {
  const h = opts.headers || {};
  if (fakeDb.rpcMode === 'missing') return resp(404, { code: 'PGRST202', message: 'Could not find the function' });
  if (fakeDb.rpcMode === 'down') throw new Error('ECONNRESET');
  if (fakeDb.rpcMode === 'error') return resp(500, { message: 'boom' });
  if (h.apikey !== FAKE_ANON) return resp(401, {});
  const tok = String(h.Authorization || '').replace(/^Bearer /, '');
  const user = USERS[tok];
  if (!user) return resp(401, {});
  const { p_bucket, p_cost } = JSON.parse(opts.body);
  const lim = fakeDb.limits[p_bucket];
  const k = user.id + ':' + p_bucket;
  const cur = fakeDb.usage[k] || 0;
  if (cur >= lim.user) return resp(200, { allowed: false, scope: 'user', limit: lim.user });
  fakeDb.usage[k] = cur + p_cost;
  if (lim.global) {
    const g = fakeDb.global[p_bucket] || 0;
    if (g >= lim.global) return resp(200, { allowed: false, scope: 'global', limit: lim.global });
    fakeDb.global[p_bucket] = g + p_cost;
  }
  return resp(200, { allowed: true, used: fakeDb.usage[k], limit: lim.user });
}
function apiCache(u, opts) {
  const h = opts.headers || {};
  if (h.apikey !== FAKE_SECRET) return resp(401, { message: 'service key required' });
  if ((opts.method || 'GET') === 'GET') {
    const key = decodeURIComponent(new URL(u).searchParams.get('key').replace(/^eq\./, ''));
    const row = fakeDb.cache[key];
    return resp(200, row && new Date(row.expires_at) > new Date() ? [{ body: row.body }] : []);
  }
  const row = JSON.parse(opts.body);
  fakeDb.cache[row.key] = row;
  return resp(201, '');
}

const calls = [];
let upstream = { status: 200, body: { id: 603, title: 'Matrix' } };
global.fetch = async (url, opts) => {
  opts = opts || {};
  calls.push({ url: String(url), opts: opts });
  const u = String(url);
  if (u.startsWith('https://example.supabase.co/auth/v1/user')) {
    const h = opts.headers || {};
    if (h.apikey !== FAKE_ANON) return resp(401, { msg: 'no apikey' });
    const user = USERS[String(h.Authorization || '').replace(/^Bearer /, '')];
    return user ? resp(200, user) : resp(401, { msg: 'bad jwt' });
  }
  if (u === 'https://example.supabase.co/rest/v1/rpc/consume_api_quota') return rpcQuota(opts);
  if (u.startsWith('https://example.supabase.co/rest/v1/api_cache')) return apiCache(u, opts);
  if (u === 'https://api.github.com/repos/BixSopy/watchlist/releases/latest') {
    const h = opts.headers || {};
    if (h.Authorization !== 'Bearer ' + FAKE_GH_TOKEN) return resp(401, { message: 'Bad credentials' });
    return resp(200, FAKE_RELEASE);
  }
  if (u === 'https://api.github.com/repos/BixSopy/watchlist/releases/assets/111') return resp(200, FAKE_MANIFEST);
  if (u === 'https://api.github.com/repos/BixSopy/watchlist/releases/assets/222') {
    return { status: 200, ok: true, arrayBuffer: async () => Buffer.from('binaire-factice') };
  }
  return resp(upstream.status, upstream.body);
};
function resp(status, body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return { status, ok: status >= 200 && status < 300, text: async () => text, json: async () => JSON.parse(text), arrayBuffer: async () => Buffer.from(text) };
}

const tmdb = require('../api/tmdb');
const omdb = require('../api/omdb');
const releases = require('../api/releases');
const common = require('../api/_lib/common');
const config = require('../api/config');

function call(handler, { method = 'GET', url, token } = {}) {
  return new Promise((resolve) => {
    const headers = {};
    if (token) headers.authorization = 'Bearer ' + token;
    const req = { method, url, headers };
    const out = { headers: {}, statusCode: 200 };
    const res = {
      set statusCode(v) { out.statusCode = v; }, get statusCode() { return out.statusCode; },
      setHeader(k, v) { out.headers[k.toLowerCase()] = String(v); },
      end(b) { out.body = b == null ? '' : String(b); resolve(out); },
    };
    handler(req, res);
  });
}
function noLeak(out) {
  const all = out.body + JSON.stringify(out.headers);
  assert.ok(!all.includes(FAKE_TMDB), 'clé TMDB dans la réponse');
  assert.ok(!all.includes(FAKE_OMDB), 'clé OMDb dans la réponse');
  assert.ok(!all.includes(FAKE_ANON), 'clé anon dans la réponse');
  assert.ok(!all.includes(FAKE_SECRET), 'clé secrète dans la réponse');
}
function reset() {
  common._authCache.clear(); tmdb._cache.clear(); omdb._cache.clear(); common._buckets.clear();
  common._quotaDenied.clear(); common._quotaState.missingUntil = 0; omdb._breaker.until = 0;
  releases._cache.clear(); releases._buckets.clear(); calls.length = 0; resetDb();
  delete process.env.ALLOWED_EMAILS; delete process.env.SUPABASE_SECRET_KEY; delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.TURNSTILE_SITE_KEY; delete process.env.SIGNUPS_OPEN;
  process.env.GITHUB_TOKEN = FAKE_GH_TOKEN; upstream = { status: 200, body: { id: 603, title: 'Matrix' } };
}
const upstreamCalls = (host) => calls.filter((c) => c.url.includes(host)).length;

test('401 sans jeton', async () => {
  reset();
  const out = await call(tmdb, { url: '/api/tmdb?path=/movie/603' });
  assert.strictEqual(out.statusCode, 401);
  assert.strictEqual(out.headers['cache-control'], 'no-store');
  assert.strictEqual(calls.length, 0);
  noLeak(out);
});

test('401 avec jeton invalide ou mal formé', async () => {
  reset();
  let out = await call(tmdb, { url: '/api/tmdb?path=/movie/603', token: 'xxx.yyy.bad' });
  assert.strictEqual(out.statusCode, 401);
  out = await call(tmdb, { url: '/api/tmdb?path=/movie/603', token: 'pas un jwt' });
  assert.strictEqual(out.statusCode, 401);
  assert.ok(!calls.some((c) => c.url.includes('themoviedb')), 'aucun appel TMDB');
  noLeak(out);
});

test('405 sur POST', async () => {
  reset();
  const out = await call(tmdb, { method: 'POST', url: '/api/tmdb?path=/movie/603', token: GOOD });
  assert.strictEqual(out.statusCode, 405);
});

test('200 avec session valide, clé ajoutée côté serveur uniquement', async () => {
  reset();
  const out = await call(tmdb, { url: '/api/tmdb?path=%2Fmovie%2F603&language=fr-FR&append_to_response=credits,watch%2Fproviders', token: GOOD });
  assert.strictEqual(out.statusCode, 200);
  assert.match(out.headers['cache-control'], /^private, max-age=\d+$/);
  assert.strictEqual(out.headers.vary, 'Authorization');
  const up = calls.find((c) => c.url.startsWith('https://api.themoviedb.org/3/movie/603?'));
  assert.ok(up, 'appel TMDB attendu');
  assert.ok(up.url.includes('api_key='), 'clé ajoutée en amont');
  assert.ok(up.url.includes('language=fr-FR'));
  noLeak(out);
});

test('paramètres inconnus ignorés, jamais transmis', async () => {
  reset();
  await call(tmdb, { url: '/api/tmdb?path=/search/multi&query=matrix&api_key=pirate&session_id=x&page=2', token: GOOD });
  const up = calls.find((c) => c.url.includes('/search/multi'));
  assert.ok(up);
  assert.ok(!up.url.includes('pirate') && !up.url.includes('session_id'));
});

test('chemins hors liste blanche refusés (400)', async () => {
  reset();
  for (const p of ['/account', '/movie/603/../../account', '/authentication/token/new', '/movie/603/account_states', '/list/1', 'https://evil.example/x', '/movie/abc', '/search/person']) {
    const out = await call(tmdb, { url: '/api/tmdb?path=' + encodeURIComponent(p), token: GOOD });
    assert.strictEqual(out.statusCode, 400, p);
    assert.strictEqual(out.headers['cache-control'], 'no-store');
  }
  assert.ok(!calls.some((c) => c.url.includes('themoviedb')), 'aucun appel TMDB');
});

test('paramètre au mauvais format refusé', async () => {
  reset();
  const out = await call(tmdb, { url: '/api/tmdb?path=/discover/movie&page=9999', token: GOOD });
  assert.strictEqual(out.statusCode, 400);
});

test('erreur amont : corps générique, no-store, pas de mise en cache', async () => {
  reset();
  upstream = { status: 401, body: { status_message: 'Invalid API key: ' + FAKE_TMDB, success: false } };
  let out = await call(tmdb, { url: '/api/tmdb?path=/movie/1', token: GOOD });
  assert.strictEqual(out.statusCode, 502);
  assert.strictEqual(out.headers['cache-control'], 'no-store');
  noLeak(out);
  upstream = { status: 200, body: { id: 1 } };
  out = await call(tmdb, { url: '/api/tmdb?path=/movie/1', token: GOOD });
  assert.strictEqual(out.statusCode, 200, "l'erreur n'a pas été mise en cache");
});

test('cache mémoire : 2e appel sans requête amont, mais session toujours vérifiée', async () => {
  reset();
  await call(tmdb, { url: '/api/tmdb?path=/trending/all/week&language=fr-FR', token: GOOD });
  const n = calls.filter((c) => c.url.includes('themoviedb')).length;
  await call(tmdb, { url: '/api/tmdb?path=/trending/all/week&language=fr-FR', token: GOOD });
  assert.strictEqual(calls.filter((c) => c.url.includes('themoviedb')).length, n);
  const out = await call(tmdb, { url: '/api/tmdb?path=/trending/all/week&language=fr-FR' });
  assert.strictEqual(out.statusCode, 401, 'le cache ne court-circuite pas l’authentification');
});

test('cache mémoire : une entrée par langue (fr-FR et en-US ne se mélangent pas)', async () => {
  reset();
  const tm = () => calls.filter((c) => c.url.includes('themoviedb'));
  await call(tmdb, { url: '/api/tmdb?path=/movie/603&language=fr-FR', token: GOOD });
  await call(tmdb, { url: '/api/tmdb?path=/movie/603&language=en-US', token: GOOD });
  assert.strictEqual(tm().length, 2, 'la langue fait partie de la clé de cache');
  assert.ok(tm()[0].url.includes('language=fr-FR') && tm()[1].url.includes('language=en-US'));
  await call(tmdb, { url: '/api/tmdb?path=/movie/603&language=en-US', token: GOOD });
  assert.strictEqual(tm().length, 2, 'en-US resservi depuis le cache');
  const a = tmdb._buildUpstream(new URLSearchParams('path=/discover/movie&language=en-US&region=US&watch_region=US'));
  const b = tmdb._buildUpstream(new URLSearchParams('path=/discover/movie&language=fr-FR&region=FR&watch_region=FR'));
  assert.notStrictEqual(a.query, b.query);
  assert.match(a.query, /region=US/);
  assert.strictEqual(tmdb._buildUpstream(new URLSearchParams('path=/discover/movie&region=usa')).error, 'param');
});

test('ALLOWED_EMAILS : 403 hors liste, insensible à la casse', async () => {
  reset();
  process.env.ALLOWED_EMAILS = ' moi@example.com ';
  let out = await call(tmdb, { url: '/api/tmdb?path=/movie/603', token: OTHER });
  assert.strictEqual(out.statusCode, 403);
  out = await call(tmdb, { url: '/api/tmdb?path=/movie/603', token: GOOD });
  assert.strictEqual(out.statusCode, 200);
  assert.ok(!out.body.includes('example.com'), "pas d'email dans la réponse");
});

test('500 si configuration absente', async () => {
  reset();
  const saved = process.env.SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_ANON_KEY;
  const out = await call(tmdb, { url: '/api/tmdb?path=/movie/603', token: GOOD });
  process.env.SUPABASE_ANON_KEY = saved;
  assert.strictEqual(out.statusCode, 500);
  assert.strictEqual(out.headers['cache-control'], 'no-store');
});

test('OMDb : format de i contrôlé, champs filtrés, erreurs de clé non relayées', async () => {
  reset();
  let out = await call(omdb, { url: '/api/omdb?i=abc', token: GOOD });
  assert.strictEqual(out.statusCode, 400);
  out = await call(omdb, { url: '/api/omdb?i=tt0133093&apikey=pirate', token: GOOD });
  assert.strictEqual(out.statusCode, 200);
  upstream = { status: 200, body: { Response: 'False', Error: 'Invalid API key!' } };
  out = await call(omdb, { url: '/api/omdb?i=tt0000001', token: GOOD });
  assert.strictEqual(out.statusCode, 502);
  assert.strictEqual(out.headers['cache-control'], 'no-store');
  upstream = { status: 200, body: { Response: 'True', imdbID: 'tt0000002', Title: 'X', Ratings: [{ Source: 'Rotten Tomatoes', Value: '88%' }] } };
  out = await call(omdb, { url: '/api/omdb?i=tt0000002', token: GOOD });
  const d = JSON.parse(out.body);
  assert.deepStrictEqual(d.Ratings, [{ Source: 'Rotten Tomatoes', Value: '88%' }]);
  const up = calls.filter((c) => c.url.includes('omdbapi.com'));
  assert.ok(up.every((c) => !c.url.includes('pirate')));
  noLeak(out);
  out = await call(omdb, { url: '/api/omdb?i=tt0133093' });
  assert.strictEqual(out.statusCode, 401);
});

test('releases : manifest réécrit, aucune URL github.com ni token exposés', async () => {
  reset();
  const out = await call(releases, { url: '/api/releases?f=manifest' });
  assert.strictEqual(out.statusCode, 200);
  const m = JSON.parse(out.body);
  assert.strictEqual(m.platforms['windows-x86_64'].url, 'https://watchlist-omega-three.vercel.app/api/releases?f=asset&id=222');
  assert.ok(!out.body.includes('github.com'), 'aucune URL github.com directe');
  assert.ok(!out.body.includes(FAKE_GH_TOKEN), 'token non exposé');
});

test('releases : téléchargement d’un asset de la dernière release', async () => {
  reset();
  const out = await call(releases, { url: '/api/releases?f=asset&id=222' });
  assert.strictEqual(out.statusCode, 200);
  assert.strictEqual(out.headers['content-type'], 'application/octet-stream');
  assert.match(out.headers['content-disposition'], /Watchlist_1\.0\.0_x64-setup\.exe/);
});

test('releases : id hors de la dernière release refusé (404)', async () => {
  reset();
  const out = await call(releases, { url: '/api/releases?f=asset&id=999' });
  assert.strictEqual(out.statusCode, 404);
});

test('releases : paramètre f manquant ou invalide (400), id non numérique (400)', async () => {
  reset();
  let out = await call(releases, { url: '/api/releases' });
  assert.strictEqual(out.statusCode, 400);
  out = await call(releases, { url: '/api/releases?f=autre' });
  assert.strictEqual(out.statusCode, 400);
  out = await call(releases, { url: '/api/releases?f=asset&id=abc' });
  assert.strictEqual(out.statusCode, 400);
});

test('releases : 500 si GITHUB_TOKEN absent côté serveur', async () => {
  reset();
  delete process.env.GITHUB_TOKEN;
  const out = await call(releases, { url: '/api/releases?f=manifest' });
  assert.strictEqual(out.statusCode, 500);
});

test('releases : 405 sur POST', async () => {
  reset();
  const out = await call(releases, { method: 'POST', url: '/api/releases?f=manifest' });
  assert.strictEqual(out.statusCode, 405);
});

/* ===================== Ouverture publique : comptes, quotas, cache ===================== */

test('compte non confirmé : 403 email_unconfirmed, aucun appel amont', async () => {
  reset();
  const out = await call(tmdb, { url: '/api/tmdb?path=/movie/603', token: UNCONF });
  assert.strictEqual(out.statusCode, 403);
  assert.strictEqual(JSON.parse(out.body).error, 'email_unconfirmed');
  assert.strictEqual(upstreamCalls('themoviedb'), 0);
  assert.strictEqual(upstreamCalls('consume_api_quota'), 0, 'pas de quota consommé');
});

test('utilisateur anonyme Supabase refusé (403)', async () => {
  reset();
  const out = await call(omdb, { url: '/api/omdb?i=tt0133093', token: ANONU });
  assert.strictEqual(out.statusCode, 403);
});

test('ALLOWED_EMAILS vide : tout compte confirmé est accepté', async () => {
  reset();
  process.env.ALLOWED_EMAILS = '  ';
  const out = await call(tmdb, { url: '/api/tmdb?path=/movie/603', token: OTHER });
  assert.strictEqual(out.statusCode, 200);
});

test('quota tmdb : la RPC reçoit le jeton de l’utilisateur (jamais la clé secrète)', async () => {
  reset();
  process.env.SUPABASE_SECRET_KEY = FAKE_SECRET;
  await call(tmdb, { url: '/api/tmdb?path=/movie/603', token: GOOD });
  const rpc = calls.find((c) => c.url.endsWith('/rpc/consume_api_quota'));
  assert.ok(rpc, 'RPC appelée');
  assert.strictEqual(rpc.opts.headers.Authorization, 'Bearer ' + GOOD);
  assert.strictEqual(rpc.opts.headers.apikey, FAKE_ANON);
  assert.deepStrictEqual(JSON.parse(rpc.opts.body), { p_bucket: 'tmdb', p_cost: 1 });
});

test('quota tmdb dépassé : 429 quota_exceeded + Retry-After, mémorisé, autres comptes intacts', async () => {
  reset();
  fakeDb.limits.tmdb.user = 2;
  assert.strictEqual((await call(tmdb, { url: '/api/tmdb?path=/movie/1', token: GOOD })).statusCode, 200);
  assert.strictEqual((await call(tmdb, { url: '/api/tmdb?path=/movie/2', token: GOOD })).statusCode, 200);
  let out = await call(tmdb, { url: '/api/tmdb?path=/movie/1', token: GOOD });
  assert.strictEqual(out.statusCode, 429);
  assert.strictEqual(JSON.parse(out.body).error, 'quota_exceeded');
  assert.match(JSON.parse(out.body).message, /quota quotidien/i);
  assert.ok(Number(out.headers['retry-after']) > 0 && Number(out.headers['retry-after']) <= 86400);
  assert.strictEqual(out.headers['cache-control'], 'no-store');
  const rpcBefore = upstreamCalls('consume_api_quota');
  out = await call(tmdb, { url: '/api/tmdb?path=/movie/1', token: GOOD });
  assert.strictEqual(out.statusCode, 429, 'toujours refusé, même en cache mémoire');
  assert.strictEqual(upstreamCalls('consume_api_quota'), rpcBefore, 'refus mémorisé : plus d’appel RPC');
  out = await call(tmdb, { url: '/api/tmdb?path=/movie/1', token: OTHER });
  assert.strictEqual(out.statusCode, 200, 'un autre compte n’est pas affecté');
});

test('quota : fail-open si la RPC est absente (migration non appliquée) ou si Supabase ne répond pas', async () => {
  reset();
  fakeDb.rpcMode = 'missing';
  let out = await call(tmdb, { url: '/api/tmdb?path=/movie/1', token: GOOD });
  assert.strictEqual(out.statusCode, 200);
  const n = upstreamCalls('consume_api_quota');
  await call(tmdb, { url: '/api/tmdb?path=/movie/2', token: GOOD });
  assert.strictEqual(upstreamCalls('consume_api_quota'), n, 'RPC absente : pas de nouvel essai pendant 5 min');
  reset();
  fakeDb.rpcMode = 'down';
  out = await call(tmdb, { url: '/api/tmdb?path=/movie/1', token: GOOD });
  assert.strictEqual(out.statusCode, 200);
  reset();
  fakeDb.rpcMode = 'error';
  out = await call(tmdb, { url: '/api/tmdb?path=/movie/1', token: GOOD });
  assert.strictEqual(out.statusCode, 200);
});

test('TMDB 429 amont → 503 temporaire (pas confondu avec le quota utilisateur)', async () => {
  reset();
  upstream = { status: 429, body: { status_message: 'Too many' } };
  const out = await call(tmdb, { url: '/api/tmdb?path=/movie/9', token: GOOD });
  assert.strictEqual(out.statusCode, 503);
  assert.strictEqual(JSON.parse(out.body).error, 'upstream_rate_limited');
});

test('OMDb : cache partagé Supabase — 2e instance servie sans appel OMDb ni quota', async () => {
  reset();
  process.env.SUPABASE_SECRET_KEY = FAKE_SECRET;
  upstream = { status: 200, body: { Response: 'True', imdbID: 'tt0133093', Title: 'Matrix', Plot: 'long…', Ratings: [{ Source: 'Internet Movie Database', Value: '8.7/10' }] } };
  let out = await call(omdb, { url: '/api/omdb?i=tt0133093', token: GOOD });
  assert.strictEqual(out.statusCode, 200);
  assert.strictEqual(upstreamCalls('omdbapi.com'), 1);
  const row = fakeDb.cache['omdb:tt0133093'];
  assert.ok(row, 'écrit dans api_cache');
  assert.deepStrictEqual(Object.keys(row.body).sort(), ['Ratings', 'Response', 'imdbID'], 'seuls les champs utiles sont stockés');
  assert.ok(new Date(row.expires_at) - Date.now() > 20 * 24 * 3600 * 1000, 'TTL ~30 jours');
  const put = calls.find((c) => c.url.includes('/rest/v1/api_cache') && c.opts.method === 'POST');
  assert.strictEqual(put.opts.headers.apikey, FAKE_SECRET);
  assert.ok(!put.opts.headers.Authorization, 'clé sb_secret : pas d’en-tête Bearer');
  assert.strictEqual(fakeDb.usage['u1:omdb'], 1, '1 appel OMDb compté');

  omdb._cache.clear(); /* simule une autre instance de fonction */
  calls.length = 0;
  out = await call(omdb, { url: '/api/omdb?i=tt0133093', token: OTHER });
  assert.strictEqual(out.statusCode, 200);
  assert.deepStrictEqual(JSON.parse(out.body).Ratings, [{ Source: 'Internet Movie Database', Value: '8.7/10' }]);
  assert.strictEqual(upstreamCalls('omdbapi.com'), 0, 'servi depuis le cache partagé');
  assert.strictEqual(upstreamCalls('consume_api_quota'), 0, 'cache = pas de quota consommé');
  noLeak(out);
});

test('OMDb : sans clé secrète, aucun accès à api_cache (cache mémoire seul)', async () => {
  reset();
  upstream = { status: 200, body: { Response: 'True', imdbID: 'tt0000010', Ratings: [] } };
  const out = await call(omdb, { url: '/api/omdb?i=tt0000010', token: GOOD });
  assert.strictEqual(out.statusCode, 200);
  assert.strictEqual(upstreamCalls('api_cache'), 0);
});

test('OMDb : « Request limit reached » → 503 omdb_unavailable et disjoncteur 1 h', async () => {
  reset();
  upstream = { status: 401, body: { Response: 'False', Error: 'Request limit reached!' } };
  let out = await call(omdb, { url: '/api/omdb?i=tt0000020', token: GOOD });
  assert.strictEqual(out.statusCode, 503);
  assert.strictEqual(JSON.parse(out.body).error, 'omdb_unavailable');
  assert.strictEqual(out.headers['cache-control'], 'no-store');
  upstream = { status: 200, body: { Response: 'True', imdbID: 'tt0000021', Ratings: [] } };
  const n = upstreamCalls('omdbapi.com');
  out = await call(omdb, { url: '/api/omdb?i=tt0000021', token: GOOD });
  assert.strictEqual(out.statusCode, 503, 'disjoncteur ouvert');
  assert.strictEqual(upstreamCalls('omdbapi.com'), n, 'plus aucun appel OMDb');
});

test('OMDb : quota global atteint → 503 jusqu’à minuit UTC, quota utilisateur → 503 aussi', async () => {
  reset();
  fakeDb.limits.omdb.global = 1;
  upstream = { status: 200, body: { Response: 'True', imdbID: 'tt0000030', Ratings: [] } };
  assert.strictEqual((await call(omdb, { url: '/api/omdb?i=tt0000030', token: GOOD })).statusCode, 200);
  let out = await call(omdb, { url: '/api/omdb?i=tt0000031', token: OTHER });
  assert.strictEqual(out.statusCode, 503);
  assert.ok(omdb._breaker.until > Date.now() + 1000, 'disjoncteur armé');
  reset();
  fakeDb.limits.omdb.user = 1;
  await call(omdb, { url: '/api/omdb?i=tt0000032', token: GOOD });
  out = await call(omdb, { url: '/api/omdb?i=tt0000033', token: GOOD });
  assert.strictEqual(out.statusCode, 503);
  assert.strictEqual(omdb._breaker.until, 0, 'quota individuel : pas de disjoncteur global');
  out = await call(omdb, { url: '/api/omdb?i=tt0000033', token: OTHER });
  assert.strictEqual(out.statusCode, 200, 'les autres comptes continuent');
});

test('OMDb : « Movie not found » mis en cache (évite de redemander chaque jour)', async () => {
  reset();
  upstream = { status: 200, body: { Response: 'False', Error: 'Incorrect IMDb ID.' } };
  let out = await call(omdb, { url: '/api/omdb?i=tt9999999', token: GOOD });
  assert.strictEqual(out.statusCode, 200);
  assert.strictEqual(JSON.parse(out.body).Response, 'False');
  out = await call(omdb, { url: '/api/omdb?i=tt9999999', token: GOOD });
  assert.strictEqual(upstreamCalls('omdbapi.com'), 1);
});

test('/api/config : clé de site Turnstile publique uniquement, valeurs invalides ignorées', async () => {
  reset();
  let out = await call(config, { url: '/api/config' });
  assert.strictEqual(out.statusCode, 200);
  assert.deepStrictEqual(JSON.parse(out.body), { turnstileSiteKey: '', signupsOpen: true });
  assert.match(out.headers['cache-control'], /public/);
  process.env.TURNSTILE_SITE_KEY = '0x4AAAAAAAB_cdEFgh123';
  process.env.SIGNUPS_OPEN = '0';
  out = await call(config, { url: '/api/config' });
  assert.deepStrictEqual(JSON.parse(out.body), { turnstileSiteKey: '0x4AAAAAAAB_cdEFgh123', signupsOpen: false });
  process.env.TURNSTILE_SITE_KEY = '"><script>alert(1)</script>';
  out = await call(config, { url: '/api/config' });
  assert.strictEqual(JSON.parse(out.body).turnstileSiteKey, '');
  process.env.SUPABASE_SECRET_KEY = FAKE_SECRET;
  out = await call(config, { url: '/api/config' });
  noLeak(out);
  assert.strictEqual((await call(config, { method: 'POST', url: '/api/config' })).statusCode, 405);
});

test('cache mémoire borné en octets (LRU)', () => {
  const c = common.makeCache(100, 1000);
  c.set('a', 'x'.repeat(200), 60000);
  c.set('b', 'x'.repeat(200), 60000);
  c.get('a');
  c.set('c', 'x'.repeat(200), 60000);
  c.set('d', 'x'.repeat(200), 60000);
  c.set('e', 'x'.repeat(200), 60000);
  c.set('f', 'x'.repeat(200), 60000);
  assert.ok(c.bytes <= 1000);
  assert.strictEqual(c.get('b'), null, 'le moins récemment utilisé est évincé');
  assert.ok(c.get('a'));
  c.set('big', 'x'.repeat(600), 60000);
  assert.strictEqual(c.get('big'), null, 'valeur trop grosse ignorée');
});

test('secondsUntilUtcMidnight', () => {
  assert.strictEqual(common.secondsUntilUtcMidnight(Date.UTC(2026, 9, 8, 23, 59, 0)), 60);
  assert.strictEqual(common.secondsUntilUtcMidnight(Date.UTC(2026, 9, 8, 0, 0, 0)), 86400);
});
