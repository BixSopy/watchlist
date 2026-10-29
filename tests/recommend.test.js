'use strict';
/* Social étape 3 : « Recommander à un ami ». Base SQL : supabase/tests/91_recommandations.test.sql. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

global.window = global;
global.t = (k, v) => k + (v ? JSON.stringify(v) : '');
global.tn = (k, n) => k + '#' + n;
global.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
global.uiAct = (n, a, ty) => ' data-' + (ty || 'click') + '="' + n + '"' + (a ? ' data-args="' + global.esc(JSON.stringify(a)) + '"' : '');
global.friendAvatar = p => '<span class="fr-av">' + global.esc((p && p.handle || '?').charAt(0)) + '</span>';
global.friendName = p => '@' + ((p && p.handle) || '');
global.IB = 'https://image.tmdb.org/t/p/';
global.SOCIAL = { available: true, me: { friends: [{ profile_id: 'f1', handle: 'lea' }, { profile_id: 'f2', handle: 'max' }] } };
global.authProfileId = 'p1';
global.toasts = [];
global.toast = (m, k) => global.toasts.push([m, k]);
global.sfx = () => {};
global.memDB = [{ tmdbId: 603, tmdbType: 'movie', title: 'Matrix' }];
const added = [];
global.addEntryFromTmdb = (sel, f) => added.push([sel, f]);

const R = require(path.join(ROOT, 'js', '38-recommend.js'));

test('caché sans la migration : RPC absente -> available=false, rien affiché', async () => {
  global.supa = { rpc: () => Promise.resolve({ error: { code: 'PGRST202' } }) };
  global.socialUnavailable = e => e && (e.code === 'PGRST202' || e.code === '42883');
  R.RECO.available = null;
  await R.recoLoad(true);
  assert.strictEqual(R.RECO.available, false);
  assert.strictEqual(R.recoEnabled(), false);
  assert.strictEqual(R.recoUnread(), 0);
  assert.strictEqual(R.recoInboxHtml(), '');
  assert.strictEqual(R.recoPrivRowHtml(), '');
  assert.strictEqual(R.recoPlexButton({ tmdbId: 1 }), null);
});

test('recoLoad : boîte, non-lus, préférence', async () => {
  R.RECO.available = null;
  global.supa = { rpc: (n) => Promise.resolve({ data: { status: 'ok', accept_recos: false, unread: 2, thanks: [], items: [{ id: 'r1', status: 'new', title: 'Dune', tmdb_id: 438631, tmdb_type: 'movie', from: { handle: 'lea' } }] } }) };
  await R.recoLoad(true);
  assert.strictEqual(R.RECO.available, true);
  assert.strictEqual(R.recoUnread(), 2);
  assert.strictEqual(R.RECO.accept, false);
  assert.match(R.recoPrivRowHtml(), /aria-checked="false"/);
});

test('recoFromPlex : normalise le titre, rejette une affiche douteuse', () => {
  const x = R.recoFromPlex({ tmdbId: '42', type: 'tv', title: 'Severance', year: 2022, poster: '/abc.jpg', item: { type: 'serie' } });
  assert.deepStrictEqual(x, { tmdb_id: 42, tmdb_type: 'tv', type: 'serie', title: 'Severance', year: '2022', poster_path: '/abc.jpg' });
  assert.strictEqual(R.recoFromPlex({ tmdbId: 1, type: 'movie', poster: 'https://evil/x.jpg' }).poster_path, null);
});

test('sélecteur : amis, message 140 max, bouton désactivé tant que personne', () => {
  R.RECO.pick = { title: { tmdb_id: 1, title: 'Dune', year: '2021', poster_path: null }, to: [], msg: '' };
  const h = R.recoPickHtml();
  assert.match(h, /@lea/); assert.match(h, /@max/);
  assert.match(h, /maxlength="140"/);
  assert.match(h, /id="rcSend" disabled/);
  assert.match(h, /reco\.tmdb/);
  R.RECO.pick.to = ['f1'];
  assert.match(R.recoPickHtml(), /reco\.sendTo#1/);
});

test('sélecteur sans amis : invitation', () => {
  const save = global.SOCIAL.me.friends; global.SOCIAL.me.friends = [];
  R.RECO.pick = { title: { tmdb_id: 1, title: 'Dune' }, to: [], msg: '' };
  assert.match(R.recoPickHtml(), /reco\.noFriends/);
  global.SOCIAL.me.friends = save;
});

test('recoSendResult : statuts du serveur', () => {
  assert.ok(R.recoSendResult('sent').ok);
  assert.strictEqual(R.recoSendResult('rate_limited').msg, 'reco.err.rate');
  assert.strictEqual(R.recoSendResult('message_too_long').msg, 'reco.err.long');
  assert.strictEqual(R.recoSendResult('weird').msg, 'reco.err.generic');
});

test('carte reçue : expéditeur, message échappé, actions', () => {
  const h = R.recoCardHtml({ id: 'r9', status: 'new', title: 'Dune', year: '2021', poster_path: '/d.jpg', message: '<b>wow</b>', from: { handle: 'lea' }, tmdb_id: 438631, tmdb_type: 'movie' }, 0);
  assert.match(h, /@lea/); assert.match(h, /&lt;b&gt;wow/); assert.doesNotMatch(h, /<b>wow/);
  assert.match(h, /recoRespond/); assert.match(h, /added/); assert.match(h, /dismissed/); assert.match(h, /thanks/);
  assert.match(h, /w342\/d\.jpg/);
});

test('déjà dans ma liste : pas de doublon à l\'ajout', () => {
  assert.strictEqual(R.recoInMyList({ tmdb_id: 603, tmdb_type: 'movie' }), true);
  assert.strictEqual(R.recoAddToMyList({ tmdb_id: 603, tmdb_type: 'movie', title: 'Matrix' }), false);
  assert.strictEqual(R.recoAddToMyList({ tmdb_id: 7, tmdb_type: 'tv', title: 'X', type: 'anime' }), true);
  assert.strictEqual(added.at(-1)[1].type, 'anime');
  assert.strictEqual(added.at(-1)[1].status, 'avoir');
});

test('export RGPD : null sans la migration', async () => {
  global.supa = { rpc: () => Promise.resolve({ error: { code: 'PGRST202' } }) };
  assert.strictEqual(await R.recoExportData('p1'), null);
  global.supa = { rpc: () => Promise.resolve({ data: { status: 'ok', sent: [], received: [], accept_recos: true } }) };
  assert.deepStrictEqual(await R.recoExportData('p1'), { sent: [], received: [], accept_recos: true });
});

test('câblage : script, actions, fiche, badge, onglet Activité, i18n FR/EN, mouvement réduit', () => {
  assert.match(read('index.html'), /<script src="js\/38-recommend\.js"><\/script>/);
  const a = read('js/00-actions.js');
  ['recoToggle', 'recoMsg', 'recoSend', 'recoRespond', 'recoPrivToggle'].forEach(n => assert.match(a, new RegExp("uiOn\\('" + n + "'")));
  assert.match(read('js/08-plex.js'), /recoPlexButton/);
  assert.match(read('js/33-friends.js'), /recoUnread/); assert.match(read('js/33-friends.js'), /recoInboxHtml/);
  assert.match(read('js/35-social-privacy.js'), /recoExportData/);
  const keys = (read('js/38-recommend.js').match(/t\('(reco\.[a-zA-Z.]*[a-zA-Z]|privacy\.recos(?:Sub)?)'/g) || []).map(s => s.slice(3, -1));
  ['fr', 'en'].forEach(l => { const d = read('js/i18n/' + l + '.js'); keys.forEach(k => assert.ok(d.includes('"' + k + '"') || d.includes('"' + k + '.one"'), l + ' ' + k)); });
  assert.match(read('index.html'), /prefers-reduced-motion:reduce\)\{\.rc-chips li/);
});
