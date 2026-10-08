'use strict';
/*
 * Extension 0.5.0 : lecture de l'historique Netflix et du CSV, puis éléments envoyés à
 * extension_push_detections (onglet « Détectés » du site). Tout est testé sans réseau.
 * La correspondance avec la liste et le choix TMDB sont dans le site : tests/detected.test.js.
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

/* ---------- Ce qui est envoyé à Cinepisode (extension_push_detections) ---------- */
const PUSH_KEYS = ['episode', 'progress_pct', 'season', 'source', 'title', 'type', 'watched_at'];
test('envoi : une ligne par titre, champs minimaux, épisode le plus avancé, pourcentage du dernier épisode', () => {
  const raw = I.parseNetflixHistoryPage(PAGE([
    EP(93, 80, 'Dark', 1700000300000, { bookmark: 600, duration: 3000 }),
    EP(92, 80, 'Dark', 1700000200000, { bookmark: 2900, duration: 3000 }),
    { movieID: 70, title: 'Inception', date: 1690000000000, bookmark: 1500, duration: 3000 },
  ]));
  const groups = I.aggregateHistory(raw);
  I.applyMetadata(groups[0], I.parseNetflixMetadata(META_DARK));
  const items = I.pushItemsFromGroups(groups, 'netflix');
  assert.strictEqual(items.length, 2);
  for (const it of items) assert.deepStrictEqual(Object.keys(it).sort(), PUSH_KEYS, 'aucun identifiant Netflix, aucune autre donnée');
  assert.deepStrictEqual(plain(items[0]), { source: 'netflix', title: 'Dark', type: 'show', season: 2, episode: 2, watched_at: 1700000300000, progress_pct: 97 });
  assert.deepStrictEqual(plain(items[1]), { source: 'netflix', title: 'Inception', type: 'movie', season: null, episode: null, watched_at: 1690000000000, progress_pct: 50 });
});

test('envoi : série sans épisode connu (numéros masqués), source inconnue, titre vide', () => {
  const g = I.aggregateHistory(I.parseNetflixHistoryPage(PAGE([EP(81, 80, 'Doc', 1)])))[0];
  I.applyMetadata(g, I.parseNetflixMetadata({ video: Object.assign({}, META_DARK.video, { hiddenEpisodeNumbers: true }) }));
  const it = I.pushItemFromGroup(g, 'netflix');
  assert.strictEqual(it.season, null);
  assert.strictEqual(it.episode, null);
  assert.strictEqual(I.pushItemFromGroup(g, 'hulu'), null);
  assert.strictEqual(I.pushItemFromGroup({ kind: 'movie', title: '  ' }, 'netflix'), null);
  assert.strictEqual(I.pushItemFromGroup({ kind: 'movie', title: 'x'.repeat(400), dateMs: -5 }, 'netflix').title.length, 300);
  assert.strictEqual(I.pushItemFromGroup({ kind: 'movie', title: 'X', dateMs: -5 }, 'netflix').watched_at, null);
});

test('envoi : fichier CSV -> source netflix_csv, épisode estimé envoyé tel quel', () => {
  const r = I.parseNetflixCsv('Title,Date\n"Dark: Saison 2: Épisode 4","27/06/2019"\n"Inception","16/07/2010"\n');
  const items = I.pushItemsFromGroups(r.items, 'netflix_csv');
  const dark = items.find((i) => i.title === 'Dark');
  assert.deepStrictEqual([dark.source, dark.type, dark.season, dark.episode], ['netflix_csv', 'show', 2, 4]);
  assert.strictEqual(items.find((i) => i.title === 'Inception').type, 'movie');
});

test('direct : détection sans correspondance -> élément « live » (épisode exact obligatoire)', () => {
  assert.deepStrictEqual(plain(I.pushItemFromLive({ kind: 'episode', title: '1899', season: 1, episode: 1 }, 5)),
    { source: 'live', title: '1899', type: 'show', season: 1, episode: 1, watched_at: 5, progress_pct: null });
  assert.strictEqual(I.pushItemFromLive({ kind: 'movie', title: 'Matrix' }, 5).type, 'movie');
  assert.strictEqual(I.pushItemFromLive({ kind: 'episode', title: 'Dark', season: null, episode: null }, 5), null);
  assert.strictEqual(I.pushItemFromLive({ kind: 'movie', title: '   ' }, 5), null);
});

