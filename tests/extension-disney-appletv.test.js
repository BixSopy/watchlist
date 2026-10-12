'use strict';
/*
 * Extension 0.7.0 : Disney+ et Apple TV, détection en direct seulement (modèle de Prime Video).
 *  - Disney+ : titre .title-field, repère .subtitle-field (« S1: ép. 6 », « S1: Ep. 6 »), position lue
 *    dans le shadow DOM de <progress-bar> (aria-valuenow / aria-valuemax), sinon <video> ;
 *  - Apple TV : [data-testid="video-container"] video + player-metadata ; promo, sport, extraits et
 *    bandes-annonces exclus ; épisode suivant lancé tout seul jamais rattaché au précédent ;
 *  - service worker, permissions, fenêtre (5 plateformes, pas de bouton d'import).
 * Les mêmes pages, en HTML réel (tests/fixtures/*.html), sont jouées dans Chrome par e2e/platforms.test.mjs.
 * Lancer : node --test tests/
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const plain = v => JSON.parse(JSON.stringify(v));
const W = require('../extension/lib/watch-rules.js');
const PLATFORMS = require('../extension/lib/platforms.js');

function pageContext({ origin, pathname = '/', dom }) {
  const sent = [];
  let tick = null;
  const clock = { now: 1000 };
  const loc = { origin, pathname };
  const ctx = {
    window: { location: loc }, location: loc, document: dom,
    chrome: { runtime: { sendMessage: (m, cb) => { sent.push(plain(m)); if (cb) cb(); }, lastError: undefined } },
    Date: { now: () => clock.now }, setInterval: fn => { tick = fn; }, setTimeout: () => {}, JSON, Math, Number, String, Array, Object, isFinite, parseInt, parseFloat,
  };
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('extension/lib/watch-rules.js'), ctx);
  return { ctx, sent, clock, loc, run: f => vm.runInContext(read(f), ctx), tick: () => tick() };
}
const el = (txt, attrs = {}) => ({ textContent: txt, getAttribute: k => (k in attrs ? attrs[k] : null) });

/* ---------------- Repères d'épisode ---------------- */
test('repères Disney+ et Apple TV, en français et en anglais', () => {
  const cases = [['S1: ép. 6 Le Mandalorien', 1, 6], ['S1: Ep. 6 The Mandalorian', 1, 6], ['S2 : ép. 10', 2, 10], ['S1:Ép.6', 1, 6],
    ['S1, E3 · Le jour d\'après', 1, 3], ['S2, É4 · Titre', 2, 4], ['Saison 3, épisode 9', 3, 9], ['Season 1, Episode 2', 1, 2]];
  for (const [t, s, e] of cases) assert.deepStrictEqual(W.parseEpisodeLabel(t), { season: s, episode: e }, t);
});

/* ---------------- Disney+ ---------------- */
function disneyDom(state) {
  const thumb = { getAttribute: k => (k === 'aria-valuenow' ? (state.bar ? String(state.t) : null) : k === 'aria-valuemax' ? (state.bar ? String(state.duration) : null) : null) };
  const bar = { shadowRoot: { querySelector: s => (s === '.progress-bar__thumb' ? thumb : null) } };
  const video = { get duration() { return state.duration; }, get currentTime() { return state.t; }, get paused() { return !!state.paused; } };
  return {
    querySelector: sel => (sel === '.title-field' ? (state.title ? el(state.title) : null) : sel === '.subtitle-field' ? (state.sub ? el(state.sub) : null) : null),
    querySelectorAll: sel => (sel === 'progress-bar' ? [bar] : sel === 'video' ? (state.video ? [video] : [])
      : sel === 'button, [role="button"]' ? (state.end ? [el('Épisode suivant')] : []) : []),
  };
}
const disneyRun = (state, pathname = '/fr-fr/play/8d0ab0f2-7c86-4f0e-9a1b-3c2d1e0f9a8b') => {
  const p = pageContext({ origin: 'https://www.disneyplus.com', pathname, dom: disneyDom(state) });
  p.run('extension/content/disneyplus.js');
  p.step = (dt = 5) => { p.clock.now += 5000; state.t += dt; p.tick(); };
  return p;
};

