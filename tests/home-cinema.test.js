'use strict';
/* Accueil « Cinéma » (js/25-home.js) : couleur d'ambiance, épisode suivant de « À suivre »,
   sorties de « Cette semaine », et présence des styles (grille aérée, mode compact, mouvement réduit).
   Lancer : node --test tests/ */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.join(__dirname, '..');
const noop = () => {};
const ctx = { module: { exports: {} }, window: { addEventListener: noop }, pad: n => String(n).padStart(2, '0'),
  document: { getElementById: () => null, querySelector: () => null, addEventListener: noop } };
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js/25-home.js'), 'utf8'), ctx);
const H = ctx.module.exports;
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

test('couleur d\'ambiance : moyenne pondérée vers les pixels saturés, noir / blanc / transparent ignorés', () => {
  const px = (...rgba) => Uint8ClampedArray.from(rgba);
  assert.equal(H.ambientFromPixels(px(0, 0, 0, 255, 255, 255, 255, 255, 200, 30, 30, 0)), null);
  const red = H.ambientFromPixels(px(200, 40, 40, 255, 0, 0, 0, 255, 250, 250, 250, 255));
  assert.ok(red[0] > red[1] * 3 && red[0] > red[2] * 3, 'reste rouge');
  assert.ok(Math.max(...red) >= 180 && Math.max(...red) <= 255, 'luminosité remontée pour le fond noir');
  const dark = H.ambientFromPixels(px(40, 50, 90, 255));
  assert.ok(Math.max(...dark) <= 255 && dark[2] > dark[0], 'bleu sombre éclairci sans changer de teinte');
});

test('« À suivre » : épisode suivant, passage à la saison suivante si la taille est connue, rien pour un film', () => {
  assert.equal(H.nextEpLabel({ type: 'serie', saison: 2, episode: 3 }), 'S02 · E04');
  assert.equal(H.nextEpLabel({ type: 'anime', saison: 1, episode: 8, seasonEpCount: 8, seasonEpCountSeason: 1 }), 'S02 · E01');
  assert.equal(H.nextEpLabel({ type: 'serie', saison: 1, episode: 8, seasonEpCount: 10, seasonEpCountSeason: 2 }), 'S01 · E09');
  assert.equal(H.nextEpLabel({ type: 'serie' }), 'S01 · E01');
  assert.equal(H.nextEpLabel({ type: 'film' }), '');
});

test('« Cette semaine » : 7 jours à partir d\'aujourd\'hui, triés par date', () => {
  const add = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const evs = [{ date: '2026-10-20' }, { date: '2026-10-12' }, { date: '2026-10-15' }, { date: '2026-10-13' }, { date: '2026-10-19' }];
  assert.deepEqual(H.weekEvents(evs, '2026-10-13', add).map(e => e.date), ['2026-10-13', '2026-10-15', '2026-10-19']);
  assert.deepEqual(H.weekEvents(null, '2026-10-13', add), []);
});

test('styles : grille aérée hors compact, sections masquées en compact et hors liste, repli mouvement réduit', () => {
  assert.match(html, /\.grid:not\(\.cpt\)\{grid-template-columns:repeat\(auto-fill,minmax\(192px,1fr\)\)/);
  assert.match(html, /\.home-next\.cpt,body\.view-discover \.home-next,body\.view-detected \.home-next,body\.view-calendar \.home-next\{display:none\}/);
  assert.match(html, /id="homeNext" hidden/);
  assert.match(html, /class="hero-amb"/);
  const rm = html.slice(html.lastIndexOf('@media (prefers-reduced-motion:reduce){\n  #heroBand.cf .hero-amb'));
  assert.match(rm, /\.hn-row,\.hn-day\{animation:none/);
});

test('textes FR / EN de l\'accueil', () => {
  for (const l of ['fr', 'en']) {
    const src = fs.readFileSync(path.join(ROOT, 'js/i18n', l + '.js'), 'utf8');
    for (const k of ['home.upNext', 'home.thisWeek', 'home.nextEp', 'home.filmInProgress', 'home.weekEmpty']) assert.ok(src.includes('"' + k + '"'), l + ' ' + k);
  }
});

test('progression : quand demander le nombre d\'épisodes de la saison, et lecture de la réponse TMDB', () => {
  const base = { type: 'serie', status: 'encours', tmdbId: 1, saison: 2, episode: 3 };
  assert.equal(H.needsSeasonCount(base), true);
  assert.equal(H.needsSeasonCount({ ...base, seasonEpCount: 8, seasonEpCountSeason: 2 }), false);
  assert.equal(H.needsSeasonCount({ ...base, seasonEpCount: 8, seasonEpCountSeason: 1 }), true, 'compte d\'une autre saison');
  assert.equal(H.needsSeasonCount({ ...base, type: 'film' }), false);
  assert.equal(H.needsSeasonCount({ ...base, status: 'avoir' }), false);
  assert.equal(H.seasonCountFrom({ seasons: [{ season_number: 1, episode_count: 10 }, { season_number: 2, episode_count: 8 }] }, 2), 8);
  assert.equal(H.seasonCountFrom({ seasons: [{ season_number: 2, episode_count: 0 }] }, 2), 0);
  assert.equal(H.seasonCountFrom(null, 2), 0);
});

test('carrousel : départ sur le plus récent (05-render.js) et barre indéterminée avec repli mouvement réduit', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js/05-render.js'), 'utf8');
  const start = new Function(src.match(/function heroStartIndex\(n\)\{([^}]*)\}/)[1].replace(/^/, 'const n=arguments[0];'));
  assert.deepEqual([1, 2, 3, 4, 5, 14].map(n => start(n)), [0, 0, 0, 0, 0, 0]);
  assert.match(html, /@keyframes cfUnk/);
  assert.match(html, /prefers-reduced-motion:reduce\)\{\.cf-bar\.unk i,\.cf-card \.cf-pg\.unk i\{animation:none/);
});

test('carrousel : repère de position (point bleu sans texte, mouvement réduit)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js/25-home.js'), 'utf8');
  const pct = new Function('idx', 'n', src.match(/function cfPosPct\(idx,n\)\{([^}]*)\}/)[1]);
  assert.deepEqual([pct(0, 10), pct(9, 10), pct(0, 1)], [0, 100, 0]);
  assert.match(html, /id="cfPosDot"/);
  assert.match(html, /\.cf-pos-t i\{[^}]*#5cc8ff/);
  assert.doesNotMatch(html, /cf-pos-[lr]|cont\.(newest|oldest)/);
  assert.match(html, /\.cf-pos\{[^}]*opacity:0/);
  assert.match(html, /\.cf-pos\.on\{opacity:1\}/);
  assert.match(html, /prefers-reduced-motion:reduce\)\{\.cf-pos,\.cf-pos-t i\{transition:none/);
  assert.match(src, /function cfGo\(i\)\{cfPosShow\(\);/);
  assert.match(src, /classList\.remove\('on'\);\},1200\)/);
  assert.doesNotMatch(src.match(/function renderContinue[\s\S]*?\n\}/)[0], /cfPosShow/);
});
