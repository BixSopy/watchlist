'use strict';
/*
 * Extension 0.5.0 : import de l'historique Netflix et du CSV, correspondance avec la liste,
 * choix TMDB, ce qui part au clic sur « Appliquer ». Tout est testé sans réseau.
 * Lancer : node --test tests/
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const I = require('../extension/lib/import.js');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const plain = (v) => JSON.parse(JSON.stringify(v));

/* ---------- Normalisation (même résultat que public.normalize_title_for_match, cf. 20_mark_watched_fiable.test.sql) ---------- */
test('normalisation des titres identique à la fonction SQL', () => {
  const cases = {
    'The Office': 'office', 'L’Odyssée (2021)': 'odyssee', 'Les Misérables [1998]': 'miserables', 'ÉLITE': 'elite',
    'Spider-Man: No Way Home': 'spider man no way home', '  Ça   !! ': 'ca', 'Œdipe & Æther': 'oedipe aether',
    '1917': '1917', 'Blade Runner 2049': 'blade runner 2049', 'Les': 'les', 'Lesbos': 'lesbos', '進撃の巨人': '進撃の巨人',
    'La Casa de Papel': 'casa de papel', "L'Attaque des Titans": 'attaque des titans',
  };
  for (const [input, out] of Object.entries(cases)) assert.strictEqual(I.normalizeTitle(input), out, input);
  for (const v of ['%', '', null, undefined, 42]) assert.strictEqual(I.normalizeTitle(v), null);
});

/* ---------- Netflix : session, requête, pages ---------- */
test('Netflix : session lue dans le HTML (échappements JavaScript décodés)', () => {
  const html = '<script>netflix.reactContext = {"models":{"userInfo":{"data":{"name":"Pierre \\u00e9","authURL":"abc\\x2Fdef\\x3D\\x3D","userGuid":"ABCDEF123"}}}}</script>';
  assert.deepStrictEqual(I.extractNetflixSession(html), { authUrl: 'abc/def==', profileName: 'Pierre é', userGuid: 'ABCDEF123' });
  assert.strictEqual(I.extractNetflixSession('<html>pas connecté</html>'), null);
  assert.strictEqual(I.extractNetflixSession(null), null);
});

test('Netflix : requête d\'une page d\'historique (endpoint aui viewingActivity, profil actif)', () => {
  const r = I.netflixHistoryRequest(3, 100, 'GUID1');
  assert.match(r.url, /^https:\/\/www\.netflix\.com\/api\/aui\/pathEvaluator\/web\/%5E2\.0\.0\?method=call&callPath=/);
  assert.strictEqual(decodeURIComponent(r.url.split('callPath=')[1].split('&')[0]), '["aui","viewingActivity",3,100]');
  assert.strictEqual(decodeURIComponent(r.body.slice(6)), '{"guid":"GUID1"}');
  assert.ok(r.headers['x-netflix.request.routing'].includes('pathEvaluator'));
  assert.ok(I.netflixHistoryRequest(0, 9999).url.includes(encodeURIComponent(',100]')), 'taille de page bornée');
});

const PAGE = (items) => ({ jsonGraph: { aui: { viewingActivity: { value: { viewedItems: items } } } } });
const EP = (movieID, series, seriesTitle, date, extra) => Object.assign({ movieID, series, seriesTitle, title: 'Épisode ' + movieID, date }, extra || {});

test('Netflix : éléments de l\'historique validés (épisode, film, entrées invalides ignorées)', () => {
  const items = I.parseNetflixHistoryPage(PAGE([
    EP(81, 80, 'Dark', 1700000000000, { bookmark: 3000, duration: 3200 }),
    { movieID: 70, title: 'Inception', date: 1690000000000 },
    { movieID: 'x', title: 'Bizarre' }, { movieID: 5, series: 6 }, null, 'texte',
  ]));
  assert.deepStrictEqual(plain(items), [
    { movieId: 81, title: 'Épisode 81', seriesTitle: 'Dark', seriesId: 80, dateMs: 1700000000000, bookmarkMs: 3000, durationMs: 3200 },
    { movieId: 70, title: 'Inception', seriesTitle: null, seriesId: null, dateMs: 1690000000000, bookmarkMs: null, durationMs: null },
  ]);
  assert.strictEqual(I.parseNetflixHistoryPage({ error: 'x' }), null, 'réponse illisible = erreur, pas fin d\'historique');
  assert.deepStrictEqual(I.parseNetflixHistoryPage(PAGE([])), []);
});

