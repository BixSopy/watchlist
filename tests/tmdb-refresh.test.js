'use strict';
/* Réglages → Langue : actualiser les titres/affiches déjà en liste dans la langue active
   (js/41-tmdb-refresh.js). Signalé par Pierre (08/11) : changer la langue de l'app ne retraduit
   jamais les titres déjà ajoutés (snapshot pris à l'ajout, js/07-add-edit.js). */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');

global.window = global;
global.t = (k, v) => k + (v ? JSON.stringify(v) : '');
global.tn = (k, n) => k + '#' + n;
global.toast = () => {};
global.TB = '/api/tmdb';
global.TMDB_LANG = 'en-US';

function freshModule() {
  delete require.cache[require.resolve(path.join(ROOT, 'js', '41-tmdb-refresh.js'))];
  return require(path.join(ROOT, 'js', '41-tmdb-refresh.js'));
}

test('trTmdbType : tmdbType explicite sinon déduit de type (film -> movie, sinon tv)', () => {
  const R = freshModule();
  assert.strictEqual(R.trTmdbType({ tmdbType: 'tv', type: 'film' }), 'tv');
  assert.strictEqual(R.trTmdbType({ type: 'film' }), 'movie');
  assert.strictEqual(R.trTmdbType({ type: 'serie' }), 'tv');
  assert.strictEqual(R.trTmdbType({ type: 'anime' }), 'tv');
});

test('trEligible : écarte les supprimés et ceux sans tmdbId', () => {
  const R = freshModule();
  global.memDB = [
    { id: 'a', tmdbId: 1, deleted: false },
    { id: 'b', tmdbId: 2, deleted: true },
    { id: 'c', tmdbId: null, deleted: false },
    { id: 'd', deleted: false },
  ];
  assert.deepStrictEqual(R.trEligible().map(i => i.id), ['a']);
});

test('trApply : title vs name selon movie/tv, poster_path peut redevenir null, overview, needsSync', () => {
  const R = freshModule();
  const movie = { title: 'Ancien titre', poster: '/old.jpg', needsSync: false };
  R.trApply(movie, { title: 'New Title', poster_path: '/new.jpg', overview: 'Desc' }, 'movie');
  assert.strictEqual(movie.title, 'New Title');
  assert.strictEqual(movie.poster, '/new.jpg');
  assert.strictEqual(movie.overview, 'Desc');
  assert.strictEqual(movie.needsSync, true);
  assert.ok(movie.updatedAtLocal > 0);

  const tv = { title: 'Ancien' };
  R.trApply(tv, { name: 'New Show Name', poster_path: null }, 'tv');
  assert.strictEqual(tv.title, 'New Show Name');
  assert.strictEqual(tv.poster, null, 'affiche absente dans cette langue -> pas d\'affiche, pas celle d\'une autre langue par erreur');

  const noTitle = { title: 'Gardé' };
  R.trApply(noTitle, { title: '', poster_path: '/x.jpg' }, 'movie');
  assert.strictEqual(noTitle.title, 'Gardé', 'titre vide côté TMDB : on garde l\'ancien plutôt que d\'effacer');
});

test('refreshListFromTmdb : rien à faire -> toast "rien à mettre à jour", callback(true) immédiat', () => {
  const R = freshModule();
  global.memDB = [];
  let toasted = null; global.toast = (msg) => { toasted = msg; };
  let cbArg; R.refreshListFromTmdb(null, (ok) => { cbArg = ok; });
  assert.strictEqual(toasted, 'set.refreshLangNone');
  assert.strictEqual(cbArg, true);
  global.toast = () => {};
});

