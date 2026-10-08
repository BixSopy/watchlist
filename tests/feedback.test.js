'use strict';
/*
 * « Donner mon avis » : fonction /api/feedback (fetch simulé, aucun appel réseau réel),
 * câblage de la fenêtre (menu de l'app, pied de la page d'accueil, bouton retour), migration
 * et politique de confidentialité. Parcours dans un vrai navigateur : e2e/feedback.test.mjs.
 * Lancer : node --test tests/
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

const FAKE_ANON = 'sb_publishable_fake_anon';
const FAKE_SECRET = 'sb_secret_fake_service_key_0123';
const FAKE_RESEND = 're_fake_resend_key_0123456789';
const GOOD = 'aaaa.bbbb.good';
process.env.SUPABASE_ANON_KEY = FAKE_ANON;
process.env.SUPABASE_URL = 'https://example.supabase.co';

const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36';
const IP = '203.0.113.42';

let calls, rpc;
function resp(status, body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return { status, ok: status >= 200 && status < 300, text: async () => text, json: async () => JSON.parse(text) };
}
global.fetch = async (url, opts) => {
  opts = opts || {};
  const u = String(url);
  calls.push({ url: u, opts, body: opts.body ? JSON.parse(opts.body) : null });
  if (u === 'https://example.supabase.co/auth/v1/user') {
    const tok = String((opts.headers || {}).Authorization || '').replace(/^Bearer /, '');
    return tok === GOOD ? resp(200, { id: 'u1', email: 'moi@example.com', email_confirmed_at: '2026-10-01T00:00:00Z' }) : resp(401, {});
  }
  if (u === 'https://example.supabase.co/rest/v1/rpc/submit_feedback') {
    if ((opts.headers || {}).apikey !== FAKE_SECRET) return resp(401, {});
    return rpc();
  }
  if (u === 'https://example.supabase.co/rest/v1/rpc/feedback_mark_notified') return resp(204, '');
  if (u === 'https://api.resend.com/emails') {
    if ((opts.headers || {}).Authorization !== 'Bearer ' + FAKE_RESEND) return resp(401, {});
    return resend();
  }
  return resp(404, {});
};
let resend;

const feedback = require('../api/feedback');

function call({ method = 'POST', body, headers = {}, ip = IP, token } = {}) {
  return new Promise((resolve) => {
    const h = Object.assign({ 'content-type': 'application/json', host: 'cinepisode.com', origin: 'https://cinepisode.com',
      'user-agent': UA_ANDROID, 'x-real-ip': ip }, headers);
    if (token) h.authorization = 'Bearer ' + token;
    for (const k of Object.keys(h)) if (h[k] == null) delete h[k];
    const req = { method, url: '/api/feedback', headers: h, body: body === undefined ? undefined : body };
    const out = { headers: {}, statusCode: 200 };
    const res = {
      set statusCode(v) { out.statusCode = v; }, get statusCode() { return out.statusCode; },
      setHeader(k, v) { out.headers[k.toLowerCase()] = String(v); },
      end(b) { out.body = b == null ? '' : String(b); out.json = (() => { try { return JSON.parse(out.body); } catch (e) { return null; } })(); resolve(out); },
    };
    feedback(req, res);
  });
}
const valid = (o) => Object.assign({ kind: 'bug', message: 'Le bouton « Épisode suivant » ne fait rien sur la fiche.', reply_email: 'Moi@Example.com',
  locale: 'fr', page: '/', context: 'app', standalone: true, website: '', elapsed: 8000 }, o || {});
const rpcCalls = () => calls.filter(c => c.url.endsWith('/rpc/submit_feedback'));
const mails = () => calls.filter(c => c.url === 'https://api.resend.com/emails');
function noLeak(out) {
  const all = out.body + JSON.stringify(out.headers);
  for (const s of [FAKE_SECRET, FAKE_RESEND, FAKE_ANON]) assert.ok(!all.includes(s), 'secret dans la réponse');
}

test.beforeEach(() => {
  calls = [];
  rpc = () => resp(200, { status: 'ok', id: '0b6f8c3e-0000-4000-8000-000000000001', notify: true });
  resend = () => resp(200, { id: 'email_1' });
  process.env.SUPABASE_SECRET_KEY = FAKE_SECRET;
  process.env.RESEND_API_KEY = FAKE_RESEND;
  process.env.VERCEL_GIT_COMMIT_SHA = '0123456789abcdef';
  delete process.env.FEEDBACK_TO; delete process.env.FEEDBACK_FROM;
  feedback._reset();
});

test('méthode, type de contenu et origine contrôlés', async () => {
  assert.strictEqual((await call({ method: 'GET' })).statusCode, 405);
  assert.strictEqual((await call({ body: valid(), headers: { 'content-type': 'text/plain' } })).statusCode, 415);
  assert.strictEqual((await call({ body: valid(), headers: { origin: 'https://evil.example' } })).statusCode, 403);
  assert.strictEqual((await call({ body: '{pas du json', headers: {} })).statusCode, 400);
  assert.strictEqual((await call({ body: 'x'.repeat(20000) })).statusCode, 413);
  assert.strictEqual(calls.length, 0, 'rien n\'est appelé');
});

test('robots : champ piège rempli ou envoi trop rapide → « ok » sans rien enregistrer ni envoyer', async () => {
  const a = await call({ body: valid({ website: 'https://spam.example' }) });
  assert.strictEqual(a.statusCode, 200); assert.deepStrictEqual(a.json, { ok: true });
  const b = await call({ body: valid({ elapsed: 300 }) });
  assert.strictEqual(b.statusCode, 200);
  const c = await call({ body: valid({ elapsed: undefined }) });
  assert.strictEqual(c.statusCode, 200);
  assert.strictEqual(calls.length, 0, 'ni base ni email');
});

test('validation : type, longueur du message, email de réponse', async () => {
  for (const [o, field] of [[{ kind: 'spam' }, 'kind'], [{ message: '  a ' }, 'message'], [{ message: 'x'.repeat(2001) }, 'message'],
    [{ message: 42 }, 'message'], [{ reply_email: 'pas-un-email' }, 'reply_email'], [{ reply_email: 'a@b.c'.padStart(260, 'x') }, 'reply_email']]) {
    feedback._reset();
    const r = await call({ body: valid(o) });
    assert.strictEqual(r.statusCode, 400, JSON.stringify(o).slice(0, 60));
    assert.strictEqual(r.json.error, 'invalid');
    assert.match(r.json.message, new RegExp(field));
  }
  assert.strictEqual(calls.length, 0);
  assert.deepStrictEqual(feedback._validate(valid({ message: 'x'.repeat(2000) })).ok, true, '2 000 caractères acceptés');
  assert.strictEqual(feedback._validate(valid({ message: '😀'.repeat(2000) })).ok, true, 'compté en caractères, pas en unités UTF-16');
});

test('envoi sans compte : base (clé secrète, empreinte d\'IP) puis email Resend, sans fuite', async () => {
  const r = await call({ body: valid() });
  assert.strictEqual(r.statusCode, 200); assert.deepStrictEqual(r.json, { ok: true });
  assert.strictEqual(r.headers['cache-control'], 'no-store');
  noLeak(r);
  const [s] = rpcCalls();
  assert.ok(s, 'submit_feedback appelée');
  assert.strictEqual(s.opts.headers.apikey, FAKE_SECRET);
  assert.strictEqual(s.body.p_account_id, null);
  assert.strictEqual(s.body.p_kind, 'bug');
  assert.strictEqual(s.body.p_reply_email, 'moi@example.com');
  assert.strictEqual(s.body.p_page, 'app:/ (pwa)');
  assert.strictEqual(s.body.p_locale, 'fr');
  assert.strictEqual(s.body.p_app_version, '0123456');
  assert.strictEqual(s.body.p_user_agent, 'Chrome 154 · Android');
  assert.match(s.body.p_ip_hash, /^[0-9a-f]{32}$/);
  assert.ok(!JSON.stringify(s.body).includes(IP), 'IP jamais envoyée en clair');
  const [m] = mails();
  assert.ok(m, 'email envoyé');
  assert.match(m.body.subject, /^\[Cinepisode\] Avis · Bug · Le bouton/);
  assert.strictEqual(m.body.from, 'Cinepisode <noreply@cinepisode.com>');
  assert.deepStrictEqual(m.body.to, ['contact@cinepisode.com']);
  assert.strictEqual(m.body.reply_to, 'moi@example.com');
  assert.match(m.body.text, /Type : Bug/);
  assert.match(m.body.text, /Compte : sans compte/);
  assert.match(m.body.text, /0b6f8c3e-0000-4000-8000-000000000001/);
  assert.ok(m.body.text.includes('Le bouton « Épisode suivant » ne fait rien sur la fiche.'));
  assert.ok(!m.body.html, 'texte brut uniquement');
  assert.strictEqual(m.opts.headers['Idempotency-Key'], 'feedback-0b6f8c3e-0000-4000-8000-000000000001');
  assert.ok(calls.some(c => c.url.endsWith('/rpc/feedback_mark_notified') && c.body.p_id === '0b6f8c3e-0000-4000-8000-000000000001'), 'notification enregistrée');
});

test('envoi connecté : le compte vient de la session vérifiée ; jeton expiré = envoi anonyme', async () => {
  let r = await call({ body: valid(), token: GOOD });
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(rpcCalls()[0].body.p_account_id, 'u1');
  assert.match(mails()[0].body.text, /Compte : connecté/);
  calls = []; feedback._reset();
  r = await call({ body: valid({ account_id: 'u2', p_account_id: 'u2' }), token: 'aaaa.bbbb.expired' });
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(rpcCalls()[0].body.p_account_id, null, 'aucun identifiant de compte accepté depuis le corps');
});

test('sans email de réponse : pas de Reply-To, objet sur une ligne même si le message en a plusieurs', async () => {
  const r = await call({ body: valid({ kind: 'idea', reply_email: '', message: 'Ligne 1\r\nLigne 2\n\nLigne 3' }) });
  assert.strictEqual(r.statusCode, 200);
  const m = mails()[0].body;
  assert.ok(!('reply_to' in m));
  assert.strictEqual(m.subject, '[Cinepisode] Avis · Idée · Ligne 1 Ligne 2 Ligne 3');
  assert.match(m.text, /aucune adresse donnée/);
  assert.strictEqual(rpcCalls()[0].body.p_reply_email, null);
  assert.strictEqual(rpcCalls()[0].body.p_message, 'Ligne 1\nLigne 2\n\nLigne 3');
});

test('limites en base : rate_limited → 429, aucun email ; plafond d\'emails atteint → enregistré sans email', async () => {
  rpc = () => resp(200, { status: 'rate_limited', scope: 'ip' });
  const r = await call({ body: valid() });
  assert.strictEqual(r.statusCode, 429); assert.strictEqual(r.json.error, 'rate_limited');
  assert.strictEqual(mails().length, 0);
  calls = []; feedback._reset();
  rpc = () => resp(200, { status: 'ok', id: '0b6f8c3e-0000-4000-8000-000000000002', notify: false });
  const r2 = await call({ body: valid() });
  assert.strictEqual(r2.statusCode, 200);
  assert.strictEqual(mails().length, 0, 'pas d\'email au-delà du plafond quotidien');
});

test('rafales : 4e envoi en une minute depuis la même IP refusé avant toute requête', async () => {
  for (let i = 0; i < 3; i++) assert.strictEqual((await call({ body: valid() })).statusCode, 200);
  const before = calls.length;
  const r = await call({ body: valid() });
  assert.strictEqual(r.statusCode, 429);
  assert.ok(r.headers['retry-after']);
  assert.strictEqual(calls.length, before, 'ni base ni email');
  assert.strictEqual((await call({ body: valid(), ip: '198.51.100.7' })).statusCode, 200, 'une autre IP passe');
});

test('pannes : migration absente → email quand même ; email en échec → avis gardé ; rien ne marche → 503', async () => {
  rpc = () => resp(404, { code: 'PGRST202' });
  let r = await call({ body: valid() });
  assert.strictEqual(r.statusCode, 200);
  assert.match(mails()[0].body.text, /non enregistré en base/);
  calls = []; feedback._reset();
  rpc = () => resp(200, { status: 'ok', id: '0b6f8c3e-0000-4000-8000-000000000003', notify: true });
  resend = () => resp(500, {});
  r = await call({ body: valid() });
  assert.strictEqual(r.statusCode, 200, 'avis enregistré même si l\'email échoue');
  assert.ok(!calls.some(c => c.url.endsWith('/rpc/feedback_mark_notified')));
  calls = []; feedback._reset();
  delete process.env.SUPABASE_SECRET_KEY; delete process.env.RESEND_API_KEY;
  r = await call({ body: valid() });
  assert.strictEqual(r.statusCode, 503); assert.strictEqual(r.json.error, 'unavailable');
  noLeak(r);
});

test('sans clé secrète : email seul, destinataire et expéditeur configurables', async () => {
  delete process.env.SUPABASE_SECRET_KEY;
  process.env.FEEDBACK_TO = 'avis@cinepisode.com';
  process.env.FEEDBACK_FROM = 'Cinepisode Avis <avis@cinepisode.com>';
  const r = await call({ body: valid() });
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(rpcCalls().length, 0);
  assert.deepStrictEqual(mails()[0].body.to, ['avis@cinepisode.com']);
  assert.strictEqual(mails()[0].body.from, 'Cinepisode Avis <avis@cinepisode.com>');
});

test('navigateur résumé, empreinte d\'IP du jour', () => {
  const ua = feedback._shortUserAgent;
  assert.strictEqual(ua(UA_ANDROID), 'Chrome 154 · Android');
  assert.strictEqual(ua('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'), 'Safari 18 · iOS');
  assert.strictEqual(ua('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0'), 'Firefox 140 · Windows');
  assert.strictEqual(ua('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36 Edg/154.0.0.0'), 'Edge 154 · macOS');
  assert.strictEqual(ua(''), null);
  process.env.SUPABASE_SECRET_KEY = FAKE_SECRET;
  const d1 = Date.UTC(2026, 9, 8, 12), d2 = Date.UTC(2026, 9, 9, 12);
  const h = feedback._ipHash;
  assert.strictEqual(h(IP, d1), h(IP, d1));
  assert.notStrictEqual(h(IP, d1), h(IP, d2), 'change chaque jour');
  assert.notStrictEqual(h(IP, d1), h('203.0.113.43', d1));
  assert.match(h(IP, d1), /^[0-9a-f]{32}$/);
});

/* ---------- Câblage de l'interface ---------- */
const HTML = read('index.html');
const LANDING = HTML.slice(HTML.indexOf('<div class="lp" id="landing">'), HTML.indexOf('<!-- /PAGE D\'ACCUEIL -->'));

