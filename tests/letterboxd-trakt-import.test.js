'use strict';
/* Imports Letterboxd et Trakt (js/27-gdpr-import.js, plateformes « letterboxd » et « trakt ») puis
   onglet « Détectés » (js/21-detected.js) : films vus, notes, watchlist, épisodes Trakt avec ids TMDB.
   Fichiers synthétiques aux en-têtes des exports réels (Letterboxd : Date, Name, Year, Letterboxd URI,
   Rating, Rewatch, Tags, Watched Date ; Trakt : objets de l'API sync/history, sync/watched,
   sync/ratings, sync/watchlist). Lancer : node --test tests/ */
const test = require('node:test');
const assert = require('node:assert');
const zlib = require('node:zlib');
const { GDPR_CORE: G, GDPR_FILES: F } = require('../js/27-gdpr-import.js');
const D = require('../js/21-detected.js');

function zip(files) {
  const locals = [], centrals = []; let off = 0;
  for (const [name, data] of files) {
    const nb = Buffer.from(name), comp = zlib.deflateRawSync(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nb.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, nb, comp); centrals.push(ch, nb); off += 30 + nb.length + comp.length;
  }
  const cd = Buffer.concat(centrals), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, e]);
}
const groupsOf = (p, events) => D.groupRows(G.toRows(G.mergeExport(events), G.PLATFORMS[p].source, D.normalizeTitle));

const LB = {
  watched: 'Date,Name,Year,Letterboxd URI\n2023-01-05,Dune,2021,https://boxd.it/a1\n2023-02-01,Dune,1984,https://boxd.it/a2\n2023-03-10,"Paris, Texas",1984,https://boxd.it/a3\n',
  diary: 'Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date\n2023-01-06,Dune,2021,https://boxd.it/d1,4,,,2023-01-04\n2024-05-01,Dune,2021,https://boxd.it/d2,4.5,Yes,,2024-04-30\n',
  ratings: 'Date,Name,Year,Letterboxd URI,Rating\n2024-05-01,Dune,2021,https://boxd.it/a1,5\n2023-04-01,Heat,1995,https://boxd.it/a4,3.5\n',
  watchlist: 'Date,Name,Year,Letterboxd URI\n2024-01-01,Tenet,2020,https://boxd.it/w1\n2024-01-02,Dune,2021,https://boxd.it/a1\n',
};

test('Letterboxd : films vus, homonymes séparés par l\'année, note ×2, watchlist seulement si jamais vu', () => {
  const ev = ['watched', 'diary', 'ratings', 'watchlist'].flatMap(k => G.parseText('letterboxd', k + '.csv', LB[k]));
  const merged = G.mergeExport(ev);
  const dune21 = merged.filter(e => e.title === 'Dune' && e.year === 2021);
  assert.strictEqual(dune21.length, 1, 'un seul Dune 2021 (journal, notes et watchlist fusionnés)');
  assert.strictEqual(dune21[0].rating, 10, 'note actuelle (ratings.csv) 5/5 → 10/10');
  assert.strictEqual(new Date(dune21[0].watchedAt).toISOString().slice(0, 10), '2024-04-30', 'dernier visionnage (Watched Date du journal)');
  assert.ok(!dune21[0].want, 'vu : pas « à voir »');
  assert.ok(merged.some(e => e.title === 'Dune' && e.year === 1984 && !e.rating));
  assert.strictEqual(merged.find(e => e.title === 'Paris, Texas').year, 1984, 'virgule entre guillemets');
  assert.strictEqual(merged.find(e => e.title === 'Heat').rating, 7, 'noté seulement : compté comme vu, 3,5 → 7');
  assert.strictEqual(merged.find(e => e.title === 'Tenet').want, true);
});

