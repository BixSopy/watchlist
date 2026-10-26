'use strict';
/* Social étape 1 : pseudo, amis, invitations. Base : supabase/tests/80_social.test.sql. Lancer : node --test tests/ */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
global.window = global; global.document = global.document || { addEventListener() {}, documentElement: { className: '' } };
if (!global.document.addEventListener) global.document.addEventListener = () => {};
const H = require(path.join(ROOT, 'js', '32-handle.js'));

test('pseudo : normalisation (minuscules, sans @, accents, espaces)', () => {
  assert.strictEqual(H.handleNormalize('  @Pierre Émile '), 'pierre_emile');
  assert.strictEqual(H.handleNormalize('Zoé-Lou!!'), 'zoe_lou');
  assert.strictEqual(H.handleNormalize('a'.repeat(30)).length, 20);
});
test('pseudo : format identique à la contrainte SQL', () => {
  for (const ok of ['abc', 'pierre.u', 'p_1', 'a'.repeat(20)]) assert.ok(H.handleValid(ok), ok);
  for (const ko of ['ab', '.abc', 'abc.', 'a..b', 'ABC', 'a-b', 'a'.repeat(21), 'é_ab']) assert.ok(!H.handleValid(ko), ko);
  assert.strictEqual(H.handleFormatError('ab'), 'handle.err.short');
  assert.strictEqual(H.handleFormatError('.abc'), 'handle.err.dot');
  assert.strictEqual(H.handleFormatError('abc'), null);
  const sql = read('supabase/migrations/20261026120000_social_pseudo_amis.sql');
  assert.match(sql, /\[a-z0-9\._\]\{3,20\}|\[a-z0-9._\]\{3,20\}/);
});
test('pseudo : proposition tirée de l\'email, toujours valide', () => {
  assert.strictEqual(H.handleSuggestFrom('Pierre.Unbekand@gmail.com'), 'pierre.unbekand');
  for (const e of ['a@b.c', '.x.@y', '', 'jo..e@x']) assert.ok(H.handleValid(H.handleSuggestFrom(e)), e);
});
test('migration absente : l\'interface sociale reste masquée', () => {
  assert.ok(H.socialUnavailable({ code: 'PGRST202' }));
  assert.ok(!H.socialUnavailable({ code: '42501' }));
  assert.ok(!H.socialUnavailable(null));
});
test('pseudo demandé avant la fenêtre d\'accueil', () => {
  assert.match(read('js/28-pairing.js'), /handleOnboardFirst\(showOnboarding\)/);
});

/* ---- Amis, invitation (js/33-friends.js, api/invite.js) ---- */
global.location = { search: '', pathname: '/', hash: '', origin: 'https://example.test' };
global.sessionStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
global.history = { replaceState() {} };
global.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const F = require(path.join(ROOT, 'js', '33-friends.js'));
const invite = require(path.join(ROOT, 'api', 'invite.js'));

