'use strict';
/*
 * Extension 0.6.0 : Crunchyroll et Prime Video.
 *  - historique : lecture des réponses (fixtures réalistes dans tests/fixtures), regroupement,
 *    éléments envoyés à extension_push_detections ;
 *  - détection en direct : règles communes (80 % / générique / 20 s), scripts de page ;
 *  - service worker : permission exigée, expéditeurs vérifiés, scripts enregistrés à l'activation ;
 *  - fenêtre de l'extension : boutons « Activer » / « Importer ».
 * Lancer : node --test tests/
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const fixture = f => JSON.parse(read('tests/fixtures/' + f));
const CR = require('../extension/lib/crunchyroll.js');
const PV = require('../extension/lib/prime.js');
const W = require('../extension/lib/watch-rules.js');
const I = require('../extension/lib/import.js');
const PLATFORMS = require('../extension/lib/platforms.js');
const plain = v => JSON.parse(JSON.stringify(v));
const resp = (status, data) => ({ status, body: typeof data === 'string' ? data : JSON.stringify(data) });

/* ---------------- Crunchyroll : historique ---------------- */
test('Crunchyroll : un élément de l\'historique -> série, saison brute, épisode, date, pourcentage', () => {
  const [ep, partial, dub, movie] = fixture('crunchyroll-history-p1.json').data;
  assert.deepStrictEqual(CR.parseHistoryEntry(ep), { kind: 'show', seriesId: 'GRDV0019R', title: 'JUJUTSU KAISEN', season: 2, episode: 5,
    dateMs: Date.parse('2026-09-30T20:15:42Z'), pct: 100, done: true });
  const p = CR.parseHistoryEntry(partial);
  assert.strictEqual(p.pct, 21, 'playhead en secondes / duration_ms');
  assert.strictEqual(p.done, false);
  const d = CR.parseHistoryEntry(dub);
  assert.strictEqual(d.title, 'JUJUTSU KAISEN', 'suffixe « (French Dub) » retiré');
  assert.strictEqual(d.done, true, '83 % : vu');
  const m = CR.parseHistoryEntry(movie);
  assert.deepStrictEqual([m.kind, m.title, m.pct], ['movie', 'JUJUTSU KAISEN 0', 100]);
  assert.strictEqual(CR.parseHistoryEntry(null), null);
  assert.strictEqual(CR.parseHistoryEntry({ panel: { type: 'episode', episode_metadata: { series_title: '' } } }), null);
  assert.strictEqual(CR.cleanTitle('Frieren (VOSTFR)'), 'Frieren');
  assert.strictEqual(CR.cleanTitle('Re:ZERO (Castilian Dub)'), 'Re:ZERO');
});

test('Crunchyroll : page v2 et ancienne forme v1 ; réponse inattendue refusée', () => {
  const p1 = CR.parseHistoryPage(fixture('crunchyroll-history-p1.json'));
  assert.strictEqual(p1.raw, 5);
  assert.strictEqual(p1.entries.length, 5);
  assert.match(p1.next, /page=2/);
  assert.strictEqual(CR.parseHistoryPage(fixture('crunchyroll-history-p2.json')).next, null);
  const v1 = CR.parseHistoryPage({ items: fixture('crunchyroll-history-p2.json').data, next_page: null });
  assert.strictEqual(v1.entries[0].title, 'SPY x FAMILY');
  assert.strictEqual(CR.parseHistoryPage({ error: 'x' }), null);
  assert.strictEqual(CR.parseHistoryPage('<html>'), null);
});

function crFetch({ token = resp(200, { access_token: 'at-1', account_id: 'acc-123', expires_in: 300, token_type: 'Bearer' }), pages } = {}) {
  const calls = [];
  const queue = pages || [resp(200, fixture('crunchyroll-history-p1.json')), resp(429, ''), resp(200, fixture('crunchyroll-history-p2.json'))];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    if (url.endsWith('/auth/v1/token')) return token;
    return queue.length ? queue.shift() : resp(200, { data: [], meta: {} });
  };
  return { fn, calls };
}

test('Crunchyroll : jeton etp_rt_cookie, pages, pause sur 429, regroupement (épisode fini le plus avancé)', async () => {
  const { fn, calls } = crFetch();
  const progress = [];
  const out = await CR.fetchHistory(fn, { deviceId: 'dev-1', locale: 'fr-FR', onProgress: (p, n) => progress.push([p, n]) });
  const tok = calls[0];
  assert.strictEqual(tok.url, 'https://www.crunchyroll.com/auth/v1/token');
  assert.strictEqual(tok.opts.method, 'POST');
  assert.strictEqual(tok.opts.credentials, 'include', 'cookie de session ajouté par le navigateur, jamais lu');
  assert.match(tok.opts.headers.Authorization, /^Basic /);
  assert.match(tok.opts.body, /^grant_type=etp_rt_cookie&scope=offline_access&device_id=dev-1&device_type=/);
  assert.strictEqual(calls[1].url, 'https://www.crunchyroll.com/content/v2/acc-123/watch-history?page=1&page_size=100&locale=fr-FR');
  assert.strictEqual(calls[1].opts.headers.Authorization, 'Bearer at-1');
  assert.deepStrictEqual(calls.slice(1).map(c => /page=(\d+)/.exec(c.url)[1]), ['1', '2', '2'], 'page 2 redemandée après le 429');
  assert.deepStrictEqual(progress, [[1, 5], [2, 6]]);
  assert.strictEqual(out.truncated, false);
  const items = I.pushItemsFromGroups(out.items, 'crunchyroll');
  assert.deepStrictEqual(plain(items), [
    { source: 'crunchyroll', title: 'JUJUTSU KAISEN', type: 'show', season: 2, episode: 5, watched_at: Date.parse('2026-09-30T20:40:00Z'), progress_pct: 100 },
    { source: 'crunchyroll', title: 'JUJUTSU KAISEN 0', type: 'movie', season: null, episode: null, watched_at: Date.parse('2026-09-10T21:00:00Z'), progress_pct: 100 },
    { source: 'crunchyroll', title: 'SPY x FAMILY', type: 'show', season: 2, episode: 12, watched_at: Date.parse('2026-07-01T18:00:00Z'), progress_pct: 81 },
  ], 'Frieren (13 %) : entamé seulement, pas envoyé ; épisode 6 à 21 % : pas compté');
});