test('Letterboxd : zip lu (dossier de l\'export), deleted/ lists/ likes/ et reviews ignorés', async () => {
  const z = zip([
    ['letterboxd-pierre-2026-11-10/watched.csv', Buffer.from(LB.watched)],
    ['letterboxd-pierre-2026-11-10/watchlist.csv', Buffer.from(LB.watchlist)],
    ['letterboxd-pierre-2026-11-10/reviews.csv', Buffer.from('Date,Name,Year,Letterboxd URI,Review\n2020-01-01,Cats,2019,x,bad\n')],
    ['letterboxd-pierre-2026-11-10/deleted/diary.csv', Buffer.from('Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date\n2020-01-01,Cats,2019,x,1,,,2020-01-01\n')],
    ['letterboxd-pierre-2026-11-10/lists/favoris.csv', Buffer.from('Date,Name,Year\n2020-01-01,Cats,2019\n')],
    ['letterboxd-pierre-2026-11-10/likes/films.csv', Buffer.from('Date,Name,Year\n2020-01-01,Cats,2019\n')],
  ]);
  const acc = await F.collect('letterboxd', 'letterboxd-pierre.zip', new Uint8Array(z), 0, { events: [], files: [] });
  assert.deepStrictEqual(acc.files.sort(), ['watched.csv', 'watchlist.csv']);
  assert.ok(!acc.events.some(e => e.title === 'Cats'));
  const groups = groupsOf('letterboxd', acc.events);
  const dunes = groups.filter(g => g.norm === 'dune');
  assert.deepStrictEqual(dunes.map(g => g.year).sort(), [1984, 2021], 'deux groupes Dune');
  assert.notStrictEqual(dunes[0].key, dunes[1].key);
  const tenet = groups.find(g => g.title === 'Tenet');
  assert.strictEqual(tenet.want, true);
  assert.deepStrictEqual(tenet.sources, ['letterboxd_export']);
});

test('« À voir » et note : nouveau titre en « À voir », note sur 10 ; rien ne fait avancer un titre déjà listé', () => {
  const [tenet] = groupsOf('letterboxd', G.parseText('letterboxd', 'watchlist.csv', 'Date,Name,Year,Letterboxd URI\n2024-01-01,Tenet,2020,x\n'));
  const cand = { tmdbId: 577922, tmdbType: 'movie', title: 'Tenet', year: '2020', genreIds: [], originCountry: [] };
  assert.deepStrictEqual(D.newEntryFields(tenet, cand, null), { type: 'film', status: 'avoir', saison: null, episode: null, totalEp: null, animeGenre: '', watchedAt: null });
  assert.strictEqual(D.movesForward({ status: 'avoir', type: 'film' }, tenet), false);
  const [heat] = groupsOf('letterboxd', G.parseText('letterboxd', 'ratings.csv', LB.ratings).filter(e => e.title === 'Heat'));
  const f = D.newEntryFields(heat, { tmdbId: 949, tmdbType: 'movie', title: 'Heat', year: '1995' }, null);
  assert.deepStrictEqual([f.status, f.myRating], ['termine', 7]);
  assert.strictEqual(D.defaultChecked(tenet, { kind: 'new', cand, unambiguous: true }), true);
  const show = { kind: 'show', want: true, progress: null };
  assert.strictEqual(D.defaultChecked(show, { kind: 'new', cand: { tmdbType: 'tv' }, unambiguous: true }), true, 'série « à voir » cochée aussi');
  assert.strictEqual(D.newEntryFields(show, { tmdbType: 'tv', title: 'X' }, null).status, 'avoir');
});