const META_DARK = { video: { type: 'show', id: 80, title: 'Dark (EN)', year: 2017, hiddenEpisodeNumbers: false, seasons: [
  { seq: 1, episodes: [{ id: 81, seq: 1, title: 'Secrets' }, { id: 82, seq: 2, title: 'Lies' }] },
  { seq: 2, episodes: [{ id: 91, seq: 1, title: 'Beginnings' }, { id: 92, seq: 2, title: 'Dark Matter' }, { id: 93, seq: 3, title: 'Ghosts' }] },
] } };

test('Netflix : regroupement par série, saison/épisode exacts par la fiche, épisode commencé non compté', () => {
  const raw = I.parseNetflixHistoryPage(PAGE([
    EP(93, 80, 'Dark', 1700000300000, { bookmark: 600, duration: 3000 }),    /* S2E3 commencé (20 %) */
    EP(92, 80, 'Dark', 1700000200000, { bookmark: 2900, duration: 3000 }),   /* S2E2 fini */
    EP(81, 80, 'Dark', 1600000000000, { bookmark: 0, duration: 3000 }),      /* position inconnue : comptée */
    { movieID: 70, title: 'Inception', date: 1690000000000 },
  ]));
  const groups = I.aggregateHistory(raw);
  assert.strictEqual(groups.length, 2);
  const dark = groups[0];
  assert.strictEqual(dark.kind, 'show');
  assert.strictEqual(dark.dateMs, 1700000300000);
  I.applyMetadata(dark, I.parseNetflixMetadata(META_DARK));
  assert.deepStrictEqual(dark.progress, { season: 2, episode: 2 });
  assert.strictEqual(dark.title, 'Dark', 'titre de l\'historique (langue du profil) gardé');
  assert.deepStrictEqual(dark.altTitles, ['Dark (EN)']);
  assert.strictEqual(dark.year, '2017');
  assert.strictEqual(groups[1].kind, 'movie');
});

test('Netflix : numéros masqués (collection) -> pas de progression inventée', () => {
  const g = I.aggregateHistory(I.parseNetflixHistoryPage(PAGE([EP(81, 80, 'Doc', 1)])))[0];
  I.applyMetadata(g, I.parseNetflixMetadata({ video: Object.assign({}, META_DARK.video, { hiddenEpisodeNumbers: true }) }));
  assert.strictEqual(g.progress, null);
  assert.strictEqual(g.hiddenNumbers, true);
});

function fakeNetflix(pages, opts = {}) {
  const calls = [];
  const fn = async (url, o) => {
    calls.push({ url, o });
    if (opts.status) return { status: opts.status, body: '' };
    if (url.includes('/metadata?')) {
      if (opts.metaFirstFails && url.includes('/release/')) return { status: 404, body: '' };
      return { status: 200, body: JSON.stringify(META_DARK) };
    }
    const page = JSON.parse(decodeURIComponent(url.split('callPath=')[1].split('&')[0]))[2];
    if (opts.html) return { status: 200, body: '<html>login</html>' };
    return { status: 200, body: JSON.stringify(PAGE(pages[page] || [])) };
  };
  return { fn, calls };
}

test('Netflix : historique complet page par page, arrêt à la première page vide', async () => {
  const { fn, calls } = fakeNetflix([[EP(92, 80, 'Dark', 300), EP(91, 80, 'Dark', 200)], [{ movieID: 70, title: 'Inception', date: 100 }]]);
  const progress = [];
  const r = await I.fetchNetflixHistory(fn, { userGuid: 'G' }, { onProgress: (p, n) => progress.push([p, n]) });
  assert.strictEqual(r.items.length, 2);
  assert.strictEqual(r.pages, 2);
  assert.strictEqual(r.truncated, false);
  assert.strictEqual(calls.length, 3);
  assert.ok(calls.every((c) => c.o.method === 'POST' && c.o.credentials === 'include'));
  assert.deepStrictEqual(progress, [[1, 2], [2, 3]]);
});