test('Crunchyroll : réimport incrémental, session absente, erreur serveur', async () => {
  const a = crFetch();
  const out = await CR.fetchHistory(a.fn, { sinceMs: Date.parse('2026-09-11T00:00:00Z') });
  assert.strictEqual(a.calls.length, 2, 'éléments déjà lus atteints : pas de page 2');
  assert.deepStrictEqual(out.items.map(g => g.title), ['JUJUTSU KAISEN']);
  await assert.rejects(CR.fetchHistory(crFetch({ token: resp(401, { error: 'invalid_grant' }) }).fn, {}), e => e.code === 'crunchyroll_auth');
  await assert.rejects(CR.fetchHistory(crFetch({ token: resp(200, { error: 'x' }) }).fn, {}), e => e.code === 'crunchyroll_auth');
  await assert.rejects(CR.fetchHistory(crFetch({ pages: [resp(500, 'boom')] }).fn, {}), e => e.code === 'crunchyroll_http');
  await assert.rejects(CR.fetchHistory(crFetch({ pages: [resp(403, '<html>Cloudflare</html>')] }).fn, {}), e => e.code === 'crunchyroll_auth');
});

/* ---------------- Prime Video : historique ---------------- */
test('Prime Video : page d\'historique (enfants aplatis), pourcentages, fiches (bandes-annonces écartées, « [4K/UHD] » retiré)', () => {
  const p1 = PV.parseHistoryPage(fixture('prime-history-p1.json'));
  assert.deepStrictEqual(p1.entries.map(e => e.gti), ['amzn1.dv.gti.boys-s4e3', 'amzn1.dv.gti.boys-s4e2', 'amzn1.dv.gti.boys-s4e4',
    'amzn1.dv.gti.trailer-gladiator', 'amzn1.dv.gti.saltburn', 'amzn1.dv.gti.reacher-s2e8']);
  assert.strictEqual(p1.next, 'eyJwYWdlIjoyfQ==');
  assert.strictEqual(PV.parseHistoryPage(fixture('prime-history-p2.json')).next, null);
  assert.deepStrictEqual(PV.parseHistoryPage({ widgets: [{ widgetType: 'watch-history', content: { content: { header: 'Rien', message: 'Aucun titre' } } }] }), { entries: [], next: null });
  assert.strictEqual(PV.parseHistoryPage({ widgets: [] }), null);
  assert.strictEqual(PV.parseHistoryPage(null), null);
  const pct = PV.parseEnrichments(fixture('prime-enrich.json'));
  assert.strictEqual(pct['amzn1.dv.gti.boys-s4e4'], 12);
  const items = fixture('prime-items.json');
  assert.deepStrictEqual(PV.parseItem(items['amzn1.dv.gti.boys-s4e3']), { kind: 'show', title: 'The Boys', season: 4, episode: 3 });
  assert.deepStrictEqual(PV.parseItem(items['amzn1.dv.gti.reacher-s2e8']), { kind: 'show', title: 'Reacher', season: 2, episode: 8 });
  assert.deepStrictEqual(PV.parseItem(items['amzn1.dv.gti.trailer-gladiator']), { skip: true });
  assert.deepStrictEqual(PV.parseItem(items['amzn1.dv.gti.anatomie']), { kind: 'movie', title: 'Anatomie d\'une chute' });
  assert.deepStrictEqual(PV.parseItem({ catalogMetadata: { catalog: { entityType: 'Bonus Content', title: 'Making-of' } } }), { skip: true });
  assert.strictEqual(PV.parseItem({}), null);
  assert.strictEqual(PV.cleanTitle('Fallout - Saison 1'), 'Fallout');
});

function pvFetch({ config = resp(200, { customerConfig: { homeRegion: 'EU' }, territoryConfig: { defaultVideoWebsite: 'https://www.amazon.fr' } }), history } = {}) {
  const calls = [];
  const items = fixture('prime-items.json');
  const enrich = fixture('prime-enrich.json').enrichments;
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    const u = new URL(url);
    if (u.pathname.endsWith('/GetAppStartupConfig')) return config;
    if (u.pathname.endsWith('/getWatchHistorySettingsPage')) {
      if (history) return history;
      const args = JSON.parse(u.searchParams.get('widgetArgs'));
      return resp(200, fixture(args.nextToken ? 'prime-history-p2.json' : 'prime-history-p1.json'));
    }
    if (u.pathname.endsWith('/enrichItemMetadata')) {
      const ids = JSON.parse(u.searchParams.get('titleIDsToEnrich'));
      return resp(200, { enrichments: Object.fromEntries(ids.filter(i => enrich[i]).map(i => [i, enrich[i]])) });
    }
    if (u.pathname.endsWith('/GetPlaybackResources')) {
      const it = items[u.searchParams.get('asin')];
      return it ? resp(200, it) : resp(404, '');
    }
    return resp(404, '');
  };
  return { fn, calls };
}

