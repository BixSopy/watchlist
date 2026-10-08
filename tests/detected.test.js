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
  assert.deepStrictEqual(arcane.progress, { season: 1, episode: 9, approx: false, src: 'netflix' }, 'S2E1 à 30 % : pas compté ; exact préféré à l\'estimé');
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

test('Crunchyroll / Prime Video : sources gardées par groupe ; saison Crunchyroll jamais cochée d\'office', () => {
  const g = D.groupRows([
    row({ raw_title: 'JUJUTSU KAISEN', source: 'crunchyroll', season: 2, episode: 5, progress_pct: 100, watched_at: '2026-09-30T20:40:00Z' }),
    row({ raw_title: 'The Boys', source: 'prime', season: 4, episode: 3, progress_pct: 100, watched_at: '2026-10-05T10:00:00Z' }),
    row({ raw_title: 'The Boys', source: 'live', season: 4, episode: 2, watched_at: '2026-10-04T10:00:00Z' }),
  ]);
  const jjk = g.find((x) => x.key === 'show:jujutsu kaisen');
  const boys = g.find((x) => x.key === 'show:boys');
  assert.deepStrictEqual(jjk.sources, ['crunchyroll']);
  assert.deepStrictEqual(boys.sources.sort(), ['live', 'prime']);
  assert.deepStrictEqual(boys.progress, { season: 4, episode: 3, approx: false, src: 'prime' });
  const tm = { state: 'done', candidates: D.rankCandidates(jjk, [TV(95479, 'JUJUTSU KAISEN', '2020-10-03', 120)]) };
  const c = D.classify(jjk, [], tm, null);
  assert.strictEqual(D.actionable(jjk, c), true, 'reste ajoutable après vérification');
  assert.strictEqual(D.defaultChecked(jjk, c), false, 'numérotation Crunchyroll : à vérifier');
  const up = D.classify(jjk, [{ id: 'i1', title: 'Jujutsu Kaisen', type: 'anime', status: 'encours', saison: 1, episode: 24 }], tm, null);
  assert.strictEqual(up.kind, 'update');
  assert.strictEqual(D.defaultChecked(jjk, up), false);
  const tmB = { state: 'done', candidates: D.rankCandidates(boys, [TV(76479, 'The Boys', '2019-07-25', 120)]) };
  assert.strictEqual(D.defaultChecked(boys, D.classify(boys, [], tmB, null)), true, 'Prime Video : coché comme Netflix');
});