test('Netflix : réimport -> seuls les visionnages plus récents sont lus', async () => {
  const { fn, calls } = fakeNetflix([[EP(92, 80, 'Dark', 300), EP(91, 80, 'Dark', 200)], [{ movieID: 70, title: 'Inception', date: 100 }]]);
  const r = await I.fetchNetflixHistory(fn, { userGuid: 'G' }, { sinceMs: 250 });
  assert.strictEqual(r.items.length, 1);
  assert.strictEqual(r.items[0].episodes.length, 1);
  assert.strictEqual(calls.length, 1, 'arrêt dès qu\'on atteint les éléments déjà lus');
});

test('Netflix : non connecté ou réponse inattendue -> erreur claire (jamais « historique vide »)', async () => {
  await assert.rejects(I.fetchNetflixHistory(fakeNetflix([], { status: 401 }).fn, {}), (e) => e.code === 'netflix_auth');
  await assert.rejects(I.fetchNetflixHistory(fakeNetflix([], { status: 500 }).fn, {}), (e) => e.code === 'netflix_http');
  await assert.rejects(I.fetchNetflixHistory(fakeNetflix([], { html: true }).fn, {}), (e) => e.code === 'netflix_parse');
});

test('Netflix : fiche série par l\'adresse « release », repli sur l\'ancienne adresse', async () => {
  const groups = I.aggregateHistory(I.parseNetflixHistoryPage(PAGE([EP(92, 80, 'Dark', 300)])));
  const { fn, calls } = fakeNetflix([], { metaFirstFails: true });
  const r = await I.fetchNetflixMetadata(fn, groups);
  assert.strictEqual(r.failed, false);
  assert.deepStrictEqual(groups[0].progress, { season: 2, episode: 2 });
  assert.strictEqual(calls.length, 2);
  assert.ok(calls[0].url.startsWith('https://www.netflix.com/nq/website/memberapi/release/metadata?'));
  assert.ok(calls.every((c) => c.url.startsWith('https://www.netflix.com/')));
});

/* ---------- CSV Netflix ---------- */
test('CSV : titres anglais et français (série, saison, épisode, série limitée, film)', () => {
  const p = (s) => plain(I.parseCsvTitle(s));
  assert.deepStrictEqual(p('Stranger Things: Season 1: Chapter One: The Vanishing of Will Byers'),
    { kind: 'show', title: 'Stranger Things', season: 1, episode: null, episodeTitle: 'Chapter One: The Vanishing of Will Byers' });
  assert.deepStrictEqual(p('Stranger Things : Saison 1 : Chapitre un : La disparition de Will Byers'),
    { kind: 'show', title: 'Stranger Things', season: 1, episode: null, episodeTitle: 'Chapitre un: La disparition de Will Byers' });
  assert.strictEqual(p('Dark: Saison 2: Épisode 3').episode, 3);
  assert.deepStrictEqual([p('Lupin : Partie 2 : Chapitre 6').season, p('Lupin : Partie 2 : Chapitre 6').episode], [2, 6]);
  assert.deepStrictEqual(p('Chernobyl: Limited Series: 1:23:45'), { kind: 'show', title: 'Chernobyl', season: 1, episode: null, episodeTitle: '1:23:45' });
  assert.strictEqual(p('Le Jeu de la dame : Série limitée : Ouvertures').title, 'Le Jeu de la dame');
  assert.strictEqual(p('Star Wars: The Clone Wars: Season 7: Victory and Death').title, 'Star Wars: The Clone Wars');
  assert.deepStrictEqual(p('Inception'), { kind: 'movie', title: 'Inception', season: null, episode: null, episodeTitle: '' });
  assert.strictEqual(p('Spider-Man: No Way Home').kind, 'unknown');
  assert.strictEqual(I.parseCsvTitle(''), null);
});

