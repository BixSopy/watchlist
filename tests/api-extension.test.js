'use strict';
/*
 * Proxy /api/tmdb appelé par l'extension (jeton de suivi dans X-Cinepisode-Token) : fetch simulé.
 * Lancer : node --test tests/
 */
const test = require('node:test');
const assert = require('node:assert');

const FAKE_TMDB = 'faketmdbkey_0123456789abcdef';
const FAKE_ANON = 'sb_publishable_fake_anon';
const TOK = 'a7'.repeat(24);
const BAD = '00'.repeat(24);
process.env.TMDB_API_KEY = FAKE_TMDB;
process.env.SUPABASE_ANON_KEY = FAKE_ANON;
process.env.SUPABASE_URL = 'https://example.supabase.co';

let rpcMode = 'ok';
let used = 0;
const calls = [];
function resp(status, body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return { status, ok: status >= 200 && status < 300, text: async () => text, json: async () => JSON.parse(text) };
}
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  calls.push({ url: u, opts });
  if (u === 'https://example.supabase.co/rest/v1/rpc/consume_api_quota_by_token') {
    if (rpcMode === 'missing') return resp(404, { code: 'PGRST202' });
    if (rpcMode === 'down') throw new Error('ECONNRESET');
    if (opts.headers.apikey !== FAKE_ANON || opts.headers.Authorization) return resp(401, {});
    const b = JSON.parse(opts.body);
    if (b.p_token !== TOK) return resp(200, { allowed: false, scope: 'invalid_token' });
    if (used >= 3) return resp(200, { allowed: false, scope: 'user', limit: 3 });
    used += b.p_cost;
    return resp(200, { allowed: true, used, limit: 3 });
  }
  if (u.startsWith('https://example.supabase.co/auth/v1/user')) return resp(401, {});
  if (u.startsWith('https://api.themoviedb.org/3/')) return resp(200, { results: [{ id: 1, name: 'Dark' }] });
  return resp(404, {});
};

const tmdb = require('../api/tmdb');
const common = require('../api/_lib/common');

function call({ method = 'GET', url, token, bearer }) {
  return new Promise((resolve) => {
    const headers = {};
    if (token) headers['x-cinepisode-token'] = token;
    if (bearer) headers.authorization = 'Bearer ' + bearer;
    const out = { headers: {}, statusCode: 200 };
    const res = {
      set statusCode(v) { out.statusCode = v; }, get statusCode() { return out.statusCode; },
      setHeader(k, v) { out.headers[k.toLowerCase()] = String(v); },
      end(b) { out.body = b == null ? '' : String(b); resolve(out); },
    };
    tmdb({ method, url, headers }, res);
  });
}
function reset() { rpcMode = 'ok'; used = 0; calls.length = 0; tmdb._cache.clear(); common._buckets.clear(); }
const tmdbCalls = () => calls.filter((c) => c.url.includes('themoviedb')).length;
const noLeak = (out) => assert.ok(!(out.body + JSON.stringify(out.headers)).includes(FAKE_TMDB) && !(out.body).includes(TOK));

test('extension : recherche avec un jeton valide -> 200, quota compté sur le jeton, en-tête Vary', async () => {
  reset();
  const out = await call({ url: '/api/tmdb?path=/search/tv&query=Dark&language=fr-FR&first_air_date_year=2017', token: TOK });
  assert.strictEqual(out.statusCode, 200);
  assert.strictEqual(out.headers.vary, 'Authorization, X-Cinepisode-Token');
  assert.match(out.headers['cache-control'], /^private/);
  assert.strictEqual(used, 1);
  const up = calls.find((c) => c.url.includes('themoviedb'));
  assert.ok(up.url.includes('first_air_date_year=2017') && up.url.includes('query=Dark'));
  noLeak(out);
});

test('extension : fiches film, série et saison accessibles', async () => {
  reset();
  for (const p of ['/movie/603', '/tv/1399', '/tv/1399/season/2', '/search/movie']) {
    const out = await call({ url: '/api/tmdb?path=' + encodeURIComponent(p) + '&query=x', token: TOK });
    assert.strictEqual(out.statusCode, used <= 3 ? 200 : 429, p);
    used = 0;
  }
});

test('extension : jeton inconnu -> 401, aucun appel TMDB', async () => {
  reset();
  const out = await call({ url: '/api/tmdb?path=/search/tv&query=Dark', token: BAD });
  assert.strictEqual(out.statusCode, 401);
  assert.strictEqual(JSON.parse(out.body).error, 'invalid_token');
  assert.strictEqual(tmdbCalls(), 0);
});

test('extension : jeton mal formé ignoré -> session exigée (401), aucun appel RPC ni TMDB', async () => {
  reset();
  for (const t of ['abc', 'A7'.repeat(24), TOK + '0', "a7' or 1=1"]) {
    const out = await call({ url: '/api/tmdb?path=/search/tv&query=Dark', token: t });
    assert.strictEqual(out.statusCode, 401, t);
  }
  assert.ok(!calls.some((c) => c.url.includes('consume_api_quota_by_token')));
  assert.strictEqual(tmdbCalls(), 0);
});

test('extension : chemins réservés au site refusés avec le jeton (400)', async () => {
  reset();
  for (const p of ['/trending/all/week', '/discover/movie', '/search/multi', '/movie/603/recommendations', '/tv/1/videos', '/collection/10', '/account']) {
    const out = await call({ url: '/api/tmdb?path=' + encodeURIComponent(p), token: TOK });
    assert.strictEqual(out.statusCode, 400, p);
  }
  assert.strictEqual(used, 0, 'aucun quota consommé');
  assert.strictEqual(tmdbCalls(), 0);
});

test('extension : RPC absente ou injoignable -> 503 (pas de mode dégradé sans authentification)', async () => {
  for (const mode of ['missing', 'down']) {
    reset(); rpcMode = mode;
    const out = await call({ url: '/api/tmdb?path=/search/tv&query=Dark', token: TOK });
    assert.strictEqual(out.statusCode, 503, mode);
    assert.strictEqual(tmdbCalls(), 0, mode);
  }
});

test('extension : quota quotidien atteint -> 429', async () => {
  reset(); used = 3;
  const out = await call({ url: '/api/tmdb?path=/search/tv&query=Dark', token: TOK });
  assert.strictEqual(out.statusCode, 429);
  assert.strictEqual(JSON.parse(out.body).error, 'quota_exceeded');
});

test('extension : POST refusé (405)', async () => {
  reset();
  const out = await call({ method: 'POST', url: '/api/tmdb?path=/search/tv&query=Dark', token: TOK });
  assert.strictEqual(out.statusCode, 405);
  assert.strictEqual(used, 0);
});

test('une session (Authorization) reste prioritaire sur le jeton : pas de mode extension', async () => {
  reset();
  const out = await call({ url: '/api/tmdb?path=/trending/all/week', token: TOK, bearer: 'aaaa.bbbb.bad' });
  assert.strictEqual(out.statusCode, 401);
  assert.ok(!calls.some((c) => c.url.includes('consume_api_quota_by_token')));
});