test('Prime Video : région EU, pages nextToken, fiches seulement pour les éléments vus, regroupement', async () => {
  const { fn, calls } = pvFetch();
  const steps = [];
  const out = await PV.fetchHistory(fn, { deviceId: 'dev-1', uxLocale: 'fr_FR', onProgress: (s, a, b) => steps.push([s, a, b]) });
  assert.strictEqual(out.region, 'eu');
  const hist = calls.filter(c => /getWatchHistorySettingsPage/.test(c.url));
  assert.strictEqual(hist.length, 2);
  assert.ok(hist.every(c => c.url.startsWith('https://www.primevideo.com/region/eu/api/')), 'site www.primevideo.com (seul domaine autorisé)');
  assert.strictEqual(hist[0].opts.headers['x-requested-with'], 'XMLHttpRequest');
  assert.strictEqual(hist[0].opts.credentials, 'include');
  const meta = calls.filter(c => /GetPlaybackResources/.test(c.url));
  assert.ok(meta.every(c => c.url.startsWith('https://atv-ps-eu.primevideo.com/cdp/catalog/GetPlaybackResources?asin=')));
  assert.ok(meta.every(c => /deviceTypeID=AOAGZA014O5RE/.test(c.url) && /uxLocale=fr_FR/.test(c.url) && /deviceID=dev-1/.test(c.url)));
  assert.deepStrictEqual(meta.map(c => new URL(c.url).searchParams.get('asin')).sort(), ['amzn1.dv.gti.anatomie', 'amzn1.dv.gti.boys-s4e2',
    'amzn1.dv.gti.boys-s4e3', 'amzn1.dv.gti.fallout-s1e1', 'amzn1.dv.gti.reacher-s2e8', 'amzn1.dv.gti.trailer-gladiator'],
  'épisode à 12 % et film à 4 % (lectures courtes) : aucune fiche demandée');
  assert.deepStrictEqual(steps.filter(s => s[0] === 'history'), [['history', 1, 6], ['history', 2, 8]]);
  assert.deepStrictEqual(steps[steps.length - 1], ['meta', 6, 6]);
  assert.strictEqual(out.metaFailed, false);
  assert.deepStrictEqual(plain(I.pushItemsFromGroups(out.items, 'prime')), [
    { source: 'prime', title: 'The Boys', type: 'show', season: 4, episode: 3, watched_at: 1791230400000, progress_pct: 100 },
    { source: 'prime', title: 'Reacher', type: 'show', season: 2, episode: 8, watched_at: 1790870000000, progress_pct: 95 },
    { source: 'prime', title: 'Fallout', type: 'show', season: 1, episode: 1, watched_at: 1789200000000, progress_pct: 88 },
    { source: 'prime', title: 'Anatomie d\'une chute', type: 'movie', season: null, episode: null, watched_at: 1789100000000, progress_pct: 99 },
  ], 'bande-annonce écartée ; S4E4 à 12 % non compté');
});

test('Prime Video : région par défaut (EU), réimport incrémental, page de connexion -> session absente', async () => {
  const a = pvFetch({ config: resp(500, '') });
  const out = await PV.fetchHistory(a.fn, { sinceMs: 1790875000000 });
  assert.ok(a.calls.some(c => c.url.startsWith('https://www.primevideo.com/region/eu/api/getWatchHistorySettingsPage')));
  assert.strictEqual(a.calls.filter(c => /getWatchHistorySettingsPage/.test(c.url)).length, 1, 'éléments déjà lus atteints : pas de page 2');
  assert.deepStrictEqual(out.items.map(g => g.title), ['The Boys']);
  const na = pvFetch({ config: resp(200, { customerConfig: { homeRegion: 'NA' } }) });
  await PV.fetchHistory(na.fn, {});
  assert.ok(na.calls.some(c => c.url.startsWith('https://atv-ps.primevideo.com/cdp/catalog/')));
  await assert.rejects(PV.fetchHistory(pvFetch({ history: resp(200, '<!doctype html><title>Amazon Sign-In</title>') }).fn, {}), e => e.code === 'prime_auth');
  await assert.rejects(PV.fetchHistory(pvFetch({ history: resp(403, '') }).fn, {}), e => e.code === 'prime_auth');
  await assert.rejects(PV.fetchHistory(pvFetch({ history: resp(503, '') }).fn, {}), e => e.code === 'prime_http');
});

/* ---------------- Règles communes de détection en direct ---------------- */
test('règles en direct : 80 % / générique après 50 % (épisode), 90 % / 80 % (film), 20 s de lecture réelle', () => {
  const tr = W.createTracker();
  let s = tr.track('a', 0, 0);
  s = tr.track('a', 5000, 5000); s = tr.track('a', 10000, 10000); s = tr.track('a', 15000, 15000);
  assert.strictEqual(s.watchedMs, 15000);
  assert.strictEqual(W.isDone('episode', 900000, 1000000, s, false), false, 'moins de 20 s observées');
  s = tr.track('a', 20000, 20000);
  s = tr.track('a', 800000, 25000);
  assert.strictEqual(s.watchedMs, 20000, 'saut dans la barre : pas compté');
  assert.strictEqual(W.isDone('episode', 790000, 1000000, s, false), false);
  assert.strictEqual(W.isDone('episode', 800000, 1000000, s, false), true);
  assert.strictEqual(W.isDone('episode', 490000, 1000000, s, true), false, 'générique jamais avant 50 %');
  assert.strictEqual(W.isDone('episode', 510000, 1000000, s, true), true);
  assert.strictEqual(W.isDone('movie', 890000, 1000000, s, false), false);
  assert.strictEqual(W.isDone('movie', 900000, 1000000, s, false), true);
  assert.strictEqual(W.isDone('movie', 810000, 1000000, s, true), true);
  assert.strictEqual(W.isDone('movie', 790000, 1000000, s, true), false);
  assert.strictEqual(W.isDone('episode', 1, Infinity, s, true), false);
});