test('CSV : fichier complet, guillemets, dates FR/US, épisodes estimés, film avec deux-points', () => {
  const csv = '\uFEFFTitle,Date\r\n' + [
    '"Stranger Things: Season 1: Chapter One: The Vanishing of Will Byers","25/10/2016"',
    '"Stranger Things: Season 1: Chapter Two: The Weirdo on Maple Street","25/10/2016"',
    '"Stranger Things: Season 1: Chapter Two: The Weirdo on Maple Street","26/10/2016"',
    '"Dark: Saison 2: Épisode 4","27/06/2019"',
    '"Inception","16/07/2010"',
    '"Spider-Man: No Way Home","24/12/2021"',
    '"Our Planet: Jungles","05/04/2019"',
    '"Our Planet: Deserts","05/04/2019"',
    '"Titre ""cité"", avec virgule","01/01/2020"',
  ].join('\r\n') + '\r\n';
  const r = I.parseNetflixCsv(csv);
  assert.strictEqual(r.error, null);
  const by = Object.fromEntries(r.items.map((g) => [g.title, g]));
  assert.deepStrictEqual(by['Stranger Things'].progress, { season: 1, episode: 2, approx: true }, '2 épisodes différents vus');
  assert.strictEqual(new Date(by['Stranger Things'].dateMs).toISOString().slice(0, 10), '2016-10-26', 'date FR (jour/mois)');
  assert.deepStrictEqual(by.Dark.progress, { season: 2, episode: 4, approx: false });
  assert.strictEqual(by.Inception.kind, 'movie');
  assert.strictEqual(by['Spider-Man: No Way Home'].kind, 'movie');
  assert.strictEqual(by['Our Planet'].kind, 'show', 'même première partie sur plusieurs lignes = série');
  assert.ok(by['Titre "cité", avec virgule']);
  assert.strictEqual(I.guessDateOrder(['10/25/16', '1/2/16']), 'mdy');
  assert.strictEqual(I.guessDateOrder(['25/10/2016']), 'dmy');
  assert.strictEqual(new Date(I.parseDateFlexible('10/25/16', 'mdy')).toISOString().slice(0, 10), '2016-10-25');
  assert.strictEqual(I.parseNetflixCsv('foo,bar\n1,2').error, 'no_title_column');
  assert.strictEqual(I.parseNetflixCsv('').error, 'empty');
});

/* ---------- Correspondance avec la liste ---------- */
const LIST = [
  { id: 'u-dark', title: 'Dark', norm: 'dark', type: 'serie', status: 'encours', season: 1, episode: 4, tmdb_id: 70523, tmdb_type: 'tv' },
  { id: 'u-darkf', title: 'Dark', norm: 'dark', type: 'film', status: 'avoir', season: null, episode: null, tmdb_id: 1, tmdb_type: 'movie' },
  { id: 'u-lupin1', title: 'Lupin', norm: 'lupin', type: 'serie', status: 'avoir', season: null, episode: null, tmdb_id: 96677, tmdb_type: 'tv' },
  { id: 'u-lupin2', title: 'Lupin', norm: 'lupin', type: 'anime', status: 'avoir', season: null, episode: null, tmdb_id: 31724, tmdb_type: 'tv' },
  { id: 'u-papel', title: 'La casa de papel', norm: 'casa de papel', type: 'serie', status: 'todo', season: null, episode: null, tmdb_id: 71446, tmdb_type: 'tv', poster_path: '/p.jpg' },
  { id: 'u-inc', title: 'Inception', norm: 'inception', type: 'film', status: 'termine', season: null, episode: null, tmdb_id: 27205, tmdb_type: 'movie' },
];
test('correspondance : titre normalisé exact et type (série/anime vs film), titre alternatif', () => {
  assert.deepStrictEqual(I.findListMatches({ kind: 'show', title: 'DARK' }, LIST).map((m) => m.id), ['u-dark']);
  assert.deepStrictEqual(I.findListMatches({ kind: 'movie', title: 'Dark' }, LIST).map((m) => m.id), ['u-darkf']);
  assert.deepStrictEqual(I.findListMatches({ kind: 'show', title: 'Lupin' }, LIST).length, 2);
  assert.deepStrictEqual(I.findListMatches({ kind: 'show', title: 'Money Heist', altTitles: ['La Casa de Papel'] }, LIST).map((m) => m.id), ['u-papel']);
  assert.deepStrictEqual(I.findListMatches({ kind: 'show', title: 'Dark Matter' }, LIST), [], 'aucune correspondance partielle');
});

