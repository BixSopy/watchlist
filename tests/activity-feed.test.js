'use strict';
/* Social étape 2 : fil d'activité + réactions. Base SQL : supabase/tests/81_activite_reactions.test.sql. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

global.window = global;
global.LOCALE = 'fr-FR';
global.t = (k, v) => k + (v ? JSON.stringify(v) : '');
global.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
global.uiAct = (n, a) => ' data-click="' + n + '"' + (a ? ' data-args="' + global.esc(JSON.stringify(a)) + '"' : '');
global.friendAvatar = p => '<span class="fr-av" aria-hidden="true">' + global.esc((p && p.handle || '?').charAt(0)) + '</span>';
global.friendName = p => '@' + ((p && p.handle) || '');
global.IMG_W92 = 'https://image.tmdb.org/t/p/w92';
global.authProfileId = 'p1';
global.toast = () => {};

const A = require(path.join(ROOT, 'js', '36-activity-feed.js'));

test('activityAgo : à l\'instant, minutes, heures, invalide', () => {
  const now = Date.now();
  assert.strictEqual(A.activityAgo(new Date(now).toISOString()), 'act.justNow');
  assert.match(A.activityAgo(new Date(now - 5 * 60000).toISOString()), /5/);
  assert.match(A.activityAgo(new Date(now - 3 * 3600000).toISOString()), /3/);
  assert.strictEqual(A.activityAgo(null), '');
  assert.strictEqual(A.activityAgo('pas une date'), '');
});

test('activityItemMeta : film -> « Titre · Terminé », épisode -> « Titre · SxEy »', () => {
  assert.strictEqual(A.activityItemMeta({ kind: 'film', title: 'Dune' }), 'Dune · status.termine');
  assert.strictEqual(A.activityItemMeta({ kind: 'episode', title: 'Severance', season: 1, episode: 4 }), 'Severance · S1 E4');
});

test('activityFeedHtml : squelette avant le premier chargement (ACT_FEED.data === null)', () => {
  A.ACT_FEED.data = null;
  assert.match(A.activityFeedHtml(), /act-skel/);
});

test('activityFeedHtml : état vide', () => {
  A.ACT_FEED.data = [];
  const h = A.activityFeedHtml();
  assert.match(h, /act-empty/);
  assert.match(h, /act\.empty/);
});

test('activityFeedHtml : une entrée, affiche validée, échappement, réactions rendues', () => {
  A.ACT_FEED.data = [{
    event_id: 'e1', updated_at: new Date().toISOString(),
    friend: { profile_id: 'f1', handle: 'zoe', name: '<img>' },
    kind: 'episode', season: 1, episode: 4, title: 'A<b>', poster_path: '/ok.jpg',
    reactions: { '🔥': 2 }, my_reaction: '🔥',
  }, {
    event_id: 'e2', updated_at: new Date().toISOString(),
    friend: { profile_id: 'f1', handle: 'zoe' },
    kind: 'film', season: null, episode: null, title: 'B', poster_path: 'javascript:x',
    reactions: {}, my_reaction: null,
  }];
  const h = A.activityFeedHtml();
  assert.ok(!h.includes('<img>') && !h.includes('A<b>'), 'noms et titres échappés');
  assert.ok(!h.includes('javascript:'), 'affiche invalide jamais rendue en <img>');
  assert.match(h, /src="https:\/\/image\.tmdb\.org\/t\/p\/w92\/ok\.jpg"/);
  assert.match(h, /class="act-react on" data-emoji="🔥"/);
  assert.match(h, /<em>2<\/em>/, 'le compteur de la réaction posée est affiché');
  for (const em of A.ACT_EMOJI) assert.ok(h.includes('data-emoji="' + em + '"'), em);
});

test('reactTap : optimiste, bascule locale avant la réponse réseau', () => {
  A.ACT_FEED.data = [{ event_id: 'e1', friend: { profile_id: 'f1' }, kind: 'film', title: 'B', reactions: {}, my_reaction: null }];
  let resolved;
  global.supa = { rpc: () => new Promise(r => { resolved = r; }) };
  global.document = { querySelector: () => null };
  A.reactTap(null, null, 'e1', '🔥');
  assert.strictEqual(A.ACT_FEED.data[0].my_reaction, '🔥', 'réaction posée immédiatement, sans attendre le serveur');
  assert.strictEqual(A.ACT_FEED.data[0].reactions['🔥'], 1);
  resolved({ data: { status: 'ok', counts: { '🔥': 1 }, my_reaction: '🔥' } });
});

test('surface : réaction fixe à 6 emoji côté serveur, identique à ACT_EMOJI côté client', () => {
  const sql = read('supabase/migrations/20261026230000_social_activite_reactions.sql');
  assert.match(sql, /emoji in \('👍', '❤️', '🔥', '😮', '😂', '🍿'\)/);
  assert.deepStrictEqual(A.ACT_EMOJI, ['👍', '❤️', '🔥', '😮', '😂', '🍿']);
});

test('surface : le fil ne se nourrit que de mark_watched_by_title, jamais d\'une correction manuelle', () => {
  const sql = read('supabase/migrations/20261026230000_social_activite_reactions.sql');
  assert.match(sql, /_social_log_activity/);
  const withoutComments = sql.replace(/--.*$/gm, '');
  assert.ok(!/create or replace function public\.extension_apply_import/.test(withoutComments),
    'extension_apply_import ne doit pas être redéfinie (fonction déjà supprimée par 20261008160000)');
});

test('surface : get_activity_feed / react_to_activity réservées à authenticated (pas anon)', () => {
  const sql = read('supabase/migrations/20261026230000_social_activite_reactions.sql');
  assert.match(sql, /grant execute on function public\.get_activity_feed\(uuid\) to authenticated;/);
  assert.match(sql, /grant execute on function public\.react_to_activity\(uuid, uuid, text\) to authenticated;/);
  assert.ok(!/grant execute on function public\.get_activity_feed\(uuid\) to anon/.test(sql));
  assert.ok(!/grant execute on function public\.react_to_activity\(uuid, uuid, text\) to anon/.test(sql));
});

test('index.html : script chargé après les autres modules sociaux, CSS réduit les animations', () => {
  const html = read('index.html');
  assert.ok(html.indexOf('<script src="js/35-social-privacy.js">') < html.indexOf('<script src="js/36-activity-feed.js">'));
  assert.match(html, /@media \(prefers-reduced-motion:reduce\)\{\.act-item,\.act-react\.pop\{animation:none!important\}/);
});