test('onglet « Détectés » : pastille par plateforme, textes dans les deux langues', () => {
  const src = read('js/21-detected.js');
  assert.match(src, /class="det-src det-src-'\+/);
  for (const k of ['netflix', 'crunchyroll', 'prime', 'live']) assert.match(read('index.html'), new RegExp('\\.det-src-' + k + '\\b'));
  for (const l of ['fr', 'en']) {
    const txt = read('js/i18n/' + l + '.js');
    for (const k of ['det.src.netflix', 'det.src.crunchyroll', 'det.src.prime', 'det.crNumbering']) assert.ok(txt.includes('"' + k + '"'), l + ' ' + k);
  }
});

/* ---------- Correspondance TMDB des titres Netflix (0.6.1) ---------- */
test('TMDB : requêtes nettoyées pour les titres Netflix FR (saison, partie, série limitée, année…)', () => {
  const q = (t) => D.searchQueries(t);
  assert.deepStrictEqual(q('Stranger Things : Saison 4')[0], 'Stranger Things');
  assert.deepStrictEqual(q('La Casa de Papel : Partie 5')[0], 'La Casa de Papel');
  assert.deepStrictEqual(q('Mercredi : Saison 1')[0], 'Mercredi');
  assert.deepStrictEqual(q('Lupin : Partie 3')[0], 'Lupin');
  assert.deepStrictEqual(q('Squid Game : Saison 2')[0], 'Squid Game');
  assert.deepStrictEqual(q('The Witcher : Le sang des origines : Série limitée').slice(0, 2), ['The Witcher : Le sang des origines', 'The Witcher']);
  assert.deepStrictEqual(q('Glass Onion (2022)')[0], 'Glass Onion');
  assert.deepStrictEqual(q('Arcane : Volume 2')[0], 'Arcane');
  assert.deepStrictEqual(q('Le Jeu de la dame : Mini-série')[0], 'Le Jeu de la dame');
  assert.deepStrictEqual(q('Maid (Limited Series)')[0], 'Maid');
  assert.deepStrictEqual(q('Bird Box Barcelona : Le film')[0], 'Bird Box Barcelona');
  assert.deepStrictEqual(q('Mercredi : Saison 1 : Le jour de la rentrée')[0], 'Mercredi', 'reste d\'un titre d\'épisode');
  assert.deepStrictEqual(q("L'Attaque des Titans : Saison finale")[0], "L'Attaque des Titans");
  assert.deepStrictEqual(q('Demon Slayer: Kimetsu no Yaiba : Saison 3').slice(0, 2), ['Demon Slayer: Kimetsu no Yaiba', 'Demon Slayer']);
  assert.deepStrictEqual(q('JUJUTSU KAISEN : Saison 2')[0], 'JUJUTSU KAISEN');
  assert.deepStrictEqual(q('Dark'), ['Dark']);
  assert.deepStrictEqual(q('Black Mirror: Bandersnatch').slice(0, 2), ['Black Mirror: Bandersnatch', 'Black Mirror']);
});

test('TMDB : plan de recherche fr-FR puis en-US, variantes, puis /search/multi, sans doublon', () => {
  const plan = D.lookupPlan(G('Stranger Things : Saison 4', 'show'), 'fr-FR');
  assert.deepStrictEqual(plan.map(p => [p.path, p.query, p.lang]), [
    ['/search/tv', 'Stranger Things', 'fr-FR'], ['/search/tv', 'Stranger Things', 'en-US'],
    ['/search/tv', 'Stranger Things : Saison 4', 'fr-FR'], ['/search/tv', 'Stranger Things : Saison 4', 'en-US'],
    ['/search/multi', 'Stranger Things', 'fr-FR'],
  ]);
  const en = D.lookupPlan(G('Glass Onion', 'movie'), 'en-US');
  assert.deepStrictEqual(en.map(p => [p.path, p.lang]), [['/search/movie', 'en-US'], ['/search/movie', 'fr-FR'], ['/search/multi', 'en-US']]);
});

test('TMDB : titres FR difficiles retrouvés (nom, nom original, autre langue) et retenus d\'office', () => {
  const cases = [
    ['Stranger Things : Saison 4', TV(66732, 'Stranger Things', '2016-07-15', 300)],
    ['La Casa de Papel : Partie 5', TV(71446, 'La casa de papel', '2017-05-02', 100, { original_name: 'La casa de papel' })],
    ['Mercredi : Saison 1', TV(119051, 'Mercredi', '2022-11-23', 200, { original_name: 'Wednesday' })],
    ['Lupin : Partie 3', TV(96677, 'Lupin', '2021-01-08', 80)],
    ['Squid Game : Saison 2', TV(93405, 'Squid Game', '2021-09-17', 300, { original_name: '오징어 게임' })],
    ['JUJUTSU KAISEN : Saison 2', TV(95479, 'Jujutsu Kaisen', '2020-10-03', 150, { original_name: '呪術廻戦' })],
    ["L'Attaque des Titans : Saison finale", TV(1429, "L'Attaque des Titans", '2013-04-07', 200, { original_name: '進撃の巨人' })],
  ];
  for (const [title, res] of cases) {
    const r = D.rankCandidates(G(title, 'show'), [res]);
    assert.strictEqual(r.length, 1, title);
    assert.ok(D.isUnambiguous(r), title);
    assert.ok(D.goodEnough(r), title + ' : pas de requête de plus');
  }
  // Titre anglais seulement (réponse en-US fusionnée avec la réponse fr-FR de la même fiche)
  const g = G('Wednesday', 'show');
  let r = D.rankCandidates(g, [TV(119051, 'Mercredi', '2022-11-23', 200, { original_name: 'Mercredi' })]);
  assert.strictEqual(r.length, 0);
  r = D.rankCandidates(g, [TV(119051, 'Wednesday', '2022-11-23', 200)], { previous: D.rankCandidates(G('Mercredi', 'show'), [TV(119051, 'Mercredi', '2022-11-23', 200)]) });
  assert.strictEqual(r.length, 1, 'même fiche fusionnée');
  assert.strictEqual(r[0].title, 'Mercredi', 'titre de la langue du site gardé');
  assert.deepStrictEqual(r[0].altTitles, ['Wednesday']);
  assert.ok(D.isUnambiguous(r));
});

test('TMDB : nom avant les deux-points seulement proposé, jamais retenu d\'office ; film/série de l\'autre type via multi', () => {
  const witcher = G('The Witcher : Le sang des origines : Série limitée', 'show');
  let r = D.rankCandidates(witcher, [TV(71912, 'The Witcher', '2019-12-20', 300)]);
  assert.strictEqual(r.length, 1, 'proposée');
  assert.ok(!D.isUnambiguous(r), 'pas retenue d\'office');
  r = D.rankCandidates(witcher, [TV(71912, 'The Witcher', '2019-12-20', 300), TV(106541, 'The Witcher : Le sang des origines', '2022-12-25', 60, { original_name: 'The Witcher: Blood Origin' })]);
  assert.strictEqual(r[0].tmdbId, 106541);
  assert.ok(D.isUnambiguous(r));
  // /search/multi : série classée « film » par Netflix (ou l'inverse), personnes ignorées
  const g = G('Arcane', 'movie');
  r = D.rankCandidates(g, [{ media_type: 'person', id: 5, name: 'Arcane' }, Object.assign(TV(94605, 'Arcane', '2021-11-06', 120), { media_type: 'tv' })]);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].tmdbType, 'tv');
  assert.ok(r[0].match < 1 && D.isUnambiguous(r));
  // Recherche manuelle : aucun seuil, la requête tapée compte comme variante
  r = D.rankCandidates(G('Titre Introuvable', 'show'), [Object.assign(TV(1399, 'Game of Thrones', '2011-04-17', 400), { media_type: 'tv' })], { manual: true, query: 'game of thrones' });
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].manual, true);
  const c = D.classify(G('Titre Introuvable', 'show'), [], { state: 'skipped', candidates: [] }, null);
  assert.deepStrictEqual([c.kind, c.reason], ['new', 'skipped']);
  assert.deepStrictEqual(D.classify(G('X', 'show'), [], { state: 'manualNone', candidates: [] }, null).reason, 'manualNone');
});
