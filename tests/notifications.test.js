'use strict';
/*
 * Notifications (rappels de sorties + newsletter) : api/notifications-digest.js (cron, fetch
 * simulé, aucun envoi réel) et api/newsletter-sync.js, plus le câblage du module js/40-notifications.js
 * (script, action, i18n FR/EN). Lancer : node --test tests/
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.SUPABASE_ANON_KEY = 'sb_publishable_fake';
process.env.SUPABASE_URL = 'https://example.supabase.co';
const SECRET = 'sb_secret_fake_0123';

function resp(status, body) { const t = JSON.stringify(body); return { status, ok: status < 300, text: async () => t, json: async () => JSON.parse(t) }; }
let calls;
function reset() {
  calls = [];
  process.env.RESEND_API_KEY = 're_fake';
  process.env.SUPABASE_SECRET_KEY = SECRET;
  delete require.cache[require.resolve('../api/notifications-digest.js')];
  delete require.cache[require.resolve('../api/newsletter-sync.js')];
}
function call(handler, req) {
  return new Promise((resolve) => {
    const res = { headers: {}, statusCode: 0, setHeader(k, v) { this.headers[k] = v; }, end(b) { resolve({ status: this.statusCode, body: JSON.parse(b) }); } };
    handler(Object.assign({ headers: { host: 'cinepisode.com' } }, req), res);
  });
}

test('js/40-notifications.js : script, action, i18n FR/EN', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /<script defer src="js\/40-notifications\.js"><\/script>/);
  const actions = fs.readFileSync(path.join(ROOT, 'js/00-actions.js'), 'utf8');
  assert.match(actions, /toggleNotifReleases:function\(\)\{toggleNotifReleases\(\);\}/);
  assert.match(actions, /toggleNotifNewsletter:function\(\)\{toggleNotifNewsletter\(\);\}/);
  const menu = fs.readFileSync(path.join(ROOT, 'js/17-settings-menu.js'), 'utf8');
  assert.match(menu, /_notifSection\(idx\+\+\)/);
  for (const lang of ['fr', 'en']) {
    const dict = fs.readFileSync(path.join(ROOT, 'js/i18n/' + lang + '.js'), 'utf8');
    for (const k of ['set.notifSection', 'set.notifReleases', 'set.notifReleasesHint', 'set.notifNewsletter', 'set.notifNewsletterHint', 'notif.err']) {
      assert.match(dict, new RegExp('"' + k.replace('.', '\\.') + '":'), lang + ' : ' + k);
    }
  }
});

/* ---------- api/notifications-digest.js (cron) ---------- */
test('notifications-digest : méthode, secret manquant ou faux', async () => {
  reset();
  const digest = require('../api/notifications-digest.js');
  assert.strictEqual((await call(digest, { method: 'POST' })).status, 405);
  delete process.env.CRON_SECRET;
  assert.deepStrictEqual((await call(digest, { method: 'GET' })).body, { sent: 0, reason: 'not_configured' });
  process.env.CRON_SECRET = 'cron_fake';
  const bad = await call(digest, { method: 'GET', headers: { host: 'cinepisode.com', authorization: 'Bearer wrong' } });
  assert.strictEqual(bad.status, 401);
});

function digestFetchMock({ prefs = [], items = [], profiles = [], users = {}, batchStatus = 200 }) {
  return async (url, opts) => {
    opts = opts || {}; const u = String(url);
    calls.push({ url: u, method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body ? JSON.parse(opts.body) : null });
    if (u.includes('/rest/v1/notification_prefs')) return resp(200, prefs);
    if (u.includes('/rest/v1/watchlist_items')) return resp(200, items);
    if (u.includes('/rest/v1/profiles')) return resp(200, profiles);
    const m = u.match(/\/auth\/v1\/admin\/users\/(.+)$/);
    if (m) return users[decodeURIComponent(m[1])] ? resp(200, users[decodeURIComponent(m[1])]) : resp(404, {});
    if (u === 'https://api.resend.com/emails/batch') return resp(batchStatus, [{ id: 'x' }]);
    throw new Error('URL inattendue ' + u);
  };
}

