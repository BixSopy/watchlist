'use strict';
/*
 * Email de bienvenue : /api/welcome (fetch simulé, aucun envoi réel), idempotence via
 * app_metadata, comptes anciens ignorés, gabarits générés. Lancer : node --test tests/
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.SUPABASE_ANON_KEY = 'sb_publishable_fake';
process.env.SUPABASE_URL = 'https://example.supabase.co';
const SECRET = 'sb_secret_fake_0123';

let calls, users, resendStatus;
function resp(status, body) { const t = JSON.stringify(body); return { status, ok: status < 300, text: async () => t, json: async () => JSON.parse(t) }; }
global.fetch = async (url, opts) => {
  opts = opts || {}; const u = String(url);
  calls.push({ url: u, method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body ? JSON.parse(opts.body) : null });
  if (u.endsWith('/auth/v1/user')) {
    const tok = String(opts.headers.Authorization || '').replace('Bearer ', '');
    return users[tok] ? resp(200, { id: tok, email: tok + '@ex.com', email_confirmed_at: '2026-10-01T00:00:00Z' }) : resp(401, {});
  }
  const m = u.match(/\/auth\/v1\/admin\/users\/(.+)$/);
  if (m) {
    if (opts.headers.apikey !== SECRET) return resp(401, {});
    const usr = users[decodeURIComponent(m[1])];
    if (opts.method === 'PUT') { usr.app_metadata = Object.assign({}, usr.app_metadata, JSON.parse(opts.body).app_metadata); }
    return resp(200, usr);
  }
  if (u === 'https://api.resend.com/emails') return resp(resendStatus, { id: 'x' });
  throw new Error('URL inattendue ' + u);
};
const welcome = require('../api/welcome.js');
const common = require('../api/_lib/common');

function call(tok) {
  return new Promise((resolve) => {
    const res = { headers: {}, statusCode: 0, setHeader(k, v) { this.headers[k] = v; }, end(b) { resolve({ status: this.statusCode, body: JSON.parse(b) }); } };
    welcome({ method: 'POST', headers: { authorization: 'Bearer ' + tok, host: 'cinepisode.com', origin: 'https://cinepisode.com' } }, res);
  });
}
function reset() {
  calls = []; resendStatus = 200; common._authCache.clear();
  process.env.RESEND_API_KEY = 're_fake'; process.env.SUPABASE_SECRET_KEY = SECRET;
  const now = new Date().toISOString();
  users = {
    'a.b.new': { id: 'a.b.new', email: 'new@ex.com', created_at: now, app_metadata: { provider: 'email' }, user_metadata: { lang: 'en' } },
    'a.b.old': { id: 'a.b.old', email: 'old@ex.com', created_at: '2026-01-01T00:00:00Z', app_metadata: {} },
    'a.b.fr': { id: 'a.b.fr', email: 'fr@ex.com', created_at: now, app_metadata: {} },
  };
}
const resendCalls = () => calls.filter(c => c.url.includes('resend'));

test('nouveau compte : un seul email, même si on rappelle', async () => {
  reset();
  assert.deepStrictEqual((await call('a.b.new')).body, { sent: true });
  const r = resendCalls();
  assert.strictEqual(r.length, 1);
  assert.deepStrictEqual(r[0].body.to, ['new@ex.com']);
  assert.strictEqual(r[0].body.reply_to, 'contact@cinepisode.com');
  assert.strictEqual(r[0].headers['Idempotency-Key'], 'welcome-a.b.new');
  assert.match(r[0].body.subject, /^Welcome/);
  assert.match(r[0].body.html, /chromewebstore\.google\.com\/detail\/hmoafofdaajkenkodmgbdjejbmkdjicc/);
  assert.doesNotMatch(r[0].body.html + r[0].body.text, /\{\{|\[\[/);
  assert.ok(users['a.b.new'].app_metadata.welcome_email_sent_at);
  assert.strictEqual(users['a.b.new'].app_metadata.provider, 'email', 'app_metadata existant conservé');
  assert.deepStrictEqual((await call('a.b.new')).body, { sent: false, reason: 'already_sent' });
  assert.strictEqual(resendCalls().length, 1);
});

test('français par défaut, contact présent', async () => {
  reset();
  await call('a.b.fr');
  const b = resendCalls()[0].body;
  assert.match(b.subject, /^Bienvenue/);
  assert.match(b.text, /contact@cinepisode\.com/);
  assert.match(b.text, /Détectés/);
});

test('compte ancien : rien n’est envoyé', async () => {
  reset();
  assert.deepStrictEqual((await call('a.b.old')).body, { sent: false, reason: 'old_account' });
  assert.strictEqual(resendCalls().length, 0);
});

test('échec Resend : marque retirée, nouvel essai possible', async () => {
  reset(); resendStatus = 500;
  assert.strictEqual((await call('a.b.fr')).status, 503);
  assert.ok(!users['a.b.fr'].app_metadata.welcome_email_sent_at);
  resendStatus = 200;
  assert.deepStrictEqual((await call('a.b.fr')).body, { sent: true });
});

test('sans configuration ou sans session', async () => {
  reset(); delete process.env.RESEND_API_KEY;
  assert.deepStrictEqual((await call('a.b.fr')).body, { sent: false, reason: 'not_configured' });
  reset();
  assert.strictEqual((await call('x.y.unknown')).status, 401);
});

test('l’app demande l’email après la création du profil', () => {
  const s = fs.readFileSync(path.join(ROOT, 'js/15-sync.js'), 'utf8');
  assert.match(s, /maybeSendWelcome\(user\);/);
  assert.match(s, /fetch\('\/api\/welcome'/);
});
