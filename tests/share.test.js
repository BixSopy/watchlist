'use strict';
/* Partage en lecture seule : js/30-share.js (paramètre « ajouter »), api/share.js (page publique),
   api/og.mjs (aperçu), vercel.json et migration. Base : supabase/tests/70_partage.test.sql.
   Lancer : node --test tests/ */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');

global.window = global; global.location = { search: '', pathname: '/', hash: '', origin: 'https://cinepisode.com' };
global.document = { documentElement: { className: '' } };
global.sessionStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
global.history = { replaceState() {} };
const realSetInterval = global.setInterval; global.setInterval = () => 0;
const { sharePendingParse } = require(path.join(ROOT, 'js', '30-share.js'));
global.setInterval = realSetInterval;
const share = require(path.join(ROOT, 'api', 'share.js'));
const S = require(path.join(ROOT, 'api', '_lib', 'share.js'));

const TOK = 'k7Qm2xVf9TbR4wLpZ3nHq1';
const DATA = { name: 'Pierre', kind: 'filtered', filter_status: ['encours'], filter_types: ['anime'], stats: null,
  items: [{ tmdb_id: 7, tmdb_type: 'tv', type: 'anime', title: 'Kingdom <img src=x onerror=alert(1)>', year: '2012', poster_path: '/k.jpg', season: 5, episode: 9, rating: null },
    { tmdb_id: 8, tmdb_type: 'tv', type: 'anime', title: 'Mal"', year: '2000', poster_path: 'javascript:alert(1)', season: null, episode: null, rating: 8 }] };

function fakeRes() {
  const h = {}; return { statusCode: 0, headers: h, body: '', setHeader(k, v) { h[k.toLowerCase()] = v; }, end(b) { this.body = String(b || ''); } };
}
async function call(url, fetchImpl, ip) {
  const res = fakeRes();
  await share({ method: 'GET', url, headers: { host: 'cinepisode.com', 'x-real-ip': ip || '203.0.113.' + Math.floor(Math.random() * 250) } }, res, { fetch: fetchImpl });
  return res;
}

test('« Ajouter à ma liste » : paramètres validés', () => {
  assert.deepStrictEqual(sharePendingParse('?ajouter=tv.95479&t=Jujutsu+Kaisen&y=2020&p=%2Fp2.jpg'), { tmdbId: 95479, type: 'tv', title: 'Jujutsu Kaisen', year: '2020', poster: '/p2.jpg' });
  assert.strictEqual(sharePendingParse('?ajouter=person.1'), null);
  assert.strictEqual(sharePendingParse('?ajouter=tv.1%3Balert'), null);
  assert.strictEqual(sharePendingParse('?ajouter=movie.3&p=https://evil/x.jpg').poster, null, 'affiche externe refusée');
  assert.strictEqual(sharePendingParse(''), null);
});

