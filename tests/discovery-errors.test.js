'use strict';
/* Découvrir : une erreur de chargement n'est plus masquée (message + « Réessayer »), jamais mise en cache,
   alors qu'une rangée réellement vide (tout est déjà dans la liste) reste masquée. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', '06-discovery.js'), 'utf8');

function sandbox(apiFetch) {
  const rows = {};
  const getRow = id => rows[id] || (rows[id] = { id, style: {}, innerHTML: '' });
  const stub = () => ({ addEventListener() {}, classList: { toggle() {}, add() {}, remove() {} }, style: {}, setAttribute() {}, querySelectorAll: () => [], offsetWidth: 1200 });
  const ctx = {
    render: () => {}, console, Promise, Set, Math, JSON, setTimeout,
    t: k => k, esc: s => String(s), uiAct: (n, a) => ' data-click="' + n + '" data-args=\'' + JSON.stringify(a) + '\'',
    TB: '/api/tmdb', TMDB_LANG: 'fr-FR', IB: '', memDB: [], dismissed: [], RECO_EXPLORE_RATIO: 0,
    computeTasteProfile: () => ({}), _pickByProfile: items => items, icon: () => '',
    apiFetch, window: { innerWidth: 1280 },
    document: { getElementById: id => (/^dr-/.test(id) ? getRow(id) : stub()), documentElement: { style: { setProperty() {} } },
      body: { classList: { toggle() {} } }, querySelectorAll: () => [] },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
  };
  ctx.window.document = ctx.document;
  vm.createContext(ctx);
  vm.runInContext(SRC + '\n;this.__x={_drFetchRow,_drFetchBecause,_renderDrRow,drRetryRow,_drCache,DISCOVER_CONFIG,loadDiscovery};', ctx);
  return { ctx, x: ctx.__x, getRow };
}
const ok = body => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
const CFG = { id: 'pop-film', title: 'Films populaires', url: '/discover/movie?sort_by=popularity.desc', mtype: 'movie' };
const item = id => ({ id, title: 'T' + id, poster_path: '/p' + id + '.jpg', release_date: '2020-01-01', vote_average: 7 });

test('rangée en erreur (HTTP 500) : failed, message et bouton Réessayer, pas masquée', async () => {
  const { x, getRow } = sandbox(() => Promise.resolve({ ok: false, status: 500 }));
  const data = await x._drFetchRow(CFG);
  assert.strictEqual(data.failed, true);
  assert.strictEqual(data.items.length, 0);
  x._renderDrRow(CFG, data, 'all');
  const row = getRow('dr-all-pop-film');
  assert.notStrictEqual(row.style.display, 'none');
  assert.match(row.innerHTML, /disc\.rowError/);
  assert.match(row.innerHTML, /data-click="drRetryRow"/);
  assert.match(row.innerHTML, /\["all","pop-film"\]/);
});

test('rangée en erreur réseau (promesse rejetée) : même traitement', async () => {
  const { x } = sandbox(() => Promise.reject(new Error('réseau')));
  const data = await x._drFetchRow(CFG);
  assert.strictEqual(data.failed, true);
});

test('rangée réellement vide (tout est déjà dans la liste) : masquée, pas d\'erreur', async () => {
  const { x, ctx, getRow } = sandbox(() => ok({ results: [item(1), item(2)], total_pages: 1 }));
  ctx.memDB.push({ tmdbId: 1 }, { tmdbId: 2 });
  const data = await x._drFetchRow(CFG);
  assert.strictEqual(!!data.failed, false);
  x._renderDrRow(CFG, data, 'all');
  assert.strictEqual(getRow('dr-all-pop-film').style.display, 'none');
});

test('une page en erreur mais des résultats ailleurs : la rangée s\'affiche', async () => {
  let n = 0;
  const { x } = sandbox(() => (n++ === 0 ? Promise.resolve({ ok: false, status: 502 }) : ok({ results: [item(10), item(11)], total_pages: 1 })));
  const data = await x._drFetchRow(CFG);
  assert.strictEqual(!!data.failed, false);
  assert.ok(data.items.length >= 2);
});

test('« Parce que tu as aimé » : erreur signalée, sans base la rangée reste vide sans erreur', async () => {
  const a = sandbox(() => Promise.resolve({ ok: false, status: 500 }));
  a.ctx.memDB.push({ type: 'film', tmdbId: 5, myRating: 9, title: 'X' });
  const d = await a.x._drFetchBecause('film');
  assert.strictEqual(d.failed, true);
  const b = sandbox(() => ok({ results: [] }));
  const e = await b.x._drFetchBecause('film');
  assert.strictEqual(!!e.failed, false);
});

test('un échec n\'est jamais mis en cache, un succès oui ; Réessayer relance la rangée', async () => {
  let fail = true;
  const { x, ctx, getRow } = sandbox(() => (fail ? Promise.resolve({ ok: false, status: 500 }) : ok({ results: [item(7), item(8)], total_pages: 1 })));
  ctx.DISCOVER_CONFIG = x.DISCOVER_CONFIG;
  x.DISCOVER_CONFIG.all = [CFG];
  x.loadDiscovery('all');
  await new Promise(r => setTimeout(r, 30));
  assert.strictEqual(x._drCache['all:pop-film'], undefined, 'échec non mis en cache');
  assert.match(getRow('dr-all-pop-film').innerHTML, /drRetryRow/);
  fail = false;
  x.drRetryRow('all', 'pop-film');
  await new Promise(r => setTimeout(r, 30));
  assert.ok(x._drCache['all:pop-film'], 'succès mis en cache');
  assert.match(getRow('dr-all-pop-film').innerHTML, /dr-card/);
});

test('textes et action branchés (fr/en, uiOn)', () => {
  for (const l of ['fr', 'en']) {
    const s = fs.readFileSync(path.join(__dirname, '..', 'js', 'i18n', l + '.js'), 'utf8');
    assert.match(s, /"disc\.rowError"/);
    assert.match(s, /"disc\.retry"/);
  }
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'js', '00-actions.js'), 'utf8'), /uiOn\('drRetryRow'/);
});