test('année : un homonyme de la liste n\'est pas le même titre, et une fiche TMDB d\'une autre année recule', () => {
  const g = { kind: 'movie', norm: 'dune', title: 'Dune', year: 1984 };
  const items = [{ id: 'a', type: 'film', title: 'Dune', year: '2021', status: 'termine' }];
  assert.deepStrictEqual(D.listMatches(g, items), []);
  assert.strictEqual(D.listMatches({ ...g, year: 2021 }, items).length, 1);
  assert.strictEqual(D.listMatches({ kind: 'movie', norm: 'dune', title: 'Dune' }, items).length, 1, 'sans année : comme avant');
  const ranked = D.rankCandidates(g, [
    { id: 438631, media_type: 'movie', title: 'Dune', release_date: '2021-09-15', popularity: 200 },
    { id: 841, media_type: 'movie', title: 'Dune', release_date: '1984-12-14', popularity: 30 },
  ]);
  assert.strictEqual(ranked[0].tmdbId, 841);
  assert.ok(D.isUnambiguous(ranked));
});

const TRAKT = {
  history: [
    { id: 1, watched_at: '2024-03-01T20:00:00.000Z', action: 'watch', type: 'episode', episode: { season: 1, number: 2, title: 'x', ids: { trakt: 9, tvdb: 555, tmdb: 777 } }, show: { title: 'Severance', year: 2022, ids: { trakt: 1, slug: 'severance', tvdb: 371980, imdb: 'tt11280740', tmdb: 95396 } } },
    { id: 2, watched_at: '2024-02-01T20:00:00.000Z', action: 'scrobble', type: 'movie', movie: { title: 'Heat', year: 1995, ids: { trakt: 2, tmdb: 949, imdb: 'tt0113277' } } },
  ],
  watchedShows: [{ plays: 3, last_watched_at: '2024-03-05T20:00:00.000Z', show: { title: 'Severance', year: 2022, ids: { tvdb: 371980, tmdb: 95396 } },
    seasons: [{ number: 1, episodes: [{ number: 1, plays: 1, last_watched_at: '2024-02-28T20:00:00.000Z' }, { number: 3, plays: 1, last_watched_at: '2024-03-05T20:00:00.000Z' }] }] }],
  watchedMovies: [{ plays: 2, last_watched_at: '2024-02-10T20:00:00.000Z', movie: { title: 'Heat', year: 1995, ids: { tmdb: 949 } } }],
  ratings: [
    { rated_at: '2024-02-11T00:00:00.000Z', rating: 9, type: 'movie', movie: { title: 'Heat', year: 1995, ids: { tmdb: 949 } } },
    { rated_at: '2024-02-11T00:00:00.000Z', rating: 6, type: 'episode', episode: { season: 1, number: 1 }, show: { title: 'Severance', ids: { tmdb: 95396 } } },
  ],
  watchlist: [
    { listed_at: '2024-01-01T00:00:00.000Z', type: 'show', show: { title: 'Shōgun', year: 2024, ids: { tmdb: 126308, tvdb: 392573 } } },
    { listed_at: '2024-01-01T00:00:00.000Z', type: 'movie', movie: { title: 'Heat', year: 1995, ids: { tmdb: 949 } } },
  ],
  collection: [{ collected_at: '2020-01-01T00:00:00.000Z', listed_at: '2020-01-01T00:00:00.000Z', movie: { title: 'Cats', year: 2019, ids: { tmdb: 536869 } } }],
};