test('envoi : lots de 1 000 au plus (limite de la RPC), date du dernier import', () => {
  const items = Array.from({ length: 2501 }, (_, i) => ({ title: String(i) }));
  const chunks = I.chunkItems(items);
  assert.deepStrictEqual(chunks.map((c) => c.length), [1000, 1000, 501]);
  assert.deepStrictEqual(I.chunkItems([]), []);
  assert.strictEqual(I.latestDate([{ dateMs: 5 }, { dateMs: 9 }, {}], 7), 9);
  assert.strictEqual(I.latestDate([], null), null);
});

/* ---------- Sécurité de l'extension ---------- */
test('extension : plus de page d\'import ni de TMDB, relai limité à netflix.com, pas de journal', () => {
  for (const f of ['extension/import.html', 'extension/import-page.js', 'extension/import.css']) assert.ok(!fs.existsSync(path.join(ROOT, f)), f);
  const lib = read('extension/lib/import.js');
  const bg = read('extension/background.js');
  const opts = read('extension/options.js');
  for (const src of [lib, bg, opts]) {
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(code, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/);
    assert.doesNotMatch(code, /console\.(log|debug|info|warn|error)/);
    assert.doesNotMatch(code, /api\/tmdb|X-Cinepisode-Token|themoviedb/i, 'aucun appel TMDB depuis l\'extension');
  }
  assert.match(bg, /url\.indexOf\('https:\/\/www\.netflix\.com\/'\) !== 0/);
  assert.match(bg, /extension_push_detections/);
  assert.match(bg, /https:\/\/cinepisode\.com\/#detectes/);
  assert.doesNotMatch(read('extension/options.html'), /<script(?![^>]*\bsrc=)[^>]*>/i, 'aucun script en ligne');
  assert.doesNotMatch(read('extension/options.html'), /\son\w+=/i);
});

test('manifeste 0.6.2 : permissions minimales (pas de cinepisode.com), plateformes facultatives et CSP stricte', () => {
  const m = JSON.parse(read('extension/manifest.json'));
  assert.strictEqual(m.version, '0.6.2');
  assert.strictEqual(m.name, '__MSG_extName__', 'nom inchangé (fiche Chrome Web Store)');
  assert.strictEqual(m.short_name, 'Cinepisode');
  assert.ok(!('key' in m), 'pas de clé ajoutée : identifiant de l\'extension inchangé');
  assert.deepStrictEqual(m.permissions, ['storage', 'scripting']);
  assert.deepStrictEqual(m.host_permissions, ['https://batfulcvvquffgfeppcx.supabase.co/*', 'https://www.netflix.com/*'], 'avertissement à l\'installation : Netflix et Cinepisode seulement');
  assert.deepStrictEqual(m.optional_host_permissions, ['https://www.crunchyroll.com/*', 'https://static.crunchyroll.com/*',
    'https://www.primevideo.com/*', 'https://atv-ps.primevideo.com/*', 'https://atv-ps-eu.primevideo.com/*', 'https://atv-ps-fe.primevideo.com/*']);
  const P = require('../extension/lib/platforms.js');
  assert.deepStrictEqual([...P.crunchyroll.origins, ...P.prime.origins], m.optional_host_permissions, 'permissions demandées = permissions facultatives du manifeste');
  for (const p of Object.values(P)) for (const c of p.scripts) for (const mt of c.matches) {
    assert.ok(p.origins.includes(mt), 'script enregistré sur un site couvert par la permission : ' + mt);
    for (const f of c.js) assert.ok(fs.existsSync(path.join(ROOT, 'extension', f)), f);
  }
  const csp = m.content_security_policy.extension_pages;
  assert.match(csp, /script-src 'self';/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /connect-src https:\/\/batfulcvvquffgfeppcx\.supabase\.co https:\/\/www\.crunchyroll\.com https:\/\/www\.primevideo\.com https:\/\/atv-ps\.primevideo\.com https:\/\/atv-ps-eu\.primevideo\.com https:\/\/atv-ps-fe\.primevideo\.com;/);
  assert.match(csp, /img-src 'self';/);
  assert.doesNotMatch(csp, /unsafe-eval|\*|cinepisode\.com/);
  assert.ok(!m.permissions.includes('tabs') && !m.permissions.includes('history') && !m.permissions.includes('cookies'));
});