test('aperçu : mise à jour seulement si la progression avance (ou titre « à voir »)', () => {
  const d = (title, kind, progress) => I.detectedFromGroup({ key: 'k', kind, title, altTitles: [], year: '', progress, dateMs: 1 }, LIST, 'netflix');
  assert.strictEqual(d('Dark', 'show', { season: 2, episode: 1 }).list.state, 'update');
  assert.strictEqual(d('Dark', 'show', { season: 1, episode: 4 }).list.state, 'unchanged');
  assert.strictEqual(d('Dark', 'show', { season: 1, episode: 2 }).list.state, 'unchanged', 'jamais en arrière');
  assert.strictEqual(d('La Casa de Papel', 'show', { season: 1, episode: 1 }).list.state, 'update');
  assert.strictEqual(d('Inception', 'movie', null).list.state, 'unchanged', 'film déjà terminé');
  assert.strictEqual(d('Dark', 'movie', null).list.state, 'update');
  assert.strictEqual(d('Lupin', 'show', { season: 1, episode: 1 }).list.state, 'ambiguous');
  const nouveau = d('Arcane', 'show', { season: 1, episode: 9 });
  assert.strictEqual(nouveau.list, null);
  assert.strictEqual(nouveau.tmdb.state, 'pending');
  assert.strictEqual(nouveau.key, 'show:arcane', 'clé indépendante de la source');
  assert.strictEqual(I.detectedFilter(nouveau), 'pending');
  assert.strictEqual(I.detectedFilter(d('Dark', 'show', { season: 2, episode: 1 })), 'updates');
});

/* ---------- TMDB ---------- */
const TV = (id, name, date, popularity, extra) => Object.assign({ id, name, original_name: name, first_air_date: date, popularity, media_type: 'tv', poster_path: '/' + id + '.jpg', vote_average: 8.123, overview: 'x' }, extra || {});
test('TMDB : candidat sans ambiguïté (seul, bien plus ressemblant, ou bien plus connu) sinon à choisir', () => {
  const g = { kind: 'show', title: 'Arcane', year: '' };
  let r = I.rankCandidates(g, [TV(94605, 'Arcane', '2021-11-06', 120), { id: 9, title: 'Arcane', media_type: 'movie' }]);
  assert.strictEqual(r.length, 1, 'mauvais type écarté');
  assert.ok(I.isUnambiguous(r));
  assert.strictEqual(r[0].score, 8.1);
  r = I.rankCandidates(g, [TV(1, 'Arcane', '2021-11-06', 120), TV(2, 'Arcane', '1998-01-01', 2)]);
  assert.ok(I.isUnambiguous(r), 'homonyme très peu connu');
  r = I.rankCandidates({ kind: 'show', title: 'The Office' }, [TV(2316, 'The Office', '2005-03-24', 300), TV(2996, 'The Office', '2001-07-09', 120)]);
  assert.ok(!I.isUnambiguous(r), 'deux séries connues du même nom : à choisir');
  r = I.rankCandidates({ kind: 'show', title: 'The Office', year: '2001' }, [TV(2316, 'The Office', '2005-03-24', 300), TV(2996, 'The Office', '2001-07-09', 120)]);
  assert.strictEqual(r[0].tmdbId, 2996, 'l\'année départage');
  assert.ok(I.isUnambiguous(r));
  r = I.rankCandidates({ kind: 'show', title: 'Money Heist' }, [TV(71446, 'La casa de papel', '2017-05-02', 100, { original_name: 'La casa de papel' })]);
  assert.strictEqual(r.length, 0, 'titre trop différent : pas de candidat');
  r = I.rankCandidates({ kind: 'show', title: 'Money Heist' }, [TV(71446, 'Money Heist', '2017-05-02', 100, { original_name: 'La casa de papel' })]);
  assert.strictEqual(r.length, 1);
});

test('TMDB : fiche déjà dans la liste sous un autre titre -> mise à jour, pas de doublon', () => {
  const d = I.detectedFromGroup({ key: 'k', kind: 'show', title: 'Money Heist', altTitles: [], progress: { season: 2, episode: 3 }, dateMs: 1 }, LIST, 'netflix');
  I.applyTmdbResults(d, [TV(71446, 'Money Heist', '2017-05-02', 100)]);
  assert.strictEqual(d.tmdb.state, 'unambiguous');
  I.linkByTmdbId(d, LIST, 0);
  assert.strictEqual(d.list.state, 'update');
  assert.strictEqual(d.list.viaTmdb, true);
  assert.strictEqual(d.list.matches[0].id, 'u-papel');
  assert.strictEqual(d.list.matches[0].poster, '/p.jpg');
});