test('Disney+ en direct : repère français « S1: ép. 6 », position lue dans le shadow DOM de la barre de progression', () => {
  const state = { duration: 2400, t: 1800, bar: true, title: 'The Mandalorian', sub: 'S1: ép. 6 Le Prisonnier' };
  const p = disneyRun(state);
  p.step(); p.step();
  state.title = null; state.sub = null; /* commandes masquées : le titre lu reste associé à la vidéo */
  while (state.t < 1915) p.step();
  assert.strictEqual(p.sent.length, 0, 'avant 80 %');
  while (state.t < 1990) p.step();
  assert.deepStrictEqual(p.sent, [{ type: 'wl_watched', kind: 'episode', title: 'The Mandalorian', season: 1, episode: 6 }], 'une seule fois');
});

test('Disney+ en direct : repère anglais « S1: Ep. 6 », générique après 50 %, film à 90 %, <video> si pas de barre', () => {
  const s1 = { duration: 2400, t: 1300, bar: true, title: 'Andor', sub: 'S1: Ep. 6 The Eye' };
  const p1 = disneyRun(s1, '/play/abc-123');
  for (let i = 0; i < 6; i++) p1.step();
  assert.strictEqual(p1.sent.length, 0);
  s1.end = true;
  p1.step();
  assert.deepStrictEqual(p1.sent, [{ type: 'wl_watched', kind: 'episode', title: 'Andor', season: 1, episode: 6 }], 'écran de fin après 50 %');
  const s2 = { duration: 6000, t: 5300, bar: false, video: true, title: 'Vice-versa 2', sub: null };
  const p2 = disneyRun(s2);
  while (s2.t < 5395) p2.step();
  assert.strictEqual(p2.sent.length, 0, 'film : pas avant 90 %');
  while (s2.t < 5450) p2.step();
  assert.deepStrictEqual(p2.sent, [{ type: 'wl_watched', kind: 'movie', title: 'Vice-versa 2', season: null, episode: null }]);
});

test('Disney+ : saut dans la barre, sous-titre illisible, page hors lecture, autre vidéo sans titre -> rien', () => {
  const jump = { duration: 2400, t: 100, bar: true, title: 'Loki', sub: 'S2: ép. 1' };
  const p = disneyRun(jump);
  p.step(); jump.t = 2300; p.step(); p.step();
  assert.strictEqual(p.sent.length, 0, 'saut à la fin : moins de 20 s regardées');
  const odd = { duration: 2400, t: 1900, bar: true, title: 'Loki', sub: 'Bonus : coulisses' };
  const p2 = disneyRun(odd);
  for (let i = 0; i < 20; i++) p2.step();
  assert.strictEqual(p2.sent.length, 0, 'sous-titre présent mais sans repère : ni épisode ni film');
  const home = { duration: 2400, t: 1900, bar: true, title: 'Loki', sub: 'S2: ép. 1' };
  const p3 = disneyRun(home, '/fr-fr/browse/entity-123');
  for (let i = 0; i < 20; i++) p3.step();
  assert.strictEqual(p3.sent.length, 0, 'pas une page /play/');
  /* épisode suivant (nouvel identifiant) avant que son titre soit lisible : pas rattaché au précédent */
  const next = { duration: 2400, t: 1000, bar: true, title: 'Loki', sub: 'S2: ép. 1' };
  const p4 = disneyRun(next, '/play/ep1');
  p4.step(); p4.step();
  next.title = null; next.sub = null; p4.loc.pathname = '/play/ep2'; next.t = 1900;
  for (let i = 0; i < 20; i++) p4.step();
  assert.strictEqual(p4.sent.length, 0);
});

/* ---------------- Apple TV ---------------- */
function appleDom(state) {
  const video = { get duration() { return state.duration; }, get currentTime() { return state.t; }, get paused() { return !!state.paused; } };
  const meta = (k) => (state[k] ? el(state[k]) : null);
  return {
    querySelector: sel => (/player-metadata-title/.test(sel) ? meta('title') : /player-metadata-subtitle/.test(sel) ? meta('sub') : null),
    querySelectorAll: sel => (sel === '[data-testid="video-container"] video' ? (state.inContainer === false ? [] : [video])
      : /button/.test(sel) ? (state.end ? [el('', { 'aria-label': 'Épisode suivant' })] : []) : []),
  };
}
const appleRun = (state, pathname = '/fr/episode/le-jour-d-apres/umc.cmc.4a1b2c3d') => {
  const p = pageContext({ origin: 'https://tv.apple.com', pathname, dom: appleDom(state) });
  p.run('extension/content/appletv.js');
  p.step = (dt = 5) => { p.clock.now += 5000; state.t += dt; p.tick(); };
  return p;
};

