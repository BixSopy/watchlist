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
const GOOD = 'aaaa.bbbb.good';
const OTHER = 'aaaa.bbbb.other';

process.env.TMDB_API_KEY = FAKE_TMDB;
process.env.OMDB_API_KEY = FAKE_OMDB;
process.env.SUPABASE_ANON_KEY = FAKE_ANON;
process.env.SUPABASE_URL = 'https://example.supabase.co';

const calls = [];
let upstream = { status: 200, body: { id: 603, title: 'Matrix' } };
global.fetch = async (url, opts) => {
  calls.push({ url: String(url), opts: opts || {} });
  const u = String(url);
  if (u.startsWith('https://example.supabase.co/auth/v1/user')) {
    const h = (opts && opts.headers) || {};
    if (h.apikey !== FAKE_ANON) return resp(401, { msg: 'no apikey' });
    if (h.Authorization === 'Bearer ' + GOOD) return resp(200, { id: 'u1', email: 'Moi@Example.com' });
    if (h.Authorization === 'Bearer ' + OTHER) return resp(200, { id: 'u2', email: 'autre@example.com' });
    return resp(401, { msg: 'bad jwt' });
  }
  return resp(upstream.status, upstream.body);
};
function resp(status, body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return { status, ok: status >= 200 && status < 300, text: async () => text, json: async () => JSON.parse(text) };
}

const tmdb = require('../api/tmdb');
const omdb = require('../api/omdb');
const common = require('../api/_lib/common');

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
}
function reset() { common._authCache.clear(); tmdb._cache.clear(); omdb._cache.clear(); common._buckets.clear(); calls.length = 0; delete process.env.ALLOWED_EMAILS; upstream = { status: 200, body: { id: 603, title: 'Matrix' } }; }

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