test('règles en direct : repère saison/épisode en anglais et en français', () => {
  const cases = [['S2 E5', 2, 5], ['S2:E5 The Bridge', 2, 5], ['S1 É3', 1, 3], ['S1 Ép. 3 Le pont', 1, 3], ['Season 3, Ep. 12 Finale', 3, 12],
    ['Saison 2, ép. 5', 2, 5], ['Saison 2 Épisode 5', 2, 5], ['Saison 10, Épisode 101', 10, 101], ['s4e3', 4, 3]];
  for (const [txt, season, episode] of cases) assert.deepStrictEqual(W.parseEpisodeLabel(txt), { season, episode }, txt);
  for (const txt of ['Saltburn', 'Spider-Man 2', 'Episode 4', '', null]) assert.strictEqual(W.parseEpisodeLabel(txt), null, String(txt));
  assert.deepStrictEqual(W.detection('episode', '  The  Boys ', 4, 3), { type: 'wl_watched', kind: 'episode', title: 'The Boys', season: 4, episode: 3 });
  assert.deepStrictEqual(W.detection('movie', 'Saltburn', 1, 2), { type: 'wl_watched', kind: 'movie', title: 'Saltburn', season: null, episode: null });
  assert.strictEqual(W.detection('episode', 'X', null, 3), null);
  assert.strictEqual(W.detection('show', 'X', 1, 3), null);
  assert.strictEqual(W.detection('movie', 'x'.repeat(301)), null);
});

/* ---------------- Scripts de page (DOM simulé) ---------------- */
function pageContext({ origin, pathname = '/', dom }) {
  const listeners = [];
  const sent = [];
  let tick = null;
  const clock = { now: 1000 };
  const win = { location: { origin, pathname }, addEventListener: (t, fn) => { if (t === 'message') listeners.push(fn); } };
  const ctx = {
    window: win, location: win.location, document: dom, chrome: { runtime: { sendMessage: (m, cb) => { sent.push(plain(m)); if (cb) cb(); }, lastError: undefined } },
    Date: { now: () => clock.now }, setInterval: fn => { tick = fn; }, setTimeout: () => {}, JSON, Math, Number, String, Array, Object, isFinite, parseInt,
  };
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('extension/lib/watch-rules.js'), ctx);
  return { ctx, sent, clock, run: f => vm.runInContext(read(f), ctx), tick: () => tick(), post: (data, extra) => listeners.forEach(fn => fn(Object.assign({ data }, extra))) };
}

test('Crunchyroll en direct : métadonnées JSON-LD + position de l\'iframe du lecteur ; messages d\'ailleurs ignorés', () => {
  const frameWin = {};
  const ld = { '@context': 'https://schema.org', '@type': 'TVEpisode', url: 'https://www.crunchyroll.com/fr/watch/GRDQPM1ZY/hidden-inventory',
    name: 'Hidden Inventory', episodeNumber: '5', partOfSeason: { '@type': 'TVSeason', seasonNumber: 2 }, partOfSeries: { '@type': 'TVSeries', name: 'JUJUTSU KAISEN (French Dub)' } };
  const dom = { querySelectorAll: sel => sel === 'iframe' ? [{ contentWindow: frameWin }] : sel.startsWith('script') ? [{ textContent: JSON.stringify(ld) }] : [] };
  const p = pageContext({ origin: 'https://www.crunchyroll.com', pathname: '/fr/watch/GRDQPM1ZY/hidden-inventory', dom });
  p.run('extension/content/crunchyroll.js');
  const D = 1420000;
  const play = (t, extra = { origin: 'https://static.crunchyroll.com', source: frameWin }, end = false) => { p.clock.now += 5000; p.post({ __wlcr: true, t, d: D, paused: false, end }, extra); p.tick(); };
  /* faux messages : autre origine, fenêtre qui n'est pas une iframe de la page, mauvaise forme */
  for (let t = 1100000; t < 1300000; t += 5000) play(t, { origin: 'https://evil.example', source: frameWin });
  for (let t = 1100000; t < 1300000; t += 5000) play(t, { origin: 'https://static.crunchyroll.com', source: {} });
  p.post({ __wlcr: true, t: '1', d: D, end: false }, { origin: 'https://static.crunchyroll.com', source: frameWin });
  assert.strictEqual(p.sent.length, 0);
  for (let t = 1000000; t < 1130000; t += 5000) play(t);
  assert.strictEqual(p.sent.length, 0, 'avant 80 %');
  for (let t = 1130000; t < 1200000; t += 5000) play(t);
  assert.deepStrictEqual(p.sent, [{ type: 'wl_watched', kind: 'episode', title: 'JUJUTSU KAISEN', season: 2, episode: 5 }], 'une seule fois, saison brute de Crunchyroll');
});

