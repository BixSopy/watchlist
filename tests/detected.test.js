'use strict';
/*
 * Onglet « Détectés » du site (js/21-detected.js) : regroupement des détections envoyées par
 * l'extension, correspondance avec la liste, choix de la fiche TMDB, champs ajoutés / mis à jour.
 * Cœur pur (DET_CORE), sans réseau ni DOM. Lancer : node --test tests/
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const D = require('../js/21-detected.js');
const LIB = require('../extension/lib/import.js');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const plain = (v) => JSON.parse(JSON.stringify(v));

test('normalisation identique à la fonction SQL et à l\'extension', () => {
  const cases = {
    'The Office': 'office', 'L’Odyssée (2021)': 'odyssee', 'Les Misérables [1998]': 'miserables', 'ÉLITE': 'elite',
    'Spider-Man: No Way Home': 'spider man no way home', '  Ça   !! ': 'ca', 'Œdipe & Æther': 'oedipe aether',
    '1917': '1917', 'Blade Runner 2049': 'blade runner 2049', 'Les': 'les', 'Lesbos': 'lesbos', '進撃の巨人': '進撃の巨人',
    'La Casa de Papel': 'casa de papel', "L'Attaque des Titans": 'attaque des titans', 'Straße': 'strasse',
  };
  for (const [input, out] of Object.entries(cases)) {
    assert.strictEqual(D.normalizeTitle(input), out, input);
    assert.strictEqual(LIB.normalizeTitle(input), out, 'extension : ' + input);
  }
  for (const v of ['%', '', null, undefined, 42]) assert.strictEqual(D.normalizeTitle(v), null);
});

/* Lignes telles que renvoyées par PostgREST (detected_media, RLS) */
let N = 0;
const row = (o) => Object.assign({ id: 'r' + (++N), source: 'netflix', media_type: 'show', season: null, episode: null,
  watched_at: '2026-10-01T10:00:00Z', progress_pct: null, state: 'pending' }, o, { normalized_title: o.normalized_title || D.normalizeTitle(o.raw_title) });

test('regroupement : un groupe par titre (toutes sources), épisode le plus avancé, épisode commencé non compté', () => {
  const g = D.groupRows([
    row({ raw_title: 'Arcane', source: 'netflix_csv', season: 1, episode: 9, watched_at: '2026-01-01T00:00:00Z' }),
    row({ raw_title: 'ARCANE', source: 'netflix', season: 1, episode: 9, watched_at: '2026-02-01T00:00:00Z' }),
    row({ raw_title: 'Arcane', source: 'live', season: 2, episode: 1, progress_pct: 30, watched_at: '2026-03-01T00:00:00Z' }),
    row({ raw_title: 'Arcane', media_type: 'movie', watched_at: '2025-01-01T00:00:00Z' }),
    row({ raw_title: 'Dark', season: null, episode: null, watched_at: '2024-01-01T00:00:00Z' }),
    row({ raw_title: 'Ignored', state: 'ignored' }),
  ]);
  assert.strictEqual(g.length, 3, 'film et série du même nom séparés, ligne ignorée exclue');
  const arcane = g.find((x) => x.key === 'show:arcane');
  assert.strictEqual(arcane.ids.length, 3);
  assert.deepStrictEqual(arcane.sources.sort(), ['live', 'netflix', 'netflix_csv']);
  assert.deepStrictEqual(arcane.progress, { season: 1, episode: 9, approx: false }, 'S2E1 à 30 % : pas compté ; exact préféré à l\'estimé');
  assert.strictEqual(arcane.title, 'Arcane', 'titre de la détection la plus récente');
  assert.strictEqual(g[0].key, 'show:arcane', 'plus récent d\'abord');
  const dark = g.find((x) => x.key === 'show:dark');
  assert.strictEqual(dark.progress, null);
  assert.strictEqual(dark.unknownProgress, true);
});

