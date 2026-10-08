'use strict';
/*
 * Audit mobile du 8 octobre 2026 (contrôles statiques) et synchro sans rechargement visuel de la grille.
 * Le rendu réel (360/390/412 px, paysage, bouton retour…) est vérifié par e2e/mobile.test.mjs.
 * Lancer : node --test tests/
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const html = read('index.html');
const css = html.slice(html.indexOf('<style'), html.indexOf('</style>'));
function lum(h) {
  return [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0);
}
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const v = name => (css.match(new RegExp('--' + name + ':(#[0-9a-fA-F]{6})\\b')) || [])[1];

test('G6 : viewport-fit=cover et marges de sécurité (encoche, barre d\'accueil)', () => {
  assert.match(html, /<meta name="viewport" content="[^"]*viewport-fit=cover/);
  for (const sel of ['.hdr{padding-top:env(safe-area-inset-top', '.toast-wrap{bottom:calc(20px + env(safe-area-inset-bottom']) assert.ok(css.includes(sel), sel);
});

test('B2 : l\'onglet « Tout » n\'est plus masqué sur mobile', () => {
  assert.doesNotMatch(css, /\.ntab\[data-tab="all"\]\{display:none\}/);
  assert.match(css, /\.ntabs-scroll\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
});

test('B1 : la barre de la liste passe à la ligne, la recherche s\'adapte, rien ne dépasse', () => {
  assert.match(css, /\.nav\.floating \.nav-right\{flex-wrap:wrap/);
  assert.match(css, /\.srch\{flex:1 1 150px;width:auto;min-width:0\}/);
  assert.match(css, /html,body\{overflow-x:clip\}/);
});

test('G8 : textes secondaires (--text3) lisibles, WCAG AA sur le fond et les panneaux', () => {
  assert.ok(ratio(v('text3'), v('bg')) >= 4.5, 'sur --bg');
  assert.ok(ratio(v('text3'), v('bg2')) >= 4.5, 'sur --bg2 (Réglages, panneaux)');
});

test('G2 : champs à 16 px sur mobile (pas de zoom automatique d\'iOS), sans toucher au zoom', () => {
  assert.match(css, /@media \(max-width:768px\),\(pointer:coarse\)\{\s*input:not\(\[type=checkbox\]\)[^{]*\{font-size:16px !important\}/);
  assert.doesNotMatch(html, /user-scalable|maximum-scale/);
});

test('G3 : le clic en dehors du menu se fie au chemin de l\'événement (panneau redessiné pendant le clic)', () => {
  const src = read('js/17-settings-menu.js');
  assert.match(src, /e\.composedPath\(\)/);
  assert.match(src, /path\.indexOf\(menu\)>=0/);
});

test('G5 : module « retour » chargé après les fenêtres qu\'il suit', () => {
  const at = f => html.indexOf('<script src="' + f + '"></script>');
  assert.ok(at('js/22-modal-history.js') > at('js/21-detected.js') && at('js/21-detected.js') > 0);
  const src = read('js/22-modal-history.js');
  for (const id of ['searchModal', 'plexMbk', 'addMbk', 'authMbk', 'statsMbk', 'folderMbk', 'optMenu']) assert.ok(src.includes("'" + id + "'"), id);
  assert.match(src, /history\.pushState/);
  assert.match(src, /addEventListener\('popstate'/);
});

/* Point 20 : synchro de 30 s sans changement distant = aucun rendu */
function syncSandbox(remoteRows, localItems) {
  const calls = { render: [], suivi: 0 };
  const ctx = {
    console, Date, JSON, Promise, setTimeout, setInterval() { return 1; }, clearInterval() {},
    document: { getElementById: () => null },
    navigator: { onLine: true }, memDB: localItems,
    render(o) { calls.render.push(o || null); }, renderSuivi() { calls.suivi++; },
    dbPut(e, cb) { cb && cb(); }, toast() {}, t: k => k, _logErr(...a) { calls.err = a; }, refreshAuthModalView() {},
    authProfileId: 'p1', syncInProgress: false, lastSyncErrorToast: 0,
    supa: { from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: remoteRows.map(r => ({ ...r })) }) }) }) },
  };
  vm.createContext(ctx);
  vm.runInContext(read('js/15-sync.js') + '\nthis.__get=function(){return {syncNow:syncNow,syncPull:syncPull,memDB:memDB,get busy(){return syncInProgress;}};};', ctx);
  return { api: ctx.__get(), calls };
}
const row = o => ({ id: 's1', local_id: 'l1', tmdb_id: 1, tmdb_type: 'tv', type: 'serie', status: 'encours', title: 'Dark', year: '2017', poster_path: '/d.jpg',
  tmdb_score: 8, my_rating: 0, overview: '', tags: [], saison: 1, episode: 4, total_ep: 26, anime_genre: '', deleted: false,
  updated_at: '2026-10-01T10:00:00.000Z', added_at: '2026-09-01T10:00:00.000Z', ...o });
const settle = api => new Promise(res => { const w = () => (api.busy ? setTimeout(w, 5) : res()); setTimeout(w, 5); });

test('point 20 : une synchro sans changement distant ne redessine rien', async () => {
  const { api: a0 } = syncSandbox([row()], []);
  await a0.syncPull(true);
  const local = a0.memDB; // liste locale identique au serveur
  const { api, calls } = syncSandbox([row()], local);
  api.syncNow(); await settle(api);
  assert.deepEqual(calls.render, [], 'aucun render()');
  assert.equal(calls.suivi, 0, 'aucun renderSuivi()');
  // Même titre renvoyé avec une date plus récente mais un contenu identique : toujours rien à redessiner
  const { api: api2, calls: c2 } = syncSandbox([row({ updated_at: '2026-10-02T10:00:00.000Z' })], local);
  api2.syncNow(); await settle(api2);
  assert.deepEqual(c2.render, []);
});

test('point 20 : un vrai changement distant = un seul rendu, discret (pas d\'animation ni d\'affiches rechargées)', async () => {
  const { api: a0 } = syncSandbox([row()], []);
  await a0.syncPull(true);
  const { api, calls } = syncSandbox([row({ episode: 5, updated_at: '2026-10-02T10:00:00.000Z' }), row({ id: 's2', local_id: 'l2', title: 'Arcane' })], a0.memDB);
  api.syncNow(); await settle(api);
  assert.equal(calls.render.length, 1, 'un seul render() pour les deux pulls');
  assert.deepEqual(calls.render[0], { quiet: true });
  assert.equal(api.memDB.find(i => i.id === 'l1').episode, 5);
  assert.equal(api.memDB.length, 2);
});

test('point 20 : rendu identique = DOM de la grille inchangé ; rendu discret sans animation', () => {
  const src = read('js/05-render.js');
  assert.match(src, /if\(html!==_lastMcHtml\|\|!mc\.firstChild\)\{_swapMc\(mc,html,quiet\)/);
  assert.doesNotMatch(src, /Math\.random\(\)/, 'identifiants de section stables');
  assert.match(css, /#mc\.mc-quiet \.card[^{]*\{animation:none\}/);
});