test('Apple TV en direct : vidéo du lecteur + player-metadata « S1, E3 · Titre », une seule fois à 80 %', () => {
  const state = { duration: 3000, t: 2300, title: 'Severance', sub: 'S1, E3 · Dans le perimètre' };
  const p = appleRun(state);
  p.step(); p.step();
  state.title = null; state.sub = null; /* commandes masquées */
  while (state.t < 2395) p.step();
  assert.strictEqual(p.sent.length, 0, 'avant 80 %');
  while (state.t < 2500) p.step();
  assert.deepStrictEqual(p.sent, [{ type: 'wl_watched', kind: 'episode', title: 'Severance', season: 1, episode: 3 }]);
});

test('Apple TV : film à 90 % (page /movie/), lecture lancée depuis l\'accueil (URL inchangée)', () => {
  const s = { duration: 7200, t: 6400, title: 'Napoléon', sub: null };
  const p = appleRun(s, '/fr/movie/napoleon/umc.cmc.1234');
  while (s.t < 6475) p.step();
  assert.strictEqual(p.sent.length, 0);
  while (s.t < 6560) p.step();
  assert.deepStrictEqual(p.sent, [{ type: 'wl_watched', kind: 'movie', title: 'Napoléon', season: null, episode: null }]);
  const h = { duration: 3000, t: 2350, title: 'Slow Horses', sub: 'S4, E2 · Titre' };
  const ph = appleRun(h, '/fr');
  for (let i = 0; i < 30; i++) ph.step();
  assert.deepStrictEqual(ph.sent.map(m => [m.title, m.season, m.episode]), [['Slow Horses', 4, 2]]);
});

test('Apple TV : promo hors du lecteur, sport, extrait, bande-annonce, vidéo courte, série sans repère -> rien', () => {
  const cases = [
    [{ duration: 3000, t: 2300, title: 'Severance', sub: 'S1, E3 · X', inContainer: false }, undefined, 'vidéo promo hors du conteneur du lecteur'],
    [{ duration: 9000, t: 8000, title: 'MLS : Inter Miami – LAFC', sub: null }, '/fr/sporting-event/inter-miami-lafc/umc.cse.1', 'sport'],
    [{ duration: 600, t: 500, title: 'Severance', sub: null }, '/fr/clip/severance-coulisses/umc.cmc.9', 'extrait'],
    [{ duration: 900, t: 800, title: 'Severance', sub: 'Bande-annonce de la saison 2' }, '/fr/show/severance/umc.cmc.1', 'bande-annonce'],
    [{ duration: 900, t: 800, title: 'F1 – Official Trailer', sub: null }, '/fr/movie/f1/umc.cmc.2', 'trailer'],
    [{ duration: 150, t: 120, title: 'Teaser', sub: null }, '/fr', 'moins de 5 min'],
    [{ duration: 3000, t: 2300, title: 'Severance', sub: 'Saison 1' }, '/fr/episode/x/umc.cmc.3', 'série sans repère lisible'],
  ];
  for (const [state, pathname, why] of cases) {
    const p = appleRun(state, pathname);
    for (let i = 0; i < 40; i++) p.step();
    assert.strictEqual(p.sent.length, 0, why);
  }
});

test('Apple TV : enchaînement automatique -> épisode 3 envoyé, épisode 4 jamais rattaché à l\'épisode 3, compté une fois son titre lu', () => {
  const s = { duration: 3000, t: 2300, title: 'Severance', sub: 'S1, E3 · Titre' };
  const p = appleRun(s);
  while (s.t < 2450) p.step();
  assert.strictEqual(p.sent.length, 1);
  /* épisode 4, même durée, lancé tout seul : position repartie du début, titre pas encore affiché */
  s.title = null; s.sub = null; s.t = 0;
  for (let i = 0; i < 5; i++) p.step();
  s.t = 2350; /* même si la position avance ensuite sans titre */
  for (let i = 0; i < 20; i++) p.step();
  assert.strictEqual(p.sent.length, 1, 'rien pour l\'épisode 4 sans son titre');
  s.title = 'Severance'; s.sub = 'S1, E4 · Titre'; s.t = 2380;
  for (let i = 0; i < 10; i++) p.step();
  assert.deepStrictEqual(p.sent.map(m => m.episode), [3, 4]);
  /* épisode suivant lancé puis arrêté tôt : jamais envoyé */
  const s2 = { duration: 3000, t: 2300, title: 'Severance', sub: 'S1, E5 · Titre' };
  const p2 = appleRun(s2);
  while (s2.t < 2450) p2.step();
  s2.sub = 'S1, E6 · Titre'; s2.t = 0;
  for (let i = 0; i < 10; i++) p2.step();
  s2.paused = true;
  for (let i = 0; i < 10; i++) p2.step();
  assert.deepStrictEqual(p2.sent.map(m => m.episode), [5]);
});