test('fenêtre : hors de la page d\'accueil, dialogue accessible, formulaire rendu par le script', () => {
  const at = HTML.indexOf('id="fbMbk"');
  assert.ok(at > HTML.indexOf('<!-- /PAGE D\'ACCUEIL -->'), 'fenêtre au niveau du document (accueil et app)');
  assert.match(HTML, /<div class="mbk" id="fbMbk" role="dialog" aria-modal="true" aria-labelledby="fbTitle">/);
  assert.match(HTML, /data-click="closeFeedback" aria-label="Fermer"/);
  const at24 = HTML.indexOf('<script src="js/24-feedback.js"></script>');
  assert.ok(at24 > HTML.indexOf('<script src="js/23-landing.js"></script>') && at24 > HTML.indexOf('<script src="js/22-modal-history.js"></script>'));
  const js = read('js/24-feedback.js');
  assert.match(js, /<form novalidate/);
  assert.match(js, /id="fbWebsite" name="website" tabindex="-1"/, 'champ piège hors du parcours clavier');
  assert.match(js, /maxlength="'\+FB_MAX\+'"/);
  assert.match(js, /fetch\('\/api\/feedback'/);
  assert.doesNotMatch(js, /https?:\/\//, 'aucune adresse externe');
  assert.doesNotMatch(js, /localStorage|sessionStorage|indexedDB/, 'brouillon en mémoire seulement');
});

test('entrées : menu de l\'app et pied de la page d\'accueil ; actions déclarées ; bouton retour', () => {
  assert.match(HTML, /<button class="opt-btn" data-click="menuFeedback">[\s\S]{0,400}data-i18n="fb\.menu"/);
  assert.match(LANDING, /<footer class="lp-foot">[\s\S]*data-click="openFeedback" data-args="\[&quot;landing&quot;\]"[\s\S]*<\/footer>/);
  const acts = read('js/00-actions.js');
  for (const a of ['menuFeedback', 'openFeedback', 'closeFeedback', 'fbKind', 'fbInput', 'fbEmail']) assert.match(acts, new RegExp("uiOn\\('" + a + "'"), a);
  assert.match(read('js/22-modal-history.js'), /\{id:'fbMbk',cls:'on',close:/);
});

test('textes FR/EN, mentions de confidentialité (24 mois, suppression sur demande, IP)', () => {
  const vm = require('node:vm');
  const ctx = { window: {} }; vm.createContext(ctx);
  for (const l of ['fr', 'en']) vm.runInContext(read('js/i18n/' + l + '.js'), ctx);
  const D = ctx.window.I18N_DICTS;
  for (const k of ['fb.menu', 'fb.title', 'fb.kind_idea', 'fb.kind_bug', 'fb.kind_other', 'fb.ph_bug', 'fb.privacy', 'fb.err.rate', 'fb.done.title']) {
    assert.ok(D.fr[k] && D.en[k], k);
  }
  assert.strictEqual(D.fr['fb.menu'], 'Donner mon avis');
  assert.strictEqual(D.en['fb.menu'], 'Send feedback');
  assert.match(D.fr['fb.privacy'], /24 mois/); assert.match(D.en['fb.privacy'], /24 months/);
  for (const [f, re] of [['confidentialite.html', /Donner mon avis[\s\S]*24 mois[\s\S]*2 jours[\s\S]*suppression/],
    ['privacy.html', /Send feedback[\s\S]*24 months[\s\S]*2 days[\s\S]*deleting feedback/]]) assert.match(read(f), re, f);
});

test('migration : RLS sans politique, aucun droit client, fonctions réservées au serveur', () => {
  const sql = read('supabase/migrations/20261008210000_feedback.sql');
  assert.match(sql, /alter table public\.feedback enable row level security/);
  assert.match(sql, /revoke all on table public\.feedback from public, anon, authenticated/);
  assert.doesNotMatch(sql, /create policy/i);
  assert.doesNotMatch(sql, /grant [^;]* to [^;]*\b(anon|authenticated)\b/i);
  assert.match(sql, /grant execute on function public\.submit_feedback\([^)]*\) to service_role/);
  assert.match(sql, /interval '24 months'/);
  assert.ok(read('supabase/schema.sql').includes('MIGRATION 20261008210000_feedback.sql'));
  assert.match(read('.vercelignore'), /^!api$/m);
});
