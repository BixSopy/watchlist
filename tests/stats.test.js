'use strict';
/* Statistiques enrichies (js/16-stats.js, statsMore) : activité par mois (dernière séance), notes,
   genres TMDB (doubles des séries comptés une fois), décennies, séries menées au bout.
   Lancer : node --test tests/ */
const test = require('node:test');
const assert = require('node:assert');
const { statsMore, STATS_GENRE_KEY } = require('../js/16-stats.js');

const NOW = new Date(2026, 10, 10, 12).getTime(); /* 10 nov. 2026, heure locale */
const at = (y, m, d) => new Date(y, m, d, 20).getTime();

test('activité : 12 mois glissants, mois en cours en dernier, titres supprimés et dates hors période ignorés', () => {
  const s = statsMore([
    { id: 1, lastWatchedAt: at(2026, 10, 2) },
    { id: 2, lastWatchedAt: at(2026, 10, 9) },
    { id: 3, lastWatchedAt: at(2025, 11, 31) },
    { id: 4, lastWatchedAt: at(2025, 10, 30), deleted: true },
    { id: 5, lastWatchedAt: at(2025, 9, 1) }, /* il y a 13 mois */
    { id: 6, lastWatchedAt: null },
  ], NOW);
  assert.strictEqual(s.months.length, 12);
  assert.strictEqual(s.months[11].date.getMonth(), 10);
  assert.strictEqual(s.months[0].date.getMonth(), 11, 'déc. 2025 : premier mois');
  assert.deepStrictEqual(s.months.map(m => m.n), [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2]);
});

test('notes : répartition 1 à 10, notes vides ou hors échelle ignorées', () => {
  const s = statsMore([{ myRating: 8 }, { myRating: 8 }, { myRating: 10 }, { myRating: 0 }, { myRating: 11 }, {}], NOW);
  assert.deepStrictEqual(s.ratings, [0, 0, 0, 0, 0, 0, 0, 2, 0, 1]);
  assert.strictEqual(s.rated, 3);
});

test('genres : top 6, genre double des séries compté une fois, genres sans libellé ignorés', () => {
  const s = statsMore([
    { genreIds: [10759, 28, 12] },  /* Action & Aventure (série) + Action + Aventure */
    { genreIds: [10765] },          /* SF & Fantastique → SF */
    { genreIds: [878, 18] },
    { genreIds: [36] },             /* Histoire : pas de libellé → titre non compté */
    { genreIds: [] }, {},
  ], NOW);
  assert.deepStrictEqual(s.topGenres, [{ key: 'scifi', n: 2 }, { key: 'action', n: 1 }, { key: 'adventure', n: 1 }, { key: 'drama', n: 1 }]);
  assert.strictEqual(s.withGenre, 3);
  for (const k of new Set(Object.values(STATS_GENRE_KEY))) assert.match(k, /^[a-z]+$/);
});

test('décennies et séries menées au bout', () => {
  const s = statsMore([
    { type: 'film', year: '1994' }, { type: 'film', year: '1999' }, { type: 'film', year: '2021' }, { type: 'film', year: '' },
    { type: 'serie', status: 'termine', year: '2008' }, { type: 'anime', status: 'encours', year: '2023' },
    { type: 'serie', status: 'avoir', year: '2024' },
  ], NOW);
  assert.deepStrictEqual(s.decades, [{ decade: 2020, n: 3 }, { decade: 2000, n: 1 }, { decade: 1990, n: 2 }]);
  assert.deepStrictEqual([s.showsStarted, s.showsDone, s.completion], [2, 1, 50], '« à voir » pas compté comme commencé');
  assert.strictEqual(statsMore([{ type: 'film' }], NOW).completion, null);
});

test('libellés de genre : une clé i18n existante pour chaque genre affiché', () => {
  const fs = require('node:fs'), path = require('node:path');
  const fr = fs.readFileSync(path.join(__dirname, '..', 'js', 'i18n', 'fr.js'), 'utf8');
  for (const k of new Set(Object.values(STATS_GENRE_KEY))) assert.match(fr, new RegExp('"genre\\.' + k + '":'), k);
});