test('Trakt : historique, séries vues, films vus, notes /10, watchlist ; collection ignorée ; ids TMDB gardés', () => {
  const ev = [
    ...G.parseText('trakt', 'history.json', JSON.stringify(TRAKT.history)),
    ...G.parseText('trakt', 'watched/watched-shows.json', JSON.stringify(TRAKT.watchedShows)),
    ...G.parseText('trakt', 'watched/watched-movies.json', JSON.stringify(TRAKT.watchedMovies)),
    ...G.parseText('trakt', 'ratings/ratings.json', JSON.stringify(TRAKT.ratings)),
    ...G.parseText('trakt', 'lists/watchlist.json', JSON.stringify(TRAKT.watchlist)),
    ...G.parseText('trakt', 'collection.json', JSON.stringify(TRAKT.collection)),
  ];
  const merged = G.mergeExport(ev);
  const sev = merged.filter(e => e.title === 'Severance');
  assert.deepStrictEqual(sev.map(e => [e.season, e.episode]).sort(), [[1, 1], [1, 2], [1, 3]]);
  assert.ok(sev.every(e => e.tmdb === 95396 && e.tvdb === 371980));
  const heat = merged.filter(e => e.title === 'Heat');
  assert.strictEqual(heat.length, 1, 'film vu deux fois + watchlist + note : une entrée');
  assert.deepStrictEqual([heat[0].tmdb, heat[0].rating, heat[0].want], [949, 9, undefined]);
  assert.strictEqual(new Date(heat[0].watchedAt).toISOString().slice(0, 10), '2024-02-10');
  assert.ok(merged.find(e => e.title === 'Shōgun').want);
  assert.ok(!merged.some(e => e.title === 'Cats'), 'collection : possédé, pas vu');
  const groups = D.groupRows(G.toRows(merged, G.PLATFORMS.trakt.source, D.normalizeTitle));
  const g = groups.find(x => x.title === 'Severance');
  assert.deepStrictEqual([g.tmdb, g.progress.season, g.progress.episode], [95396, 1, 3]);
  assert.strictEqual(groups.find(x => x.title === 'Shōgun').want, true);
});

test('Trakt : un fichier sans indication « watchlist » ne crée pas de « à voir » (listes personnelles)', () => {
  assert.deepStrictEqual(G.parseText('trakt', 'export.json', JSON.stringify({ lists: [{ items: TRAKT.watchlist }] })), []);
  const nested = G.parseText('trakt', 'export.json', JSON.stringify({ watchlist: TRAKT.watchlist, history: TRAKT.history }));
  assert.strictEqual(nested.filter(e => e.want).length, 2);
  assert.strictEqual(nested.filter(e => !e.want).length, 2);
  assert.deepStrictEqual(G.parseText('trakt', 'broken.json', '{oops'), []);
});

test('Trakt : fichiers lus dans le zip, réglages / collection / listes perso / commentaires ignorés', () => {
  for (const f of ['watched/watched-movies.json', 'history.json', 'ratings/ratings-movies.json', 'lists/watchlist.json', 'trakt/watchlist-shows.json'])
    assert.strictEqual(G.wanted('trakt', f), 'text', f);
  for (const f of ['user/settings.json', 'collection/collection-movies.json', 'lists/mes-favoris.json', 'comments.json', 'stats.json', 'readme.txt'])
    assert.strictEqual(G.wanted('trakt', f), null, f);
});

test('fiche TMDB lue par son id (Trakt) : candidat exact', () => {
  const g = { kind: 'show', norm: 'severance', title: 'Severance', tmdb: 95396 };
  const c = D.detailsCandidate(g, { id: 95396, name: 'Severance', original_name: 'Severance', first_air_date: '2022-02-17', genres: [{ id: 18 }], origin_country: ['US'], poster_path: '/p.jpg' });
  assert.deepStrictEqual([c[0].tmdbId, c[0].tmdbType, c[0].match, c[0].year, c[0].genreIds[0]], [95396, 'tv', 1, '2022', 18]);
  assert.ok(D.isUnambiguous(c));
  assert.deepStrictEqual(D.detailsCandidate(g, null), []);
});

test('Letterboxd et Trakt : export immédiat, pas de demande à suivre ni de rappel', () => {
  for (const p of ['letterboxd', 'trakt']) {
    assert.strictEqual(G.instant(p), true);
    assert.strictEqual(G.status({ requestedAt: 1 }, p, Date.now()).kind, 'none');
    assert.match(G.PLATFORMS[p].url, /^https:\/\/(letterboxd\.com|trakt\.tv)\/settings\/data\/?$/);
  }
  assert.deepStrictEqual(G.dueReminders({ letterboxd: { requestedAt: 1 }, trakt: { requestedAt: 1 } }, Date.now()), []);
  assert.strictEqual(G.instant('apple'), false);
});