test('Crunchyroll en direct : JSON-LD d\'une autre vidéo (navigation sans rechargement) -> rien', () => {
  const frameWin = {};
  const ld = { '@type': 'TVEpisode', url: 'https://www.crunchyroll.com/watch/OLDID/x', episodeNumber: 1, partOfSeason: { seasonNumber: 1 }, partOfSeries: { name: 'Old' } };
  const dom = { querySelectorAll: sel => sel === 'iframe' ? [{ contentWindow: frameWin }] : sel.startsWith('script') ? [{ textContent: JSON.stringify(ld) }] : [] };
  const p = pageContext({ origin: 'https://www.crunchyroll.com', pathname: '/watch/NEWID/y', dom });
  p.run('extension/content/crunchyroll.js');
  for (let t = 0; t < 1400000; t += 5000) { p.clock.now += 5000; p.post({ __wlcr: true, t, d: 1420000, paused: false, end: false }, { origin: 'https://static.crunchyroll.com', source: frameWin }); p.tick(); }
  assert.strictEqual(p.sent.length, 0);
});

test('Crunchyroll : le lecteur (iframe) n\'envoie qu\'à https://www.crunchyroll.com, jamais à \'*\'', () => {
  const posted = [];
  const v = { currentTime: 600, duration: 1420, paused: false, ended: false };
  let tick;
  const ctx = { document: { querySelectorAll: s => s === 'video' ? [v] : [] }, setInterval: fn => { tick = fn; }, Math, isFinite };
  ctx.window = { top: {}, parent: { postMessage: (m, o) => posted.push([plain(m), o]) } };
  vm.createContext(ctx);
  vm.runInContext(read('extension/content/crunchyroll-player.js'), ctx);
  tick();
  assert.deepStrictEqual(posted, [[{ __wlcr: true, t: 600000, d: 1420000, paused: false, end: false }, 'https://www.crunchyroll.com']]);
});

function primeDom(state) {
  const video = { get duration() { return state.duration; }, get currentTime() { return state.t; }, paused: false, closest: () => root };
  const root = {
    querySelector: sel => {
      if (sel === '.atvwebplayersdk-title-text') return state.title ? { textContent: state.title } : null;
      if (sel === '.atvwebplayersdk-episode-info, .atvwebplayersdk-subtitle-text') return state.sub ? { textContent: state.sub, getAttribute: () => null } : null;
      return null;
    },
  };
  return {
    querySelectorAll: sel => (/dv-web-player"\] video/.test(sel) ? [video] : []),
    querySelector: sel => (state.ad && /ad-timer/.test(sel) ? {} : state.end && sel === '.atvwebplayersdk-nextupcard-wrapper' ? {} : null),
  };
}

test('Prime Video en direct : repère français lu dans le lecteur, gardé quand les commandes disparaissent', () => {
  const state = { duration: 3600, t: 0, title: 'The Boys', sub: 'Saison 4, ép. 3 Ombres de Washington' };
  const p = pageContext({ origin: 'https://www.primevideo.com', dom: primeDom(state) });
  p.run('extension/content/prime.js');
  const step = () => { p.clock.now += 5000; state.t += 5; p.tick(); };
  state.t = 2700;
  step(); step();
  state.title = null; state.sub = null; /* commandes masquées pendant la lecture */
  while (state.t < 2870) step();
  assert.strictEqual(p.sent.length, 0, 'avant 80 %');
  while (state.t < 2900) step();
  assert.deepStrictEqual(p.sent, [{ type: 'wl_watched', kind: 'episode', title: 'The Boys', season: 4, episode: 3 }]);
});

test('Prime Video en direct : film à 90 % ; publicité non comptée ; autre vidéo sans titre lisible -> rien', () => {
  const state = { duration: 6000, t: 5300, title: 'Saltburn [4K/UHD]', sub: null };
  const p = pageContext({ origin: 'https://www.primevideo.com', dom: primeDom(state) });
  p.run('extension/content/prime.js');
  state.ad = true;
  for (let i = 0; i < 20; i++) { p.clock.now += 5000; state.t += 5; p.tick(); }
  assert.strictEqual(p.sent.length, 0, 'publicité : rien compté');
  state.ad = false; state.t = 5300;
  for (let i = 0; i < 20; i++) { p.clock.now += 5000; state.t += 5; p.tick(); }
  assert.deepStrictEqual(p.sent, [{ type: 'wl_watched', kind: 'movie', title: 'Saltburn', season: null, episode: null }]);
  const s2 = { duration: 1500, t: 1400, title: null, sub: null };
  const p2 = pageContext({ origin: 'https://www.primevideo.com', dom: primeDom(s2) });
  p2.run('extension/content/prime.js');
  for (let i = 0; i < 20; i++) { p2.clock.now += 5000; s2.t += 5; p2.tick(); }
  assert.strictEqual(p2.sent.length, 0);
});

/* ---------------- Service worker ---------------- */
function serviceWorker({ granted = {}, token = 'tok', routes = () => null } = {}) {
  let onMessage;
  const ev = { added: [], removed: [], installed: [], startup: [] };
  const fetches = [];
  const tabsCreated = [];
  const registered = new Map();
  const store = token ? { wlToken: token, wlDeviceId: '11111111-2222-4333-8444-555555555555' } : {};
  const isGranted = origins => origins.every(o => Object.entries(granted).some(([name, ok]) => ok && PLATFORMS[name].origins.includes(o)));
  const ctx = {
    chrome: {
      runtime: { id: 'ext-id', getURL: p => 'chrome-extension://ext-id/' + p, onMessage: { addListener: fn => { onMessage = fn; } },
        onInstalled: { addListener: fn => ev.installed.push(fn) }, onStartup: { addListener: fn => ev.startup.push(fn) } },
      i18n: { getUILanguage: () => 'fr-FR' },
      tabs: { create: o => { tabsCreated.push(o.url); } },
      permissions: { contains: (q, cb) => cb(isGranted(q.origins)), onAdded: { addListener: fn => ev.added.push(fn) }, onRemoved: { addListener: fn => ev.removed.push(fn) } },
      scripting: {
        getRegisteredContentScripts: async () => [...registered.values()],
        registerContentScripts: async list => { for (const c of list) { if (registered.has(c.id)) throw new Error('dup'); registered.set(c.id, c); } },
        unregisterContentScripts: async q => { for (const id of q.ids) registered.delete(id); },
      },
      storage: { local: {
        get: (k, cb) => cb(Object.fromEntries([].concat(k).filter(x => x in store).map(x => [x, store[x]]))),
        set: (o, cb) => { Object.assign(store, JSON.parse(JSON.stringify(o))); if (cb) cb(); },
      } },
    },
    fetch: async (url, opts) => {
      fetches.push({ url, opts });
      if (url.includes('supabase.co')) {
        const body = JSON.parse(opts.body);
        return { ok: true, status: 200, json: async () => (body.p_items ? { status: 'ok', inserted: body.p_items.length, updated: 0, unchanged: 0, invalid: 0 } : { status: 'updated', title: body.p_title, season: body.p_season, episode: body.p_episode }) };
      }
      const r = routes(url, opts) || resp(404, '');
      return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => r.body };
    },
    setTimeout: (fn) => setTimeout(fn, 0), URL, Date, Number, JSON, Promise, Object, Math, isFinite, Array, String,
    importScripts: (...files) => files.forEach(f => vm.runInContext(read('extension/' + f), ctx)),
  };
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('extension/background.js'), ctx);
  const page = { id: 'ext-id', url: 'chrome-extension://ext-id/options.html' };
  const call = (msg, sender = page) => new Promise(res => { const r = onMessage(msg, sender, res); if (r !== true) setTimeout(() => res(undefined), 5); });
  const waitImport = async () => { for (let i = 0; i < 200; i++) { const st = store.wlImport; if (st && st.state !== 'running') return st; await new Promise(r => setTimeout(r, 5)); } return store.wlImport; };
  return { ctx, call, fetches, store, tabsCreated, registered, ev, granted, waitImport };
}
const crRoutes = (url) => {
  if (url.endsWith('/auth/v1/token')) return resp(200, { access_token: 'at', account_id: 'acc-123' });
  if (/watch-history\?page=1&/.test(url)) return resp(200, fixture('crunchyroll-history-p1.json'));
  if (/watch-history\?page=2&/.test(url)) return resp(200, fixture('crunchyroll-history-p2.json'));
  return null;
};