const LIST = [
  { id: 'u-dark', title: 'Dark', type: 'serie', status: 'encours', saison: 1, episode: 4, tmdbId: 70523, tmdbType: 'tv' },
  { id: 'u-darkf', title: 'Dark', type: 'film', status: 'avoir', saison: null, episode: null, tmdbId: 1, tmdbType: 'movie' },
  { id: 'u-lupin1', title: 'Lupin', type: 'serie', status: 'avoir', saison: null, episode: null, tmdbId: 96677, tmdbType: 'tv' },
  { id: 'u-lupin2', title: 'Lupin', type: 'anime', status: 'avoir', saison: null, episode: null, tmdbId: 31724, tmdbType: 'tv' },
  { id: 'u-papel', title: 'La casa de papel', type: 'serie', status: 'todo', saison: null, episode: null, tmdbId: 71446, tmdbType: 'tv' },
  { id: 'u-inc', title: 'Inception', type: 'film', status: 'termine', saison: null, episode: null, tmdbId: 27205, tmdbType: 'movie' },
  { id: 'u-del', title: 'Arcane', type: 'serie', status: 'encours', saison: 1, episode: 1, tmdbId: 94605, tmdbType: 'tv', deleted: true },
];
const G = (title, kind, progress) => ({ key: kind + ':' + D.normalizeTitle(title), kind, norm: D.normalizeTitle(title), title, ids: ['x'], sources: ['netflix'], progress: progress || null });

test('correspondance : titre normalisé exact et type (série/anime vs film), titres supprimés ignorés', () => {
  assert.deepStrictEqual(D.listMatches(G('DARK', 'show'), LIST).map((m) => m.id), ['u-dark']);
  assert.deepStrictEqual(D.listMatches(G('Dark', 'movie'), LIST).map((m) => m.id), ['u-darkf']);
  assert.strictEqual(D.listMatches(G('Lupin', 'show'), LIST).length, 2);
  assert.deepStrictEqual(D.listMatches(G('Dark Matter', 'show'), LIST), [], 'aucune correspondance partielle');
  assert.deepStrictEqual(D.listMatches(G('Arcane', 'show'), LIST), []);
});

test('classement : la progression avance seulement (jamais en arrière, un titre terminé reste terminé)', () => {
  const k = (title, kind, p) => D.classify(G(title, kind, p), LIST, null, null).kind;
  assert.strictEqual(k('Dark', 'show', { season: 2, episode: 1 }), 'update');
  assert.strictEqual(k('Dark', 'show', { season: 1, episode: 4 }), 'uptodate');
  assert.strictEqual(k('Dark', 'show', { season: 1, episode: 2 }), 'uptodate', 'jamais en arrière');
  assert.strictEqual(k('Dark', 'show', null), 'uptodate', 'épisode inconnu : rien à faire');
  assert.strictEqual(k('La Casa de Papel', 'show', { season: 1, episode: 1 }), 'update', 'titre « à qualifier »');
  assert.strictEqual(k('Inception', 'movie'), 'uptodate', 'film déjà terminé');
  assert.strictEqual(k('Dark', 'movie'), 'update');
  assert.strictEqual(k('Lupin', 'show', { season: 1, episode: 1 }), 'ambiguous');
  const c = D.classify(G('Arcane', 'show', { season: 1, episode: 9 }), LIST, null, null);
  assert.deepStrictEqual([c.kind, c.reason], ['new', 'pending']);
  assert.strictEqual(D.filterOf(c), 'new');
  assert.deepStrictEqual(D.updateFields(LIST[0], G('Dark', 'show', { season: 2, episode: 1 }), null), { status: 'encours', saison: 2, episode: 1 });
  assert.deepStrictEqual(D.updateFields(LIST[1], G('Dark', 'movie'), null), { status: 'termine', saison: null, episode: null });
  assert.strictEqual(D.updateFields(LIST[5], G('Inception', 'movie'), null), null);
});

test('plusieurs titres de la liste : à choisir, seul un titre proposé est accepté', () => {
  const g = G('Lupin', 'show', { season: 1, episode: 5 });
  let c = D.classify(g, LIST, null, {});
  assert.strictEqual(D.actionable(g, c), false);
  c = D.classify(g, LIST, null, { target: 'u-lupin2' });
  assert.strictEqual(c.item.id, 'u-lupin2');
  assert.strictEqual(D.actionable(g, c), true);
  assert.strictEqual(D.defaultChecked(g, c), false, 'jamais coché tout seul');
  c = D.classify(g, LIST, null, { target: 'u-dark' });
  assert.strictEqual(c.item, null, 'cible hors des correspondances refusée');
});