test('lien d\'invitation : /u/<pseudo>?i=<code>', () => {
  assert.strictEqual(F.friendInviteUrl('pierre.u', 'Ab12Cd34Ef56', 'https://x.test'), 'https://x.test/u/pierre.u?i=Ab12Cd34Ef56');
});
test('paramètres ?ami=&i= : validés avant tout envoi', () => {
  assert.deepStrictEqual(F.friendPendingParse('?ami=Pierre.U&i=Ab12Cd34Ef56'), { handle: 'pierre.u', code: 'Ab12Cd34Ef56' });
  assert.strictEqual(F.friendPendingParse('?ami=pierre&i=short'), null);
  assert.strictEqual(F.friendPendingParse('?ami=<x>&i=Ab12Cd34Ef56'), null);
  assert.strictEqual(F.friendPendingParse(''), null);
});
test('avatar : couleur et texte échappés', () => {
  const h = F.friendAvatar({ name: '<b>', avatar_color: 'red;x:y' });
  assert.ok(!h.includes('<b>') && h.includes('#5cc8ff'));
});
test('page /u/ : aucune requête sans code valide', async () => {
  let called = 0; const f = async () => { called++; return { ok: true, json: async () => null }; };
  assert.strictEqual(await invite._fetchInvite('pierre', '', f), null);
  assert.strictEqual(await invite._fetchInvite('pierre', 'bad', f), null);
  assert.strictEqual(called, 0);
});
function fakeRes() { const r = { h: {}, body: '', setHeader(k, v) { r.h[k.toLowerCase()] = v; }, end(b) { r.body = b || ''; } }; return r; }
test('page /u/ : code faux ou inconnu → même page neutre, noindex', async () => {
  const res = fakeRes();
  await invite({ method: 'GET', url: '/api/invite?h=pierre&i=Ab12Cd34Ef56', headers: {} }, res, { fetch: async () => ({ ok: true, json: async () => null }) });
  assert.strictEqual(res.statusCode, 200);
  assert.match(res.h['x-robots-tag'], /noindex/);
  assert.match(res.body, /Demande le lien/);
  assert.ok(!res.body.includes('pierre'));
});
test('page /u/ : bon code → avatar, nom et « Ajouter X » seulement, tout échappé', async () => {
  const res = fakeRes();
  const d = { handle: 'pierre', name: 'Pi<script>', avatar: null, avatar_color: '#ff0000' };
  await invite({ method: 'GET', url: '/api/invite?h=pierre&i=Ab12Cd34Ef56', headers: { 'accept-language': 'en-US' } }, res, { fetch: async () => ({ ok: true, json: async () => d }) });
  assert.match(res.body, /Add Pi&lt;script&gt;/);
  assert.match(res.body, /href="\/\?ami=pierre&amp;i=Ab12Cd34Ef56"/);
  assert.ok(!res.body.includes('<script>'));
  assert.ok(!/image\.tmdb\.org/.test(res.body));
});
test('réécriture /u/:handle et QR code local (pas de service tiers)', () => {
  assert.match(read('vercel.json'), /"\/u\/:handle"/);
  const html = read('index.html');
  assert.ok(html.indexOf('src="/vendor/qrcode-generator-1.4.4.js" integrity="sha384-') > 0);
  assert.ok(html.indexOf('/vendor/qrcode-generator-1.4.4.js') < html.indexOf('<script src="js/33-friends.js"'));
  assert.match(read('vendor/qrcode-generator-1.4.4.js'), /MIT license/);
});

/* ---- Demandes et fiche d'un ami (js/34-friend-requests.js) ---- */
global.t = (k, v) => k + (v ? JSON.stringify(v) : ''); global.tn = (k, n) => k + ':' + n;
global.uiAct = (n, a) => ' data-click="' + n + '"' + (a ? ' data-args="' + esc(JSON.stringify(a)) + '"' : '');
global.friendAvatar = F.friendAvatar; global.friendName = p => (p && p.name) || '@' + (p && p.handle);
global.SOCIAL = { me: { handle: 'moi' } };
const R = require(path.join(ROOT, 'js', '34-friend-requests.js'));
test('demande reçue : boutons Accepter / Refuser, nom échappé', () => {
  const h = R.friendsIncomingHtml([{ id: 'r1', handle: 'zoe', name: '<img>' }]);
  assert.match(h, /friendRespond/); assert.ok(!h.includes('<img>'));
  assert.match(h, /\[&quot;r1&quot;,true\]/); assert.match(h, /\[&quot;r1&quot;,false\]/);
});
test('fiche d\'un ami : liste privée, onglets, affiches validées', () => {
  assert.match(R.friendViewHtml({ handle: 'zoe' }, { show_list: false, items: [] }), /friends\.private/);
  R.FRIEND_VIEW.tab = 'encours';
  const h = R.friendViewHtml({ handle: 'zoe' }, { show_list: true, items: [
    { status: 'encours', title: 'A<b>', poster_path: '/ok.jpg', season: 2, episode: 3 },
    { status: 'encours', title: 'B', poster_path: 'javascript:x' }, { status: 'avoir', title: 'C' }] });
  assert.match(h, /S2 E3/); assert.ok(!h.includes('A<b>')); assert.ok(!h.includes('javascript:'));
  assert.match(h, /friends\.tab\.avoir <em>1<\/em>/);
});
test('refus, retrait et blocage silencieux côté base', () => {
  const sql = read('supabase/migrations/20261026120000_social_pseudo_amis.sql');
  assert.match(sql, /status = 'declined'/);
  assert.match(sql, /r\.from_profile = p_profile_id and r\.expires_at > now\(\)/); /* l'expéditeur voit toujours « en attente » */
});