test('service worker : import Crunchyroll (permission accordée) -> détections source crunchyroll, onglet « Détectés »', async () => {
  const sw = serviceWorker({ granted: { crunchyroll: true }, routes: crRoutes });
  assert.deepStrictEqual({ ...(await sw.call({ type: 'wl_import_crunchyroll' })) }, { ok: true, started: true });
  const st = await sw.waitImport();
  assert.strictEqual(st.state, 'done', JSON.stringify(st));
  assert.strictEqual(st.source, 'crunchyroll');
  assert.strictEqual(st.titles, 3);
  const push = sw.fetches.find(f => /extension_push_detections/.test(f.url));
  const body = JSON.parse(push.opts.body);
  assert.strictEqual(body.p_token, 'tok');
  assert.deepStrictEqual(body.p_items.map(i => [i.source, i.title, i.season, i.episode]), [['crunchyroll', 'JUJUTSU KAISEN', 2, 5], ['crunchyroll', 'JUJUTSU KAISEN 0', null, null], ['crunchyroll', 'SPY x FAMILY', 2, 12]]);
  const tok = sw.fetches.find(f => f.url.endsWith('/auth/v1/token'));
  assert.match(tok.opts.body, /device_id=11111111-2222-4333-8444-555555555555/);
  assert.strictEqual(tok.opts.credentials, 'include');
  assert.ok(sw.fetches.every(f => !/cinepisode\.com/.test(f.url)));
  assert.deepStrictEqual(sw.tabsCreated, ['https://cinepisode.com/#detectes']);
  assert.strictEqual(sw.store.wlImportMeta.crunchyrollLastMs, Date.parse('2026-09-30T20:40:00Z'));
  assert.ok(!JSON.stringify(sw.store.wlImport).includes('tok'), 'jamais le jeton dans l\'état affiché');
});

test('service worker : import Prime Video ; plateforme non activée ; expéditeur non fiable ; session absente', async () => {
  const pv = pvFetch();
  const sw = serviceWorker({ granted: { prime: true }, routes: (url, opts) => null });
  sw.ctx.fetch = (orig => async (url, opts) => (url.includes('supabase.co') ? orig(url, opts) : pv.fn(url, opts).then(r => ({ ok: r.status === 200, status: r.status, text: async () => r.body }))))(sw.ctx.fetch);
  await sw.call({ type: 'wl_import_prime' });
  const st = await sw.waitImport();
  assert.strictEqual(st.state, 'done', JSON.stringify(st));
  assert.strictEqual(st.titles, 4);
  assert.ok(pv.calls.some(c => /uxLocale=fr_FR/.test(c.url)));

  const off = serviceWorker({ granted: {}, routes: crRoutes });
  await off.call({ type: 'wl_import_crunchyroll' });
  assert.strictEqual((await off.waitImport()).error, 'permission');
  assert.strictEqual(off.fetches.length, 0, 'aucune requête sans la permission');
  assert.strictEqual((await off.call({ type: 'wl_import_prime' }, { id: 'ext-id', tab: { id: 1 }, url: 'https://www.primevideo.com/detail/x' })).reason, 'sender');

  const noSession = serviceWorker({ granted: { crunchyroll: true }, routes: url => (url.endsWith('/auth/v1/token') ? resp(400, { error: 'invalid_grant' }) : null) });
  await noSession.call({ type: 'wl_import_crunchyroll' });
  assert.strictEqual((await noSession.waitImport()).error, 'crunchyroll_auth');
});

