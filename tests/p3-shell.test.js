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
