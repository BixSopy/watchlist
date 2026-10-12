'use strict';
/*
 * Moteur de recommandation multi-signaux (js/09-taste-profile.js) : profil de goût
 * (genre/décennie/origine, décroissance temporelle, momentum de binge détecté par
 * l'extension, signal négatif des recos refusées) et exploration. Cœur pur (TASTE_CORE),
 * sans réseau ni DOM. Lancer : node --test tests/
 */
const test = require('node:test');
const assert = require('node:assert');
const T = require('../js/09-taste-profile.js');

const DAY = 86400000;
const now = Date.parse('2026-10-08T00:00:00Z');

function item(over) {
  return Object.assign({ id: 'x', type: 'serie', status: 'termine', myRating: null, deleted: false,
    genreIds: [], updatedAtLocal: now, year: '2020' }, over);
}

test('decay : récent = poids 1, un cycle de demi-vie = poids 0.5, pas de date = 0.6 neutre', () => {
  assert.strictEqual(T.decay(now, now), 1);
  assert.ok(Math.abs(T.decay(now - 240 * DAY, now) - 0.5) < 1e-9);
  assert.ok(Math.abs(T.decay(now - 480 * DAY, now) - 0.25) < 1e-9);
  assert.strictEqual(T.decay(null, now), 0.6);
  assert.strictEqual(T.decay(undefined, now), 0.6);
});

test('ratingBias : 5.5 neutre, 10 = +1, 1 = environ -1', () => {
  assert.strictEqual(T.ratingBias(5.5), 0);
  assert.strictEqual(T.ratingBias(null), 0);
  assert.ok(Math.abs(T.ratingBias(10) - 1) < 1e-9);
  assert.ok(Math.abs(T.ratingBias(1) - (-1)) < 1e-9);
});

test('decadeOf : arrondit à la décennie, null si année absente/invalide', () => {
  assert.strictEqual(T.decadeOf('2017'), 2010);
  assert.strictEqual(T.decadeOf('1999'), 1990);
  assert.strictEqual(T.decadeOf(''), null);
  assert.strictEqual(T.decadeOf(undefined), null);
});

test('bingeMomentum : plafonné, croît avec le volume et la récence', () => {
  const recent = [{ watched_at: new Date(now).toISOString() }, { watched_at: new Date(now - DAY).toISOString() }];
  const old = [{ watched_at: new Date(now - 1000 * DAY).toISOString() }];
  assert.ok(T.bingeMomentum(recent, now) > T.bingeMomentum(old, now));
  const huge = Array.from({ length: 50 }, () => ({ watched_at: new Date(now).toISOString() }));
  assert.ok(T.bingeMomentum(huge, now) <= 3);
  assert.strictEqual(T.bingeMomentum([], now), 0);
  assert.strictEqual(T.bingeMomentum([{ watched_at: 'pas une date' }], now), 0);
});

test('bingeBoost : jamais plus de x1.5, x1 sans momentum', () => {
  assert.strictEqual(T.bingeBoost(0), 1);
  assert.ok(T.bingeBoost(3) <= 1.5);
  assert.ok(T.bingeBoost(3) > T.bingeBoost(1));
});

test('computeProfileCore : statut + note + décroissance, items supprimés ignorés', () => {
  const items = [
    item({ status: 'termine', myRating: 9, genreIds: [18] }),
    item({ status: 'avoir', myRating: null, genreIds: [35] }),
    item({ deleted: true, genreIds: [99] }),
  ];
  const p = T.computeProfileCore(items, { now });
  assert.ok(p.genreW[18] > p.genreW[35], 'un coup de cœur terminé pèse plus qu\'un simple "à voir"');
  assert.strictEqual(p.genreW[99], undefined);
  assert.ok(p.typeW.serie > 0);
});

test('computeProfileCore : le momentum de binge booste le poids d\'un item sans écraser les autres', () => {
  const withBinge = item({ status: 'encours', myRating: null, genreIds: [18], title: 'Dark' });
  const noBinge = item({ status: 'encours', myRating: null, genreIds: [35], title: 'Autre' });
  const rows = [{ watched_at: new Date(now).toISOString() }, { watched_at: new Date(now - DAY).toISOString() }];
  const bingeFor = (i) => (i.title === 'Dark' ? rows : []);
  const p = T.computeProfileCore([withBinge, noBinge], { now, bingeFor });
  assert.ok(p.genreW[18] > p.genreW[35], 'le genre du titre bingé pèse plus que l\'autre, à poids de base égal');
});

test('computeProfileCore : signal négatif des recos refusées (malus, jamais plus fort qu\'un coup de cœur)', () => {
  const liked = item({ status: 'termine', myRating: 9, genreIds: [27] });
  const p1 = T.computeProfileCore([liked], { now });
  const p2 = T.computeProfileCore([liked], { now, dismissedMeta: { 42: { genreIds: [27], ts: now } } });
  assert.ok(p2.genreW[27] < p1.genreW[27], 'un refus sur le même genre doit réduire son poids');
  assert.ok(p2.genreW[27] > -1, 'le malus ne doit jamais dominer un vrai coup de cœur sur le même genre');
});

test('scoreCore : genre + décennie + origine (séries), type pondéré 0.4', () => {
  const profile = { genreW: { 18: 2 }, typeW: { serie: 1, film: 0, anime: 0 }, keywordW: {}, castW: {}, crewW: {}, decadeW: { 2010: 1 }, originW: { KR: 1 } };
  const base = T.scoreCore({ appType: 'serie', genreIds: [18], year: '2015', originCountry: 'KR' }, profile);
  const noMatch = T.scoreCore({ appType: 'film', genreIds: [999], year: '1950', originCountry: 'US' }, profile);
  assert.ok(base > noMatch);
  assert.strictEqual(T.scoreCore(null, profile), 0);
});

test('topKeys : classement décroissant, filtré par poids minimal', () => {
  const bucket = { a: 5, b: 1, c: 9, d: 0.1 };
  assert.deepStrictEqual(T.topKeys(bucket, 2), ['c', 'a']);
  assert.deepStrictEqual(T.topKeys(bucket, 10, 1), ['c', 'a']);
});

test('pickWithExploration : sans ratio, identique à un top-N strict', () => {
  const scored = [{ d: 'a', s: 3 }, { d: 'b', s: 1 }, { d: 'c', s: 2 }];
  assert.deepStrictEqual(T.pickWithExploration(scored, 2, 0), ['a', 'c']);
});

test('pickWithExploration : avec ratio, une partie vient du reste (déterministe via rng injecté)', () => {
  const scored = [{ d: 'a', s: 10 }, { d: 'b', s: 9 }, { d: 'c', s: 1 }, { d: 'd', s: 0.5 }, { d: 'e', s: 0.1 }];
  const picked = T.pickWithExploration(scored, 5, 0.4, () => 0);
  assert.strictEqual(picked.length, 5);
  assert.ok(picked.indexOf('a') > -1, 'le meilleur score reste toujours gardé (slot top)');
});

test('pickWithExploration : jamais plus d\'items que demandé, jamais de doublon', () => {
  const scored = Array.from({ length: 8 }, (_, i) => ({ d: 'x' + i, s: i }));
  const picked = T.pickWithExploration(scored, 5, 0.3, Math.random);
  assert.strictEqual(picked.length, 5);
  assert.strictEqual(new Set(picked).size, 5);
});