test('service worker : requêtes directes limitées aux adresses de la plateforme', async () => {
  const sw = serviceWorker({ granted: { crunchyroll: true } });
  const f = sw.ctx.platformFetch('crunchyroll');
  assert.deepStrictEqual(plain(await f('https://evil.example/x')), { status: 0, body: '' });
  assert.deepStrictEqual(plain(await f('https://www.primevideo.com/region/eu/api/x')), { status: 0, body: '' });
  assert.deepStrictEqual(plain(await f('https://www.crunchyroll.com.evil.example/x')), { status: 0, body: '' });
  assert.strictEqual(sw.fetches.length, 0);
  const g = sw.ctx.platformFetch('prime');
  await g('https://atv-ps-eu.primevideo.com/cdp/catalog/GetPlaybackResources?asin=x');
  assert.strictEqual(sw.fetches.length, 1);
  assert.strictEqual(sw.fetches[0].opts.credentials, 'include');
});

test('service worker : détection en direct acceptée depuis crunchyroll.com et primevideo.com', async () => {
  const sw = serviceWorker({ granted: { crunchyroll: true, prime: true } });
  const det = { type: 'wl_watched', kind: 'episode', title: 'JUJUTSU KAISEN', season: 2, episode: 5 };
  assert.strictEqual((await sw.call(det, { id: 'ext-id', tab: { id: 2 }, origin: 'https://www.crunchyroll.com' })).status, 'updated');
  assert.strictEqual((await sw.call({ ...det, title: 'The Boys', season: 4, episode: 3 }, { id: 'ext-id', tab: { id: 3 }, origin: 'https://www.primevideo.com' })).status, 'updated');
  assert.strictEqual((await sw.call(det, { id: 'ext-id', tab: { id: 2 }, origin: 'https://static.crunchyroll.com' })).reason, 'sender', 'l\'iframe du lecteur ne parle qu\'à sa page');
  assert.strictEqual((await sw.call(det, { id: 'ext-id', tab: { id: 2 }, origin: 'https://www.amazon.fr' })).reason, 'sender');
});

test('service worker : scripts en direct enregistrés à l\'activation, retirés à la désactivation', async () => {
  const sw = serviceWorker({ granted: {} });
  const flush = () => new Promise(r => setTimeout(r, 20));
  sw.ev.installed.forEach(fn => fn());
  await flush();
  assert.strictEqual(sw.registered.size, 0, 'rien sans permission');
  sw.granted.prime = true;
  sw.ev.added.forEach(fn => fn({ origins: PLATFORMS.prime.origins }));
  await flush();
  assert.deepStrictEqual([...sw.registered.keys()], ['cp-prime-page']);
  const c = sw.registered.get('cp-prime-page');
  assert.deepStrictEqual(plain([c.matches, c.js, c.persistAcrossSessions]), [['https://www.primevideo.com/*'], ['lib/watch-rules.js', 'content/prime.js'], true]);
  sw.granted.crunchyroll = true;
  sw.ev.added.forEach(fn => fn({}));
  await flush();
  assert.deepStrictEqual([...sw.registered.keys()].sort(), ['cp-crunchyroll-page', 'cp-crunchyroll-player', 'cp-prime-page']);
  assert.strictEqual(sw.registered.get('cp-crunchyroll-player').allFrames, true);
  sw.ev.startup.forEach(fn => fn());
  await flush();
  assert.strictEqual(sw.registered.size, 3, 'pas de doublon au redémarrage');
  sw.granted.prime = false;
  sw.ev.removed.forEach(fn => fn({}));
  await flush();
  assert.deepStrictEqual([...sw.registered.keys()].sort(), ['cp-crunchyroll-page', 'cp-crunchyroll-player']);
});

