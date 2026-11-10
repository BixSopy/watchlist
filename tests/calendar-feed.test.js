'use strict';
/* Abonnement calendrier : api/calendar.js (flux .ics public /cal/<jeton>), réécriture vercel.json,
   migration rejouée par scripts/test-migrations.sh. Base : supabase/tests/94_calendrier_abonnement.test.sql.
   Lancer : node --test tests/ */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
const cal = require(path.join(ROOT, 'api', 'calendar.js'));

const TOK = 'k7Qm2xVf9TbR4wLpZ3nHq1';
const NOW = new Date('2026-11-10T08:00:00Z');
const DATA = { lang: 'fr', items: [
  { uid: 's1', title: 'Severance, saison 2; finale', type: 'serie', date: '2026-11-13' },
  { uid: 'a1', title: 'Frieren', type: 'anime', date: '2026-11-11' },
  { uid: 'x', title: 'Date invalide', type: 'serie', date: '13/11/2026' },
  { uid: '', title: 'Sans uid', type: 'serie', date: '2026-11-12' },
] };

function fakeRes() {
  const h = {}; return { statusCode: 0, headers: h, body: '', setHeader(k, v) { h[k.toLowerCase()] = v; }, end(b) { this.body = String(b || ''); } };
}
async function call(url, fetchImpl, o = {}) {
  const res = fakeRes();
  await cal({ method: o.method || 'GET', url, headers: { host: 'cinepisode.com', 'x-real-ip': o.ip || '203.0.113.' + Math.floor(Math.random() * 250) } }, res, { fetch: fetchImpl, now: NOW });
  return res;
}

test('flux .ics : événements sur la journée, texte échappé, UID stables, rafraîchissement, pas de cache partagé', async () => {
  const seen = [];
  const res = await call('/api/calendar?t=' + TOK, async (u, o) => { seen.push([u, JSON.parse(o.body), o.headers.apikey]); return new Response(JSON.stringify(DATA)); });
  assert.strictEqual(res.statusCode, 200);
  assert.match(seen[0][0], /\/rest\/v1\/rpc\/get_calendar_feed$/);
  assert.deepStrictEqual(seen[0][1], { p_token: TOK });
  assert.match(seen[0][2], /^sb_publishable_/, 'clé publique uniquement');
  assert.strictEqual(res.headers['content-type'], 'text/calendar; charset=utf-8');
  assert.strictEqual(res.headers['cache-control'], 'private, max-age=900');
  assert.strictEqual(res.headers['x-robots-tag'], 'noindex, nofollow, noarchive');
  const b = res.body;
  assert.match(b, /^BEGIN:VCALENDAR\r\n/);
  assert.match(b, /\r\nEND:VCALENDAR\r\n$/);
  assert.match(b, /X-WR-CALNAME:Cinepisode — mes sorties\r\n/);
  assert.match(b, /REFRESH-INTERVAL;VALUE=DURATION:PT6H\r\n/);
  assert.match(b, /SUMMARY:Severance\\, saison 2\\; finale \(nouvel épisode\)\r\n/);
  assert.match(b, /UID:s1-next-20261113@cinepisode\r\n/);
  assert.match(b, /DTSTART;VALUE=DATE:20261113\r\nDTEND;VALUE=DATE:20261114\r\n/);
  assert.strictEqual((b.match(/BEGIN:VEVENT/g) || []).length, 2, 'date invalide et uid vide ignorés');
  assert.ok(b.indexOf('Frieren') < b.indexOf('Severance'), 'trié par date');
});

test('langue du flux, repli en français', () => {
  assert.match(cal._render({ lang: 'en', items: DATA.items }, NOW), /X-WR-CALNAME:Cinepisode — my releases[\s\S]*\(new episode\)/);
  assert.match(cal._render({ lang: 'xx', items: [] }, NOW), /mes sorties/);
  assert.doesNotMatch(cal._render({ lang: 'fr', items: [] }, NOW), /BEGIN:VEVENT/);
});

test('jeton mal formé : 404 sans requête ; inconnu ou désactivé : même 404 ; .ics accepté', async () => {
  let n = 0;
  const f = async () => { n++; return new Response('null'); };
  for (const t of ['', 'abc', TOK + 'x', "k7Qm2xVf9TbR4wLpZ3nH'1"]) { const r = await call('/api/calendar?t=' + encodeURIComponent(t), f); assert.strictEqual(r.statusCode, 404, t); }
  assert.strictEqual(n, 0, 'aucune requête pour un jeton mal formé');
  const r = await call('/api/calendar?t=' + TOK, f);
  assert.strictEqual(r.statusCode, 404); assert.strictEqual(n, 1);
  assert.strictEqual(r.headers['cache-control'], 'private, no-store');
  const ok = await call('/api/calendar?t=' + TOK + '.ics', async () => new Response(JSON.stringify(DATA)));
  assert.strictEqual(ok.statusCode, 200);
});

test('HEAD sans corps, autres méthodes refusées, limite de débit, erreur Supabase = 502', async () => {
  const f = async () => new Response(JSON.stringify(DATA));
  const h = await call('/api/calendar?t=' + TOK, f, { method: 'HEAD' });
  assert.deepStrictEqual([h.statusCode, h.body, h.headers['content-type']], [200, '', 'text/calendar; charset=utf-8']);
  const p = await call('/api/calendar?t=' + TOK, f, { method: 'POST' });
  assert.deepStrictEqual([p.statusCode, p.headers.allow], [405, 'GET, HEAD']);
  let last;
  for (let i = 0; i < 61; i++) last = await call('/api/calendar?t=' + TOK, async () => new Response('null'), { ip: '198.51.100.9' });
  assert.strictEqual(last.statusCode, 429);
  const e = await call('/api/calendar?t=' + TOK, async () => new Response('x', { status: 500 }));
  assert.strictEqual(e.statusCode, 502); assert.strictEqual(e.headers['cache-control'], 'private, no-store');
});

test('réécriture /cal/<jeton>, migration testée deux fois, carte branchée sur les bonnes fonctions', () => {
  const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  assert.ok(v.rewrites.some(r => r.source === '/cal/:token' && r.destination === '/api/calendar?t=:token'));
  const sh = fs.readFileSync(path.join(ROOT, 'scripts', 'test-migrations.sh'), 'utf8');
  assert.strictEqual((sh.match(/20261110\*\.sql/g) || []).length, 2, 'rejouée deux fois (idempotence)');
  const js = fs.readFileSync(path.join(ROOT, 'js', '26-calendar.js'), 'utf8');
  for (const fn of ['calendar_feed_get', 'calendar_feed_rotate', 'calendar_feed_revoke']) assert.match(js, new RegExp("supa\\.rpc\\('" + fn + "'|'" + fn + "'"), fn);
  const actions = fs.readFileSync(path.join(ROOT, 'js', '00-actions.js'), 'utf8');
  for (const a of ['calSubCreate', 'calSubCopy', 'calSubAsk', 'calSubRotateGo', 'calSubRevokeGo', 'calSubCancel', 'calSubRetry']) assert.match(actions, new RegExp("uiOn\\('" + a + "'"), a);
});