const TV = (id, name, date, popularity, extra) => Object.assign({ id, name, original_name: name, first_air_date: date, popularity, poster_path: '/' + id + '.jpg', vote_average: 8.123, overview: 'x' }, extra || {});
test('TMDB : candidat sans ambiguïté (seul, bien plus ressemblant, ou bien plus connu) sinon à choisir', () => {
  const g = G('Arcane', 'show');
  let r = D.rankCandidates(g, [TV(94605, 'Arcane', '2021-11-06', 120)]);
  assert.strictEqual(r.length, 1);
  assert.ok(D.isUnambiguous(r));
  assert.strictEqual(r[0].score, '8.1', 'même format que l\'ajout manuel');
  assert.strictEqual(r[0].year, '2021');
  r = D.rankCandidates(g, [TV(1, 'Arcane', '2021-11-06', 120), TV(2, 'Arcane', '1998-01-01', 2)]);
  assert.ok(D.isUnambiguous(r), 'homonyme très peu connu');
  r = D.rankCandidates(G('The Office', 'show'), [TV(2316, 'The Office', '2005-03-24', 300), TV(2996, 'The Office', '2001-07-09', 120)]);
  assert.ok(!D.isUnambiguous(r), 'deux séries connues du même nom : à choisir');
  const c = D.classify(G('The Office', 'show', { season: 1, episode: 2 }), [], { state: 'done', candidates: r }, null);
  assert.deepStrictEqual([c.kind, D.filterOf(c)], ['ambiguous', 'ambiguous']);
  const chosen = D.classify(G('The Office', 'show', { season: 1, episode: 2 }), [], { state: 'done', candidates: r }, { cand: 1 });
  assert.deepStrictEqual([chosen.kind, chosen.cand.tmdbId], ['new', 2996]);
  r = D.rankCandidates(G('Money Heist', 'show'), [TV(71446, 'La casa de papel', '2017-05-02', 100)]);
  assert.strictEqual(r.length, 0, 'titre trop différent : pas de candidat');
  r = D.rankCandidates(G('Money Heist', 'show'), [TV(71446, 'Money Heist', '2017-05-02', 100, { original_name: 'La casa de papel' })]);
  assert.strictEqual(r.length, 1);
  r = D.rankCandidates(G('Glass Onion', 'movie'), [{ id: 661374, title: 'Glass Onion', original_title: 'Glass Onion', release_date: '2022-11-23', vote_average: 7.1 }]);
  assert.deepStrictEqual([r[0].tmdbType, r[0].year], ['movie', '2022']);
});

test('TMDB : fiche déjà dans la liste sous un autre titre -> mise à jour, pas de doublon', () => {
  const g = G('Money Heist', 'show', { season: 2, episode: 3 });
  const cands = D.rankCandidates(g, [TV(71446, 'Money Heist', '2017-05-02', 100)]);
  const c = D.classify(g, LIST, { state: 'done', candidates: cands }, null);
  assert.strictEqual(c.kind, 'update');
  assert.strictEqual(c.viaTmdb, true);
  assert.strictEqual(c.item.id, 'u-papel');
});

test('TMDB : série terminée seulement si le dernier épisode vu est le dernier diffusé et la série finie', () => {
  const details = { status: 'Ended', in_production: false, number_of_episodes: 18, seasons: [{ season_number: 0, episode_count: 3 }, { season_number: 1, episode_count: 10 }, { season_number: 2, episode_count: 8 }] };
  assert.strictEqual(D.isSeriesFinished({ season: 2, episode: 8 }, details), true);
  assert.strictEqual(D.isSeriesFinished({ season: 2, episode: 7 }, details), false);
  assert.strictEqual(D.isSeriesFinished({ season: 1, episode: 10 }, details), false);
  assert.strictEqual(D.isSeriesFinished({ season: 2, episode: 8 }, Object.assign({}, details, { status: 'Returning Series' })), false);
  assert.strictEqual(D.isSeriesFinished({ season: 2, episode: 8 }, Object.assign({}, details, { in_production: true })), false);
  assert.strictEqual(D.isSeriesFinished(null, details), false);
  const cand = { tmdbType: 'tv', title: 'Arcane', overview: '' };
  assert.deepStrictEqual(D.newEntryFields(G('Arcane', 'show', { season: 2, episode: 8 }), cand, details),
    { type: 'serie', status: 'termine', saison: null, episode: null, totalEp: null, animeGenre: '' });
  assert.deepStrictEqual(D.newEntryFields(G('Arcane', 'show', { season: 2, episode: 3 }), cand, details),
    { type: 'serie', status: 'encours', saison: 2, episode: 3, totalEp: 18, animeGenre: '' });
  assert.deepStrictEqual(D.newEntryFields(G('X', 'movie'), { tmdbType: 'movie' }, null),
    { type: 'film', status: 'termine', saison: null, episode: null, totalEp: null, animeGenre: '' });
  assert.deepStrictEqual(D.updateFields(LIST[0], G('Dark', 'show', { season: 2, episode: 8 }), details), { status: 'termine', saison: null, episode: null });
});