/* ---------------- Fenêtre de l'extension ---------------- */
function popup({ granted = {}, answer = true } = {}) {
  const messages = JSON.parse(read('extension/_locales/fr/messages.json'));
  const getMessage = (key, subs) => {
    const m = messages[key];
    if (!m) return '';
    return m.message.replace(/\$(\w+)\$/g, (all, name) => {
      const p = m.placeholders && m.placeholders[name.toLowerCase()];
      return p ? p.content.replace(/\$(\d)/g, (x, i) => (subs || [])[i - 1] ?? '') : all;
    });
  };
  const el = () => {
    const e = { className: '', hidden: false, children: [], _text: '', style: {}, disabled: false, handlers: {}, classList: { toggle: () => {} },
      appendChild: c => e.children.push(c), addEventListener: (t, fn) => { e.handlers[t] = fn; }, click: () => e.handlers.click && e.handlers.click({ preventDefault() {} }) };
    Object.defineProperty(e, 'textContent', { get: () => e._text + e.children.map(c => c.textContent).join(' | '), set: v => { e._text = v; e.children = []; } });
    return e;
  };
  const els = { token: el(), save: el(), status: el(), last: el(), importNetflix: el(), csvFile: el(), csvLabel: el(), importStatus: el(), openDetected: el() };
  const boxes = {};
  for (const name of ['crunchyroll', 'prime']) {
    const parts = { enable: el(), import: el(), disable: el(), state: el() };
    parts.import.hidden = true; parts.disable.hidden = true;
    boxes[name] = { parts, querySelector: sel => parts[/data-role="(\w+)"/.exec(sel)[1]] };
  }
  const requests = [];
  const sent = [];
  const listeners = [];
  const ctx = {
    document: { documentElement: {}, title: '', getElementById: id => els[id], createElement: () => el(), createTextNode: t => ({ textContent: t }),
      querySelector: sel => boxes[(/data-platform="(\w+)"/.exec(sel) || [])[1]] || null,
      querySelectorAll: sel => (sel === '.platform [data-role="import"]' ? Object.values(boxes).map(b => b.parts.import) : []) },
    chrome: {
      i18n: { getMessage, getUILanguage: () => 'fr' },
      runtime: { sendMessage: (m, cb) => { sent.push(m); if (cb) cb({ ok: true, started: true }); } },
      tabs: { create: () => {} },
      permissions: {
        contains: (q, cb) => cb(Object.entries(granted).some(([n, ok]) => ok && PLATFORMS[n].origins.join() === q.origins.join())),
        request: (q, cb) => { requests.push(q.origins); const n = Object.keys(PLATFORMS).find(k => PLATFORMS[k].origins.join() === q.origins.join()); if (answer) granted[n] = true; cb(answer); },
        remove: (q, cb) => { const n = Object.keys(PLATFORMS).find(k => PLATFORMS[k].origins.join() === q.origins.join()); granted[n] = false; cb(true); },
        onAdded: { addListener: () => {} }, onRemoved: { addListener: () => {} },
      },
      storage: { local: { get: (k, cb) => cb({}), set: (o, cb) => cb && cb(), remove: (k, cb) => cb && cb() }, onChanged: { addListener: fn => listeners.push(fn) } },
    },
    CinepisodePlatforms: PLATFORMS, Date, Number, String, Object,
  };
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('extension/options.js'), ctx);
  return { boxes, requests, sent, els, updateImport: v => listeners.forEach(fn => fn({ wlImport: { newValue: v } }, 'local')) };
}

test('fenêtre : « Activer Crunchyroll » demande seulement les sites Crunchyroll, puis le bouton d\'import apparaît', () => {
  const p = popup();
  const cr = p.boxes.crunchyroll.parts;
  assert.strictEqual(cr.enable.hidden, false);
  assert.strictEqual(cr.import.hidden, true);
  cr.enable.click();
  assert.deepStrictEqual(p.requests, [['https://www.crunchyroll.com/*', 'https://static.crunchyroll.com/*']]);
  assert.strictEqual(cr.enable.hidden, true);
  assert.strictEqual(cr.import.hidden, false);
  assert.match(cr.state.textContent, /^Activé/);
  assert.strictEqual(p.boxes.prime.parts.import.hidden, true, 'Prime Video reste désactivé');
  cr.import.click();
  assert.deepStrictEqual(plain(p.sent), [{ type: 'wl_import_crunchyroll' }]);
  p.updateImport({ state: 'running', source: 'crunchyroll', step: 'session', at: Date.now() });
  assert.match(p.els.importStatus.textContent, /^Connexion à Crunchyroll/);
  assert.strictEqual(cr.import.disabled, true, 'import en cours : bouton désactivé');
  p.updateImport({ state: 'error', error: 'crunchyroll_auth', at: Date.now() });
  assert.match(p.els.importStatus.textContent, /^Connecte-toi à Crunchyroll/);
  cr.disable.click();
  assert.strictEqual(cr.enable.hidden, false);
});

test('fenêtre : permission refusée, Prime Video déjà activé, textes de l\'import Prime', () => {
  const refused = popup({ answer: false });
  refused.boxes.prime.parts.enable.click();
  assert.match(refused.boxes.prime.parts.state.textContent, /refusé/);
  assert.strictEqual(refused.boxes.prime.parts.import.hidden, true);
  const p = popup({ granted: { prime: true } });
  assert.strictEqual(p.boxes.prime.parts.import.hidden, false);
  p.updateImport({ state: 'running', source: 'prime', step: 'meta', done: 12, total: 40, at: Date.now() });
  assert.match(p.els.importStatus.textContent, /^Fiches des épisodes et films : 12 \/ 40/);
  p.updateImport({ state: 'done', source: 'prime', titles: 4, truncated: true, sent: { inserted: 4, updated: 0 }, at: Date.now() });
  assert.match(p.els.importStatus.textContent, /seule la partie la plus récente/);
  for (const e of ['permission', 'prime_auth', 'prime_http', 'crunchyroll_http']) {
    p.updateImport({ state: 'error', error: e, at: Date.now() });
    assert.doesNotMatch(p.els.importStatus.textContent, /Erreur du serveur/, e);
  }
});

test('locales : mêmes clés en français et en anglais, textes des plateformes présents', () => {
  const fr = JSON.parse(read('extension/_locales/fr/messages.json'));
  const en = JSON.parse(read('extension/_locales/en/messages.json'));
  assert.deepStrictEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  for (const k of ['enableCrunchyroll', 'enablePrime', 'importCrunchyroll', 'importPrime', 'crunchyrollHint', 'primeHint']) assert.ok(fr[k] && en[k], k);
  assert.strictEqual(fr.enableCrunchyroll.message, 'Activer Crunchyroll');
  assert.strictEqual(fr.enablePrime.message, 'Activer Prime Video');
  const html = read('extension/options.html');
  assert.match(html, /<script src="lib\/platforms\.js"><\/script>\s*<script src="options\.js"><\/script>/);
  assert.doesNotMatch(html, /\son\w+=/i);
});