test('TMDB : série terminée seulement si le dernier épisode vu est le dernier diffusé et la série finie', () => {
  const details = { status: 'Ended', in_production: false, seasons: [{ season_number: 0, episode_count: 3 }, { season_number: 1, episode_count: 10 }, { season_number: 2, episode_count: 8 }] };
  assert.strictEqual(I.isSeriesFinished({ season: 2, episode: 8 }, details), true);
  assert.strictEqual(I.isSeriesFinished({ season: 2, episode: 7 }, details), false);
  assert.strictEqual(I.isSeriesFinished({ season: 1, episode: 10 }, details), false);
  assert.strictEqual(I.isSeriesFinished({ season: 2, episode: 8 }, Object.assign({}, details, { status: 'Returning Series' })), false);
  assert.strictEqual(I.isSeriesFinished({ season: 2, episode: 8 }, Object.assign({}, details, { in_production: true })), false);
  assert.strictEqual(I.isSeriesFinished(null, details), false);
});

test('anime : détection (comme le site) et genre par mots-clés', () => {
  assert.ok(I.isAnimeCandidate({ title: 'Frieren', overview: 'An anime about elves' }));
  assert.ok(I.isAnimeCandidate({ title: 'Frieren', overview: '', genreIds: [16, 10765], originCountry: ['JP'] }));
  assert.ok(!I.isAnimeCandidate({ title: 'Arcane', overview: 'Animated series', genreIds: [16], originCountry: ['US'] }));
  assert.strictEqual(I.detectAnimeGenreFromKeywords(['Animation', 'isekai']), 'isekai');
  assert.strictEqual(I.detectAnimeGenreFromKeywords(['Action & Adventure']), 'shonen');
  assert.strictEqual(I.detectAnimeGenreFromKeywords([]), 'autre');
});

/* ---------- Ce qui part au clic sur « Appliquer » ---------- */
test('appliquer : seules les lignes cochées partent ; mises à jour par identifiant, ajouts par fiche TMDB', () => {
  const upd = I.detectedFromGroup({ key: 'a', kind: 'show', title: 'Dark', progress: { season: 2, episode: 1 }, dateMs: 1 }, LIST, 'netflix');
  const film = I.detectedFromGroup({ key: 'b', kind: 'movie', title: 'Dark', progress: null, dateMs: 1 }, LIST, 'netflix');
  const amb = I.detectedFromGroup({ key: 'c', kind: 'show', title: 'Lupin', progress: { season: 1, episode: 5 }, dateMs: 1 }, LIST, 'netflix');
  const serie = I.applyTmdbResults(I.detectedFromGroup({ key: 'd', kind: 'show', title: 'Arcane', progress: { season: 2, episode: 9 }, dateMs: 1 }, LIST, 'netflix'),
    [TV(94605, 'Arcane', '2021-11-06', 120)]);
  serie.finished = true;
  const anime = I.applyTmdbResults(I.detectedFromGroup({ key: 'e', kind: 'show', title: 'Frieren', progress: { season: 1, episode: 3 }, dateMs: 1 }, LIST, 'netflix'),
    [TV(209867, 'Frieren', '2023-09-29', 90, { overview: 'anime', genre_ids: [16], origin_country: ['JP'] })]);
  anime.animeGenre = 'isekai';
  const movie = I.applyTmdbResults(I.detectedFromGroup({ key: 'f', kind: 'movie', title: 'Glass Onion', progress: null, dateMs: 1 }, LIST, 'netflix'),
    [{ id: 661374, title: 'Glass Onion', release_date: '2022-11-23', media_type: 'movie', poster_path: 'https://evil/x.jpg', vote_average: 7.1, overview: 'o' }]);
  const noProgress = I.applyTmdbResults(I.detectedFromGroup({ key: 'g', kind: 'show', title: 'Arcane bis', progress: null, dateMs: 1 }, LIST, 'netflix'),
    [TV(5, 'Arcane bis', '2020-01-01', 5)]);
  const unchecked = I.detectedFromGroup({ key: 'h', kind: 'show', title: 'La Casa de Papel', progress: { season: 1, episode: 1 }, dateMs: 1 }, LIST, 'netflix');
  const all = [upd, film, amb, serie, anime, movie, noProgress, unchecked];
  const sel = {};
  for (const d of all) sel[d.key] = { checked: true, candidate: 0, target: null };
  sel[unchecked.key].checked = false;
  let p = I.buildApplyPayload(all, sel);
  assert.deepStrictEqual(p.updates, [{ id: 'u-dark', kind: 'episode', season: 2, episode: 1 }, { id: 'u-darkf', kind: 'movie' }], 'Lupin ambigu sans choix : rien');
  assert.deepStrictEqual(p.inserts, [
    { tmdb_id: 94605, tmdb_type: 'tv', type: 'serie', status: 'termine', title: 'Arcane', year: '2021', poster_path: '/94605.jpg', overview: 'x', tmdb_score: 8.1, saison: 2, episode: 9 },
    { tmdb_id: 209867, tmdb_type: 'tv', type: 'anime', status: 'encours', title: 'Frieren', year: '2023', poster_path: '/209867.jpg', overview: 'anime', tmdb_score: 8.1, saison: 1, episode: 3, anime_genre: 'isekai' },
    { tmdb_id: 661374, tmdb_type: 'movie', type: 'film', status: 'termine', title: 'Glass Onion', year: '2022', poster_path: null, overview: 'o', tmdb_score: 7.1 },
  ], 'série sans saison/épisode connue : pas d\'ajout ; affiche invalide retirée');
  sel[amb.key].target = 'u-lupin2';
  p = I.buildApplyPayload(all, sel);
  assert.ok(p.updates.some((u) => u.id === 'u-lupin2' && u.season === 1 && u.episode === 5), 'Lupin : titre choisi mis à jour');
  sel[amb.key].target = 'u-dark';
  assert.ok(!I.buildApplyPayload(all, sel).updates.some((u) => u.id === 'u-dark' && u.episode === 5), 'cible hors des correspondances refusée');
  assert.strictEqual(I.defaultChecked(serie), true);
  assert.strictEqual(I.defaultChecked(amb), false);
  assert.strictEqual(I.defaultChecked(noProgress), false);
});

