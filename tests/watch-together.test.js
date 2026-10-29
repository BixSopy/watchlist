'use strict';
/* Social étape 3 : « On regarde quoi ? ». Base SQL : supabase/tests/91_recommandations.test.sql (bloc overlap). */
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
global.uiAct = (n, a) => ' data-click="' + n + '"' + (a ? ' data-args="' + global.esc(JSON.stringify(a)) + '"' : '');
global.friendAvatar = () => '<span class="fr-av"></span>';
global.friendName = p => '@' + ((p && p.handle) || '');
global.IB = 'https://image.tmdb.org/t/p/';
global.SOCIAL = { available: true, me: { friends: [{ profile_id: 'f1', handle: 'lea' }, { profile_id: 'f2', handle: 'max' }] } };
global.authProfileId = 'p1';
global.toast = () => {};
global.sfx = () => {};
global.document = { querySelector: () => null, getElementById: () => null };
global.socialUnavailable = e => e && (e.code === 'PGRST202' || e.code === '42883');

const W = require(path.join(ROOT, 'js', '39-watch-together.js'));

test('entrée cachée sans migration ou sans amis', () => {
  assert.match(W.wtEntryHtml(), /openWatchTogether/);
  W.WT.available = false; assert.strictEqual(W.wtEntryHtml(), ''); W.WT.available = null;
  const f = global.SOCIAL.me.friends; global.SOCIAL.me.friends = []; assert.strictEqual(W.wtEntryHtml(), ''); global.SOCIAL.me.friends = f;
});

test('filtre de durée : court < 100 min, long ≥ 100, inconnu gardé', () => {
  const rt = { 'movie:1': 95, 'movie:2': 150, 'tv:3': 45 };
  assert.ok(W.wtMatchDur({ tmdb_type: 'movie', tmdb_id: 1 }, 'short', rt));
  assert.ok(!W.wtMatchDur({ tmdb_type: 'movie', tmdb_id: 2 }, 'short', rt));
  assert.ok(W.wtMatchDur({ tmdb_type: 'movie', tmdb_id: 2 }, 'long', rt));
  assert.ok(W.wtMatchDur({ tmdb_type: 'tv', tmdb_id: 3 }, 'short', rt));
  assert.ok(W.wtMatchDur({ tmdb_type: 'movie', tmdb_id: 9 }, 'long', rt));
  assert.ok(W.wtMatchDur({ tmdb_type: 'movie', tmdb_id: 2 }, '', rt));
});

test('wtShuffled : même contenu, ne modifie pas l\'original', () => {
  const a = [1, 2, 3, 4, 5]; const b = W.wtShuffled(a, () => 0);
  assert.deepStrictEqual(a, [1, 2, 3, 4, 5]); assert.deepStrictEqual(b.slice().sort(), a);
});

test('choix des amis : 8 max, filtres valides seulement', () => {
  W.WT.to = []; for (let i = 0; i < 10; i++) W.wtToggle(null, null, 'x' + i);
  assert.strictEqual(W.WT.to.length, 8);
  W.wtFilter(null, null, 'kind', 'anime'); assert.strictEqual(W.WT.kind, 'anime');
  W.wtFilter(null, null, 'kind', 'drop table'); assert.strictEqual(W.WT.kind, 'anime');
  W.WT.to = []; W.WT.kind = '';
});

test('wtGo : appelle watch_together, applique la durée, amis masqués signalés', async () => {
  let call;
  global.supa = { rpc: (n, a) => { call = [n, a]; return Promise.resolve({ data: { status: 'ok', hidden: ['f2'], items: [
    { tmdb_id: 1, tmdb_type: 'movie', title: 'Court', n: 2 }, { tmdb_id: 2, tmdb_type: 'movie', title: 'Long', n: 3 }] } }); } };
  global.TB = '/api/tmdb';
  global.tf = url => Promise.resolve({ runtime: /\/movie\/1\?/.test(url) ? 90 : 170 });
  W.WT.to = ['f1', 'f2']; W.WT.dur = 'short'; W.WT.kind = 'film';
  W.wtGo(); await new Promise(r => setTimeout(r, 10));
  assert.strictEqual(call[0], 'watch_together');
  assert.deepStrictEqual(call[1], { p_profile_id: 'p1', p_friends: ['f1', 'f2'], p_kind: 'film' });
  assert.strictEqual(W.WT.step, 'deck');
  assert.deepStrictEqual(W.WT.deck.map(x => x.title), ['Court']);
  const h = W.wtHtml();
  assert.match(h, /wt\.hidden#1/); assert.match(h, /wtTake/); assert.match(h, /1 h 30/); assert.match(h, /reco\.tmdb/);
});

test('RPC absente : fonctionnalité masquée', async () => {
  global.socClose = () => {};
  global.supa = { rpc: () => Promise.resolve({ error: { code: '42883' } }) };
  W.WT.available = null; W.WT.busy = false; W.WT.to = ['f1'];
  W.wtGo(); await new Promise(r => setTimeout(r, 5));
  assert.strictEqual(W.WT.available, false); assert.strictEqual(W.wtEntryHtml(), '');
  W.WT.available = null;
});

test('« On prend ça » : ajoute à MA liste seulement, puis reco facultative au groupe', async () => {
  const added = []; global.recoInMyList = () => false; global.recoAddToMyList = x => added.push(x); global.recoEnabled = () => true;
  W.WT.deck = [{ tmdb_id: 5, tmdb_type: 'movie', title: 'Dune', type: 'film' }]; W.WT.idx = 0; W.WT.to = ['f1', 'f2']; W.WT.hidden = ['f2'];
  W.wtTake();
  assert.strictEqual(added.length, 1); assert.strictEqual(W.WT.step, 'chosen');
  assert.match(W.wtHtml(), /wtTellGroup/);
  let call; global.supa = { rpc: (n, a) => { call = [n, a]; return Promise.resolve({ data: { status: 'sent', count: 1 } }); } };
  W.WT.busy = false; W.wtTellGroup(); await new Promise(r => setTimeout(r, 5));
  assert.strictEqual(call[0], 'send_recommendation'); assert.deepStrictEqual(call[1].p_to, ['f1']);
  assert.strictEqual(W.WT.grouped, true);
});

test('câblage : script, actions, entrée Amis, i18n FR/EN, mouvement réduit', () => {
  assert.match(read('index.html'), /<script src="js\/39-watch-together\.js"><\/script>/);
  const a = read('js/00-actions.js');
  ['openWatchTogether', 'wtToggle', 'wtFilter', 'wtGo', 'wtNext', 'wtShuffle', 'wtTake', 'wtTellGroup', 'wtBack'].forEach(n => assert.match(a, new RegExp("uiOn\\('" + n + "'")));
  assert.match(read('js/33-friends.js'), /wtEntryHtml/);
  const keys = (read('js/39-watch-together.js').match(/t\('(wt\.[a-zA-Z.]*[a-zA-Z])'/g) || []).map(s => s.slice(3, -1));
  ['fr', 'en'].forEach(l => { const d = read('js/i18n/' + l + '.js'); keys.forEach(k => assert.ok(d.includes('"' + k + '"') || d.includes('"' + k + '.one"'), l + ' ' + k)); });
  assert.match(read('index.html'), /prefers-reduced-motion:reduce\)\{\.wt-card/);
});
