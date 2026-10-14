'use strict';
/* Navigation « Cinéma » (js/29-shell.js) et fiche (js/08-plex.js) : coches d'épisodes tirées du pointeur existant. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const fn = (src, name) => src.match(new RegExp('function ' + name + '\\([^)]*\\)\\{[\\s\\S]*?\\n\\}'))[0];
test('epWatched : avant ou égal au dernier épisode vu ; tout pour Terminé ; rien pour À voir', () => {
  const ctx = {}; vm.createContext(ctx); vm.runInContext(fn(read('js/08-plex.js'), 'epWatched'), ctx);
  const it = { status: 'encours', saison: 2, episode: 11 };
  assert.equal(ctx.epWatched(it, 1, 25), true);
  assert.equal(ctx.epWatched(it, 2, 11), true);
  assert.equal(ctx.epWatched(it, 2, 12), false);
  assert.equal(ctx.epWatched(it, 3, 1), false);
  assert.equal(ctx.epWatched({ status: 'termine' }, 4, 9), true);
  assert.equal(ctx.epWatched({ status: 'avoir', saison: 2, episode: 3 }, 1, 1), false);
});
test('heroAgo : « Vu il y a 3 jours », vide sans date', () => {
  const ctx = { LOCALE: 'fr-FR', Intl, t: (k, v) => 'Vu ' + v.when }; vm.createContext(ctx); vm.runInContext(fn(read('js/05-render.js'), 'heroAgo'), ctx);
  const now = Date.parse('2026-10-13T12:00:00Z');
  assert.equal(ctx.heroAgo(now - 3 * 86400000, now), 'Vu il y a 3 jours');
  assert.equal(ctx.heroAgo(0, now), '');
});
test('navigation : cinq vues, pilule en haut et barre du téléphone, script chargé en dernier', () => {
  const s = read('js/29-shell.js'), html = read('index.html');
  assert.match(s, /P3_VIEWS=\['tonight','list','calendar','discover','detectes'\]/);
  assert.match(s, /p3-pill/); assert.match(s, /p3-tabbar/);
  assert.ok(html.indexOf('js/29-shell.js') > html.indexOf('js/28-pairing.js'));
  assert.match(html, /#alertWrap\{display:none!important\}/, 'bandeau remplacé par la cloche');
});

test('Compact : la classe posée sur <body> ne réutilise pas celle du bouton (.p3-cpt)', () => {
  const fs = require('node:fs'), path = require('node:path');
  const js = fs.readFileSync(path.join(__dirname, '..', 'js', '29-shell.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const m = js.match(/body\.classList\.toggle\('([a-z0-9-]+)',!!compactOn\)/);
  assert.ok(m, 'classe compact sur body');
  assert.ok(!new RegExp('(^|[\\s,}])\\.' + m[1] + '\\s*[{,]', 'm').test(html), 'aucune règle CSS nue .' + m[1]);
});
test('Découvrir « Pour toi » : le bandeau passe tout de suite à la proposition suivante après un ajout, même pendant le rechargement des recos', () => {
  const card = (id, title) => ({ style: {}, attributes: [{ name: 'data-tmdbid', value: String(id) }, { name: 'data-title', value: title }], getAttribute(n) { const a = this.attributes.find(x => x.name === n); return a ? a.value : null; } });
  const cards = [card(1, 'Premier'), card(2, 'Second')];
  const sec = { querySelectorAll: () => cards, querySelector: () => null };
  let loading = false;
  const src = { querySelectorAll: () => loading ? [] : [sec], querySelector: () => loading ? {} : null };
  const box = { innerHTML: '' };
  const ctx = { memDB: [], dismissed: [], IB: '', esc: s => String(s), t: k => k, document: { getElementById: id => id === 'p3ForYou' ? box : src } };
  vm.createContext(ctx);
  const s = read('js/29-shell.js');
  vm.runInContext('var _p3FySecs=null;' + fn(s, '_p3Attrs') + fn(s, 'p3ForYou'), ctx);
  ctx.p3ForYou();
  assert.match(box.innerHTML, /<h3>Premier<\/h3>/);
  ctx.memDB.push({ tmdbId: 1 }); loading = true; /* ajout, puis loadRecos affiche le squelette */
  ctx.p3ForYou();
  assert.match(box.innerHTML, /<h3>Second<\/h3>/);
  assert.doesNotMatch(box.innerHTML, /Premier/);
  assert.match(read('js/07-add-edit.js'), /_removeFromDiscoverUI\(entry\.tmdbId\);if\(!editId&&typeof p3ForYou==='function'\)p3ForYou\(\);/);
});
