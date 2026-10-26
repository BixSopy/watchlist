'use strict';
/* Récap à partager (js/31-recap.js) : bornes des périodes et chiffres calculés uniquement à partir des données existantes. */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const { recapRange, recapStats } = require(path.join(__dirname, '..', 'js', '31-recap.js'));

const NOW = new Date(2026, 9, 26, 15).getTime(); /* 26 oct. 2026 */
const at = (m, d) => new Date(2026, m, d, 12).getTime();

test('périodes : mois en cours, mois dernier (y compris janvier -> décembre), année', () => {
  const m = recapRange('month', NOW);
  assert.strictEqual(m.start, new Date(2026, 9, 1).getTime());
  assert.strictEqual(m.end, new Date(2026, 10, 1).getTime());
  const l = recapRange('lastMonth', NOW);
  assert.strictEqual(l.start, new Date(2026, 8, 1).getTime());
  assert.strictEqual(l.kind, 'month');
  const j = recapRange('lastMonth', new Date(2027, 0, 5).getTime());
  assert.strictEqual(j.start, new Date(2026, 11, 1).getTime());
  assert.strictEqual(j.end, new Date(2027, 0, 1).getTime());
  const y = recapRange('year', NOW);
  assert.strictEqual(y.start, new Date(2026, 0, 1).getTime());
  assert.strictEqual(y.end, new Date(2027, 0, 1).getTime());
});

test('statistiques : titres regardés / terminés / ajoutés, supprimés ignorés, affiches des plus récents', () => {
  const items = [
    { title: 'Dark', type: 'serie', status: 'termine', lastWatchedAt: at(9, 20), addedAt: at(1, 1), myRating: 9, poster: '/dark.jpg' },
    { title: 'Frieren', type: 'anime', status: 'encours', lastWatchedAt: at(9, 25), addedAt: at(9, 2), myRating: 8, poster: '/fr.jpg' },
    { title: 'Dune', type: 'film', status: 'termine', lastWatchedAt: at(9, 3), addedAt: at(9, 3), poster: null },
    { title: 'Vieux', type: 'film', status: 'termine', lastWatchedAt: at(8, 30), addedAt: at(8, 1) },
    { title: 'Supprimé', type: 'film', status: 'termine', lastWatchedAt: at(9, 10), deleted: true },
    { title: 'À voir', type: 'serie', status: 'avoir', lastWatchedAt: null, addedAt: at(9, 12) },
  ];
  const s = recapStats(items, recapRange('month', NOW));
  assert.strictEqual(s.watched, 3);
  assert.deepStrictEqual(s.byType, { film: 1, serie: 1, anime: 1 });
  assert.strictEqual(s.finished, 2);
  assert.strictEqual(s.added, 3);
  assert.strictEqual(s.avgRating, 8.5);
  assert.deepStrictEqual(s.topRated, { title: 'Dark', rating: 9 });
  assert.deepStrictEqual(s.posters.map(p => p.title), ['Frieren', 'Dark']);
  assert.strictEqual(s.empty, false);
});

test('statistiques : période vide, une seule note -> pas de moyenne affichée, valeurs invalides ignorées', () => {
  assert.strictEqual(recapStats([], recapRange('month', NOW)).empty, true);
  const s = recapStats([{ title: 'A', type: 'film', status: 'termine', lastWatchedAt: at(9, 1), myRating: 7 }, { title: 'B', lastWatchedAt: 'x', addedAt: NaN }], recapRange('month', NOW));
  assert.strictEqual(s.watched, 1);
  assert.strictEqual(s.avgRating, null);
  assert.strictEqual(s.topRated, null);
});

test('intégration : script chargé, bouton dans les statistiques, aucune requête réseau ajoutée', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /<script src="js\/31-recap\.js"><\/script>/);
  assert.match(html, /data-click="openRecap"/);
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', '31-recap.js'), 'utf8');
  assert.doesNotMatch(src, /fetch\(|XMLHttpRequest|supa\./);
});