test('appliquer : lots bornés aux limites de la RPC (500 mises à jour, 200 ajouts)', () => {
  const p = { updates: Array.from({ length: 1201 }, (_, i) => ({ id: String(i) })), inserts: Array.from({ length: 450 }, (_, i) => ({ tmdb_id: i })) };
  const chunks = I.chunkPayload(p);
  assert.strictEqual(chunks.length, 3);
  assert.ok(chunks.every((c) => c.updates.length <= 500 && c.inserts.length <= 200));
  assert.strictEqual(chunks.reduce((n, c) => n + c.updates.length, 0), 1201);
  assert.strictEqual(chunks.reduce((n, c) => n + c.inserts.length, 0), 450);
  assert.deepStrictEqual(I.chunkPayload({ updates: [], inserts: [] }), []);
});

/* ---------- Liste locale : fusion, « Ignorer », détections en direct ---------- */
test('fusion : une ligne par titre (historique + CSV + direct), position la plus avancée, Ignorer définitif', () => {
  const a = I.detectedFromGroup({ key: 'x', kind: 'show', title: 'Arcane', progress: { season: 1, episode: 3, approx: true }, dateMs: 100 }, [], 'netflix_csv');
  const b = I.detectedFromGroup({ key: 'y', kind: 'show', title: 'ARCANE', progress: { season: 1, episode: 9 }, dateMs: 200 }, [], 'netflix');
  let m = I.mergeDetected([a], [b]);
  assert.strictEqual(m.length, 1);
  assert.deepStrictEqual(m[0].progress, { season: 1, episode: 9 });
  assert.strictEqual(m[0].source, 'netflix');
  assert.strictEqual(m[0].dateMs, 200);
  m[0].dismissed = true;
  const c = I.detectedFromGroup({ key: 'z', kind: 'show', title: 'Arcane', progress: { season: 2, episode: 1 }, dateMs: 300 }, [], 'netflix');
  m = I.mergeDetected(m, [c]);
  assert.strictEqual(m[0].dismissed, true);
  assert.deepStrictEqual(m[0].progress, { season: 1, episode: 9 }, 'ignoré : plus jamais réaffiché');
});