/* ---------------- Permissions, service worker, fenêtre ---------------- */
test('plateformes 0.7.0 : origines au plus étroit, scripts couverts par la permission, détection seulement', () => {
  assert.deepStrictEqual(PLATFORMS.disneyplus.origins, ['https://www.disneyplus.com/*']);
  assert.deepStrictEqual(PLATFORMS.appletv.origins, ['https://tv.apple.com/*']);
  assert.deepStrictEqual(plain(PLATFORMS.disneyplus.scripts.map(c => [c.id, c.matches, c.js])), [['cp-disneyplus-page', ['https://www.disneyplus.com/*'], ['lib/watch-rules.js', 'content/disneyplus.js']]]);
  assert.deepStrictEqual(plain(PLATFORMS.appletv.scripts.map(c => [c.id, c.matches, c.js])), [['cp-appletv-page', ['https://tv.apple.com/*'], ['lib/watch-rules.js', 'content/appletv.js']]]);
  assert.ok(PLATFORMS.disneyplus.liveOnly && PLATFORMS.appletv.liveOnly);
  for (const f of ['extension/content/disneyplus.js', 'extension/content/appletv.js']) {
    const src = read(f);
    assert.doesNotMatch(src, /\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon|importScripts|\beval\(|new Function/, f + ' : aucune requête réseau');
    assert.doesNotMatch(src, /console\./, f + ' : aucune trace');
  }
  const bg = read('extension/background.js');
  assert.match(bg, /ALLOWED_ORIGINS = \[[^\]]*'https:\/\/www\.disneyplus\.com', 'https:\/\/tv\.apple\.com'\]/);
  assert.doesNotMatch(bg, /disneyplus\.com\/|tv\.apple\.com\//, 'aucun appel vers Disney+ ou Apple depuis le service worker');
  const csp = JSON.parse(read('extension/manifest.json')).content_security_policy.extension_pages;
  assert.doesNotMatch(csp, /disney|apple/, 'CSP inchangée');
});

test('fenêtre : bande « 5 plateformes intégrées », boutons « Activer Disney+ » / « Activer Apple TV », pas d\'import', () => {
  const html = read('extension/options.html');
  const chips = [...html.matchAll(/class="platsum-chip" data-chip="(\w+)"/g)].map(m => m[1]);
  assert.deepStrictEqual(chips, ['netflix', 'crunchyroll', 'prime', 'disneyplus', 'appletv']);
  for (const k of ['disneyplus', 'appletv']) {
    const box = new RegExp('<div class="platform" data-platform="' + k + '">([\\s\\S]*?)</div>').exec(html)[1];
    assert.match(box, /data-role="enable"/);
    assert.match(box, /data-role="disable"/);
    assert.doesNotMatch(box, /data-role="import"/, k + ' : pas d\'historique');
  }
  const fr = JSON.parse(read('extension/_locales/fr/messages.json'));
  const en = JSON.parse(read('extension/_locales/en/messages.json'));
  assert.strictEqual(fr.platformsSummaryTitle.message, '5 plateformes intégrées');
  assert.strictEqual(en.platformsSummaryTitle.message, '5 platforms integrated');
  assert.strictEqual(fr.enableDisneyplus.message, 'Activer Disney+');
  assert.strictEqual(fr.enableAppletv.message, 'Activer Apple TV');
  for (const k of ['disneyplusHint', 'appletvHint', 'platformEnabledLive', 'enableDisneyplus', 'enableAppletv']) assert.ok(fr[k] && en[k], k);
  assert.match(read('extension/options.js'), /liveOnly \? 'platformEnabledLive'/);
});