test('anime : même règle que la recherche du site, plus animation japonaise', () => {
  assert.ok(D.isAnime({ title: 'Frieren', overview: 'An anime about elves' }));
  assert.ok(D.isAnime({ title: 'Frieren', overview: '', genreIds: [16, 10765], originCountry: ['JP'] }));
  assert.ok(!D.isAnime({ title: 'Arcane', overview: 'Animated series', genreIds: [16], originCountry: ['US'] }));
  const f = D.newEntryFields(G('Frieren', 'show', { season: 1, episode: 3 }), { tmdbType: 'tv', title: 'Frieren', overview: 'anime' }, null);
  assert.deepStrictEqual([f.type, f.status, f.saison, f.episode, f.totalEp], ['anime', 'encours', 1, 3, 0]);
});

test('cases cochées par défaut : seulement sans choix à faire', () => {
  const g = G('Arcane', 'show', { season: 1, episode: 9 });
  const tm = { state: 'done', candidates: D.rankCandidates(g, [TV(94605, 'Arcane', '2021-11-06', 120)]) };
  assert.strictEqual(D.defaultChecked(g, D.classify(g, [], tm, null)), true);
  const noEp = G('Arcane', 'show', null);
  assert.strictEqual(D.defaultChecked(noEp, D.classify(noEp, [], tm, null)), false, 'série sans épisode connu : à cocher soi-même');
  assert.strictEqual(D.actionable(noEp, D.classify(noEp, [], tm, null)), true);
  const none = D.classify(g, [], { state: 'done', candidates: [] }, null);
  assert.deepStrictEqual([none.reason, D.actionable(g, none)], ['none', false]);
  const err = D.classify(g, [], { state: 'error', candidates: [] }, null);
  assert.strictEqual(D.actionable(g, err), false);
});

test('site : nouvel onglet branché sans gestionnaire en ligne, ajout par le même code que le formulaire', () => {
  const html = read('index.html');
  assert.match(html, /<button class="ntab" id="detTab" data-tab="detectes" data-sfx-hover data-click="switchTab" hidden>/);
  assert.match(html, /<div id="detectedSection"/);
  assert.ok(html.indexOf('<script src="js/20-account.js">') < html.indexOf('<script src="js/21-detected.js">'));
  const actions = read('js/00-actions.js');
  const src = read('js/21-detected.js');
  for (const m of src.matchAll(/uiAct\('(\w+)'/g)) assert.match(actions, new RegExp("uiOn\\('" + m[1] + "'"), m[1]);
  assert.doesNotMatch(src, /\son\w+=/);
  assert.doesNotMatch(src, /cinepisode\.com/, 'domaine jamais codé en dur dans le site');
  const add = read('js/07-add-edit.js');
  assert.match(add, /var entry=makeEntry\(selTmdb,/, 'formulaire manuel');
  assert.match(add, /function addEntryFromTmdb\(sel,f\)\{\n  var entry=makeEntry\(sel,f,null,null\);/);
  assert.match(src, /addEntryFromTmdb\(/);
  assert.match(src, /updateEntryProgress\(/);
  /* les détections ne sont lues/modifiées qu'avec la session (RLS), jamais insérées par le site */
  assert.doesNotMatch(src, /from\('detected_media'\)\.(insert|upsert)/);
});