test('refreshListFromTmdb : met à jour chaque titre dans TMDB_LANG, progresse puis toast final', async () => {
  const R = freshModule();
  const puts = [];
  global.dbPut = (e, cb) => { puts.push(e.id); cb && cb(); };
  let rendered = 0; global.render = () => { rendered++; };
  const calls = [];
  global.tf = (url) => {
    calls.push(url);
    const m = /\/(movie|tv)\/(\d+)\?language=([^&]+)/.exec(url);
    return Promise.resolve(m[1] === 'movie' ? { title: 'Movie ' + m[2] + ' ' + m[3] } : { name: 'Show ' + m[2] + ' ' + m[3] });
  };
  global.memDB = [
    { id: 'm1', tmdbId: 10, tmdbType: 'movie', type: 'film', deleted: false, title: 'old' },
    { id: 't1', tmdbId: 20, tmdbType: 'tv', type: 'serie', deleted: false, title: 'old' },
  ];
  let toasted = null; global.toast = (msg) => { toasted = msg; };
  const progress = [];
  let done = false, okResult;
  R.refreshListFromTmdb((d, total) => progress.push([d, total]), (ok) => { done = true; okResult = ok; });
  await new Promise((r) => setTimeout(r, 20));

  assert.ok(calls.every((u) => u.indexOf('language=en-US') > -1), 'TMDB_LANG utilisé pour chaque appel : ' + calls.join(', '));
  assert.strictEqual(global.memDB[0].title, 'Movie 10 en-US');
  assert.strictEqual(global.memDB[1].title, 'Show 20 en-US');
  assert.deepStrictEqual(puts.sort(), ['m1', 't1']);
  assert.deepStrictEqual(progress[0], [0, 2]);
  assert.deepStrictEqual(progress[progress.length - 1], [2, 2]);
  assert.strictEqual(rendered, 1);
  assert.strictEqual(toasted, 'set.refreshLangDone#2');
  assert.strictEqual(done, true);
  assert.strictEqual(okResult, true);
});

test('refreshListFromTmdb : erreur d\'auth/quota sur un titre interrompt le lot (pas un titre par un)', async () => {
  const R = freshModule();
  global.dbPut = (e, cb) => { cb && cb(); };
  global.render = () => {};
  let err = null; global.toast = (msg) => { err = msg; };
  const seen = [];
  global.tf = (url) => {
    seen.push(url);
    if (url.indexOf('/movie/2?') > -1) { const e = new Error('QUOTA'); e.code = 'QUOTA'; return Promise.reject(e); }
    return Promise.resolve({ title: 'ok' });
  };
  global.memDB = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ id: 'i' + n, tmdbId: n, tmdbType: 'movie', deleted: false }));
  let done = false, okResult;
  R.refreshListFromTmdb(null, (ok) => { done = true; okResult = ok; });
  await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual(done, true);
  assert.strictEqual(okResult, false);
  assert.strictEqual(err, 'set.refreshLangErr');
});

test('refreshListFromTmdb : un titre introuvable (erreur ordinaire) n\'interrompt pas le reste du lot', async () => {
  const R = freshModule();
  global.dbPut = (e, cb) => { cb && cb(); };
  global.render = () => {};
  global.toast = () => {};
  global.tf = (url) => (url.indexOf('/movie/2?') > -1 ? Promise.reject(new Error('HTTP 404')) : Promise.resolve({ title: 'ok' }));
  global.memDB = [1, 2, 3].map((n) => ({ id: 'i' + n, tmdbId: n, tmdbType: 'movie', deleted: false, title: 'old' }));
  let done = false, okResult;
  R.refreshListFromTmdb(null, (ok) => { done = true; okResult = ok; });
  await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual(done, true);
  assert.strictEqual(okResult, true);
  assert.strictEqual(global.memDB[0].title, 'ok');
  assert.strictEqual(global.memDB[1].title, 'old', 'titre 2 en échec ordinaire : inchangé, mais ne bloque pas les autres');
  assert.strictEqual(global.memDB[2].title, 'ok');
});

test('refreshListFromTmdb : un second appel pendant qu\'un lot tourne déjà ne fait rien', async () => {
  const R = freshModule();
  global.dbPut = (e, cb) => { cb && cb(); };
  global.render = () => {};
  global.toast = () => {};
  let resolveFirst;
  global.tf = () => new Promise((res) => { resolveFirst = res; }).then(() => ({ title: 'ok' }));
  global.memDB = [{ id: 'a', tmdbId: 1, tmdbType: 'movie', deleted: false }];
  let firstDone = false; R.refreshListFromTmdb(null, () => { firstDone = true; });
  let secondCalled = false; R.refreshListFromTmdb(null, () => { secondCalled = true; });
  assert.strictEqual(secondCalled, false, 'le second appel ne doit pas se déclencher pendant que le premier tourne');
  resolveFirst();
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(firstDone, true);
});