test('fusion : un titre déjà appliqué ne revient qu\'avec un visionnage plus récent', () => {
  const a = I.detectedFromGroup({ key: 'x', kind: 'show', title: 'Arcane', progress: { season: 1, episode: 3 }, dateMs: 100 }, [], 'netflix');
  a.applied = true;
  let m = I.mergeDetected([a], [I.detectedFromGroup({ key: 'x', kind: 'show', title: 'Arcane', progress: { season: 1, episode: 3 }, dateMs: 100 }, [], 'netflix')]);
  assert.strictEqual(m[0].applied, true);
  m = I.mergeDetected(m, [I.detectedFromGroup({ key: 'x', kind: 'show', title: 'Arcane', progress: { season: 1, episode: 5 }, dateMs: 500 }, [], 'netflix')]);
  assert.strictEqual(m[0].applied, false);
  assert.deepStrictEqual(m[0].progress, { season: 1, episode: 5 });
});

test('direct : seules les détections « pas dans ta liste » / « plusieurs titres » arrivent dans la page', () => {
  const d = I.detectedFromLive({ at: 5, kind: 'episode', title: '1899', season: 1, episode: 1, status: 'not_found' });
  assert.strictEqual(d.key, 'show:1899');
  assert.strictEqual(d.source, 'live');
  assert.deepStrictEqual(d.progress, { season: 1, episode: 1 });
  assert.strictEqual(I.detectedFromLive({ kind: 'movie', title: 'Matrix', status: 'ambiguous' }).kind, 'movie');
  assert.strictEqual(I.detectedFromLive({ kind: 'episode', title: 'Dark', season: 1, episode: 1, status: 'updated' }), null);
  assert.strictEqual(I.detectedFromLive({ kind: 'episode', title: 'Dark', season: null, episode: null, status: 'not_found' }), null);
  assert.strictEqual(I.detectedFromLive({ kind: 'movie', title: '   ', status: 'not_found' }), null);
});

test('liste rechargée : chaque ligne est recalculée (titre ajouté entre-temps -> mise à jour ou déjà à jour)', () => {
  const d = I.detectedFromGroup({ key: 'x', kind: 'show', title: 'Arcane', progress: { season: 1, episode: 3 }, dateMs: 1 }, [], 'netflix');
  assert.strictEqual(d.list, null);
  I.refreshAgainstList(d, [{ id: 'n1', title: 'Arcane', norm: 'arcane', type: 'serie', status: 'encours', season: 1, episode: 3 }]);
  assert.strictEqual(d.list.state, 'unchanged');
  I.refreshAgainstList(d, []);
  assert.strictEqual(d.list, null);
});

/* ---------- Sécurité de la page et du manifeste ---------- */
test('page « Titres détectés » : pas d\'innerHTML, pas de script en ligne, relai limité à netflix.com', () => {
  const page = read('extension/import-page.js');
  const lib = read('extension/lib/import.js');
  for (const src of [page, lib]) {
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(code, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/);
    assert.doesNotMatch(code, /console\.(log|debug|info|warn|error)/);
  }
  assert.match(page, /url\.indexOf\('https:\/\/www\.netflix\.com\/'\) !== 0/);
  const html = read('extension/import.html');
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, 'aucun script en ligne');
  assert.doesNotMatch(html, /\son\w+=/i);
  assert.match(html, /<script src="lib\/import\.js"><\/script>\s*<script src="import-page\.js"><\/script>/);
});

test('manifeste 0.5.0 : permissions minimales et CSP stricte des pages de l\'extension', () => {
  const m = JSON.parse(read('extension/manifest.json'));
  assert.strictEqual(m.version, '0.5.0');
  assert.deepStrictEqual(m.permissions, ['storage', 'scripting']);
  assert.deepStrictEqual(m.host_permissions, ['https://batfulcvvquffgfeppcx.supabase.co/*', 'https://www.netflix.com/*', 'https://cinepisode.com/*']);
  const csp = m.content_security_policy.extension_pages;
  assert.match(csp, /script-src 'self';/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /connect-src https:\/\/batfulcvvquffgfeppcx\.supabase\.co https:\/\/cinepisode\.com;/);
  assert.match(csp, /img-src 'self' https:\/\/image\.tmdb\.org;/);
  assert.doesNotMatch(csp, /unsafe-eval|\*/);
  assert.ok(!m.permissions.includes('tabs') && !m.permissions.includes('history') && !m.permissions.includes('cookies'));
});