test('notifications-digest : personne opté in -> aucun envoi', async () => {
  reset();
  process.env.CRON_SECRET = 'cron_fake';
  global.fetch = digestFetchMock({ prefs: [] });
  const digest = require('../api/notifications-digest.js');
  const r = await call(digest, { method: 'GET', headers: { host: 'cinepisode.com', authorization: 'Bearer cron_fake' } });
  assert.deepStrictEqual(r.body, { sent: 0, reason: 'no_optin' });
});

test('notifications-digest : opté in mais aucune sortie dans la fenêtre -> aucun envoi', async () => {
  reset();
  process.env.CRON_SECRET = 'cron_fake';
  global.fetch = digestFetchMock({ prefs: [{ profile_id: 'p1' }], items: [] });
  const digest = require('../api/notifications-digest.js');
  const r = await call(digest, { method: 'GET', headers: { host: 'cinepisode.com', authorization: 'Bearer cron_fake' } });
  assert.deepStrictEqual(r.body, { sent: 0, reason: 'no_items' });
});

test('notifications-digest : un email par profil concerné, titre + affiche + lien réglages', async () => {
  reset();
  process.env.CRON_SECRET = 'cron_fake';
  global.fetch = digestFetchMock({
    prefs: [{ profile_id: 'p1' }],
    items: [{ profile_id: 'p1', title: 'Severance', poster_path: '/sev.jpg', saison: 2, episode: 3, next_air: '2026-11-10' }],
    profiles: [{ id: 'p1', account_id: 'u1' }],
    users: { u1: { email: 'lea@exemple.fr', user_metadata: { lang: 'fr' } } },
  });
  const digest = require('../api/notifications-digest.js');
  const r = await call(digest, { method: 'GET', headers: { host: 'cinepisode.com', authorization: 'Bearer cron_fake' } });
  assert.deepStrictEqual(r.body, { sent: 1 });
  const batch = calls.find(c => c.url.endsWith('/emails/batch'));
  assert.strictEqual(batch.body.length, 1);
  const mail = batch.body[0];
  assert.deepStrictEqual(mail.to, ['lea@exemple.fr']);
  assert.match(mail.subject, /sorties/);
  assert.match(mail.html, /Severance/);
  assert.match(mail.html, /image\.tmdb\.org\/t\/p\/w92\/sev\.jpg/);
  assert.match(mail.html, /S2 E3/);
  assert.match(mail.html, /1 sortie cette semaine/);
  assert.match(mail.html, /mar\. 10 nov\./i);
  assert.match(mail.html, /cinepisode\.com\/#notifications/);
  assert.doesNotMatch(mail.html + mail.text, /\{\{|\[\[/);
});

test('notifications-digest : utilisateur sans profil ignoré, pas d\'exception', async () => {
  reset();
  process.env.CRON_SECRET = 'cron_fake';
  global.fetch = digestFetchMock({
    prefs: [{ profile_id: 'p1' }],
    items: [{ profile_id: 'p1', title: 'Severance', poster_path: null, saison: null, episode: null, next_air: '2026-11-10' }],
    profiles: [],
  });
  const digest = require('../api/notifications-digest.js');
  const r = await call(digest, { method: 'GET', headers: { host: 'cinepisode.com', authorization: 'Bearer cron_fake' } });
  assert.deepStrictEqual(r.body, { sent: 0, reason: 'no_email' });
});

/* ---------- api/newsletter-sync.js ---------- */
function syncFetchMock({ users, contactStatus = 200, topicsStatus = 200 }) {
  return async (url, opts) => {
    opts = opts || {}; const u = String(url);
    calls.push({ url: u, method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body ? JSON.parse(opts.body) : null });
    if (u.endsWith('/auth/v1/user')) {
      const tok = String(opts.headers.Authorization || '').replace('Bearer ', '');
      return users[tok] ? resp(200, { id: tok, email: tok + '@ex.com', email_confirmed_at: '2026-10-01T00:00:00Z' }) : resp(401, {});
    }
    const m = u.match(/\/auth\/v1\/admin\/users\/(.+)$/);
    if (m) return users[decodeURIComponent(m[1])] ? resp(200, users[decodeURIComponent(m[1])]) : resp(404, {});
    if (u === 'https://api.resend.com/contacts') return resp(contactStatus, { id: 'c1' });
    if (/\/contacts\/.+\/topics$/.test(u)) return resp(topicsStatus, {});
    throw new Error('URL inattendue ' + u);
  };
}
function postCall(handler, tok, body) {
  return call(handler, { method: 'POST', headers: { authorization: 'Bearer ' + tok, host: 'cinepisode.com', origin: 'https://cinepisode.com' }, body: JSON.stringify(body) });
}

test('newsletter-sync : méthode, session, configuration', async () => {
  reset();
  const common = require('../api/_lib/common');
  common._authCache.clear();
  delete process.env.RESEND_NEWSLETTER_TOPIC_ID;
  global.fetch = syncFetchMock({ users: { 'u.ok.tok': { id: 'u.ok.tok', email: 'lea@exemple.fr' } } });
  const sync = require('../api/newsletter-sync.js');
  assert.strictEqual((await call(sync, { method: 'GET' })).status, 405);
  assert.strictEqual((await postCall(sync, 'u.bad.tok', { enabled: true })).status, 401);
  assert.deepStrictEqual((await postCall(sync, 'u.ok.tok', { enabled: true })).body, { synced: false, reason: 'not_configured' });
});

test('newsletter-sync : activation -> contact créé + opt_in ; désactivation -> opt_out', async () => {
  reset();
  process.env.RESEND_NEWSLETTER_TOPIC_ID = 'topic_newsletter';
  const common = require('../api/_lib/common');
  common._authCache.clear();
  global.fetch = syncFetchMock({ users: { 'u.ok.tok': { id: 'u.ok.tok', email: 'lea@exemple.fr' } } });
  const sync = require('../api/newsletter-sync.js');

  assert.deepStrictEqual((await postCall(sync, 'u.ok.tok', { enabled: true })).body, { synced: true });
  const topicsCall1 = calls.filter(c => /\/topics$/.test(c.url)).pop();
  assert.deepStrictEqual(topicsCall1.body, { topics: [{ id: 'topic_newsletter', subscription: 'opt_in' }] });
  const contactCall = calls.find(c => c.url === 'https://api.resend.com/contacts');
  assert.strictEqual(contactCall.body.email, 'lea@exemple.fr');

  common._authCache.clear();
  assert.deepStrictEqual((await postCall(sync, 'u.ok.tok', { enabled: false })).body, { synced: true });
  const topicsCall2 = calls.filter(c => /\/topics$/.test(c.url)).pop();
  assert.deepStrictEqual(topicsCall2.body, { topics: [{ id: 'topic_newsletter', subscription: 'opt_out' }] });
});

test('newsletter-sync : échec Resend -> 503', async () => {
  reset();
  process.env.RESEND_NEWSLETTER_TOPIC_ID = 'topic_newsletter';
  const common = require('../api/_lib/common');
  common._authCache.clear();
  global.fetch = syncFetchMock({ users: { 'u.ok.tok': { id: 'u.ok.tok', email: 'lea@exemple.fr' } }, topicsStatus: 500 });
  const sync = require('../api/newsletter-sync.js');
  const r = await postCall(sync, 'u.ok.tok', { enabled: true });
  assert.strictEqual(r.status, 503);
});

test('Réglages : un échec de chargement des préférences ne relance pas une boucle de rendu du panneau', async () => {
  const vm = require('node:vm');
  let rpcCalls = 0, renders = 0, now = 1e12;
  const ctx = {
    Promise, Date: { now: () => now }, authProfileId: 'p1', esc: s => s, t: k => k,
    supa: { rpc: () => { rpcCalls++; return Promise.resolve({ error: { code: 'XX000', message: 'boom' } }); } },
    renderSettingsMenu: () => { renders++; ctx._notifSection(0); },
    _secOpen: () => '', _secTitle: () => '', _delegatedToggleRow: () => '',
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/40-notifications.js'), 'utf8') + '\nthis._notifSection=_notifSection;', ctx);
  assert.strictEqual(ctx._notifSection(0), '');
  await new Promise(r => setTimeout(r, 20));
  assert.strictEqual(rpcCalls, 1);
  assert.strictEqual(renders, 0, 'échec : pas de nouveau rendu (avant : rendu → nouvel essai → rendu… en boucle)');
  ctx._notifSection(0); await new Promise(r => setTimeout(r, 5));
  assert.strictEqual(rpcCalls, 1, 'pas de nouvel essai dans la minute');
  now += 61000; ctx._notifSection(0); await new Promise(r => setTimeout(r, 5));
  assert.strictEqual(rpcCalls, 2, 'nouvel essai après une minute');
});