test('page publique : HTML échappé, sans script, noindex, pas de cache partagé', async () => {
  const seen = [];
  const res = await call('/api/share?t=' + TOK, async (u, o) => { seen.push([u, JSON.parse(o.body), o.headers.apikey]); return new Response(JSON.stringify(DATA)); });
  assert.strictEqual(res.statusCode, 200);
  assert.match(seen[0][0], /\/rest\/v1\/rpc\/get_public_share$/);
  assert.deepStrictEqual(seen[0][1], { p_token: TOK });
  assert.match(seen[0][2], /^sb_publishable_/, 'clé publique uniquement');
  assert.strictEqual(res.headers['x-robots-tag'], 'noindex, nofollow, noarchive');
  assert.strictEqual(res.headers['referrer-policy'], 'no-referrer');
  assert.strictEqual(res.headers['cache-control'], 'private, no-store');
  assert.doesNotMatch(res.body, /<script|<img src=x/i);
  assert.match(res.body, /Kingdom &lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(res.body, /javascript:/, 'affiche non conforme ignorée');
  assert.match(res.body, /<meta property="og:image" content="https:\/\/cinepisode\.com\/api\/og\?t=k7Qm2xVf9TbR4wLpZ3nHq1">/);
  assert.match(res.body, /Pierre regarde 2 anime en ce moment/);
  assert.match(res.body, /href="\/\?ajouter=tv\.7&amp;t=Kingdom/);
  assert.match(res.body, /★ 8/);
});

test('jeton mal formé : 404 sans requête ; inconnu ou révoqué : même 404 neutre', async () => {
  let n = 0;
  const f = async () => { n++; return new Response('null'); };
  for (const t of ['', 'abc', TOK + 'x', "k7Qm2xVf9TbR4wLpZ3nH'1"]) { const r = await call('/api/share?t=' + encodeURIComponent(t), f); assert.strictEqual(r.statusCode, 404, t); }
  assert.strictEqual(n, 0, 'aucune requête pour un jeton mal formé');
  const r = await call('/api/share?t=' + TOK, f);
  assert.strictEqual(r.statusCode, 404); assert.strictEqual(n, 1);
  assert.match(r.body, /n’est plus disponible/); assert.doesNotMatch(r.body, /og:image/);
});

test('limite de débit par IP (60 / min) ; erreur Supabase = 502 non mise en cache', async () => {
  const f = async () => new Response('null');
  let last;
  for (let i = 0; i < 61; i++) last = await call('/api/share?t=' + TOK, f, '198.51.100.7');
  assert.strictEqual(last.statusCode, 429); assert.strictEqual(last.headers['retry-after'], '60');
  const e = await call('/api/share?t=' + TOK, async () => new Response('x', { status: 500 }));
  assert.strictEqual(e.statusCode, 502); assert.strictEqual(e.headers['cache-control'], 'private, no-store');
});

test('titres des aperçus', () => {
  assert.strictEqual(S.headline({ name: 'Pierre', kind: 'filtered', filter_status: ['encours'], filter_types: ['anime'], items: [1, 2, 3, 4] }), 'Pierre regarde 4 anime en ce moment');
  assert.strictEqual(S.headline({ name: 'Pierre', kind: 'filtered', filter_status: ['encours'], filter_types: ['serie'], items: [1, 2] }), 'Pierre regarde 2 séries en ce moment');
  assert.strictEqual(S.headline({ name: '', kind: 'list', items: [] }), 'La liste de Quelqu’un');
  assert.strictEqual(S.headline({ name: 'Ana', kind: 'filtered', filter_status: ['avoir'], filter_types: ['film'], items: [1] }), 'La liste de Ana · À voir, Films');
});

test('aperçu /api/og : Edge, cache court (pas « immutable »), carte générique si lien invalide', () => {
  const src = fs.readFileSync(path.join(ROOT, 'api', 'og.mjs'), 'utf8');
  assert.match(src, /runtime: 'edge'/);
  assert.match(src, /hd\.set\('Cache-Control', d \? 'public, max-age=300, s-maxage=600'/);
  assert.match(src, /if \(!TOKEN_RE\.test/);
  assert.doesNotMatch(src, /service_role|SUPABASE_SECRET/);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.deepStrictEqual(Object.keys(pkg.dependencies), ['@vercel/og']);
  assert.ok(!pkg.scripts || !pkg.scripts.build, 'pas de build : l\'app reste servie telle quelle');
  assert.match(fs.readFileSync(path.join(ROOT, '.vercelignore'), 'utf8'), /^!package\.json$/m);
  assert.ok(fs.existsSync(path.join(ROOT, 'api', '_fonts', 'Inter-ExtraBold.ttf')));
});

test('vercel.json : /s/<jeton> réécrit vers /api/share, noindex et no-referrer', () => {
  const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  assert.ok(v.rewrites.some(r => r.source === '/s/:token' && r.destination === '/api/share?t=:token'));
  const h = v.headers.find(x => x.source === '/s/(.*)');
  const get = k => (h.headers.find(x => x.key === k) || {}).value;
  assert.strictEqual(get('X-Robots-Tag'), 'noindex, nofollow, noarchive');
  assert.strictEqual(get('Referrer-Policy'), 'no-referrer');
});

test('migration : pgcrypto qualifiée (extensions.), search_path vide, jamais les titres détectés', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '20261013150000_partage_lecture_seule.sql'), 'utf8');
  assert.match(sql, /extensions\.gen_random_bytes\(16\)/);
  assert.doesNotMatch(sql, /[^.]gen_random_bytes/);
  assert.strictEqual((sql.match(/security definer set search_path = ''/g) || []).length, 3);
  assert.doesNotMatch(sql.split('-- ---------- Lecture publique')[1], /detected_media|extension_devices|overview|tags|account_id|local_id/);
  assert.match(fs.readFileSync(path.join(ROOT, 'supabase', 'schema.sql'), 'utf8'), /create or replace function public\.get_public_share/);
});

test('aucun traceur : pas de script tiers ni d\'analytics dans le partage', () => {
  for (const f of ['js/30-share.js', 'api/share.js', 'api/og.mjs', 'api/_lib/share.js']) {
    const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.doesNotMatch(s, /googletagmanager|google-analytics|gtag\(|plausible|posthog|segment\.io|facebook\.net|hotjar|mixpanel/i, f);
  }
});
