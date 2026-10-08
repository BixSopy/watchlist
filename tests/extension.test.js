'use strict';
/*
 * Extension navigateur : messages postMessage stricts (origine, fenêtre, forme), aucun '*',
 * aucune trace console, aucun fichier de diagnostic resté dans le dossier.
 * Lancer : node --test tests/
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const EXT_JS = ['extension/background.js', 'extension/options.js',
  ...fs.readdirSync(path.join(ROOT, 'extension/lib')).map(f => 'extension/lib/' + f),
  ...fs.readdirSync(path.join(ROOT, 'extension/content')).map(f => 'extension/content/' + f)];

test('extension : chaque script du dossier content/ est déclaré dans le manifeste (pas de fichier de diagnostic orphelin)', () => {
  const manifest = JSON.parse(read('extension/manifest.json'));
  /* Netflix : manifeste ; Crunchyroll / Prime Video : enregistrés après la permission (lib/platforms.js) */
  const platforms = require('../extension/lib/platforms.js');
  const dynamic = Object.values(platforms).flatMap(p => p.scripts.flatMap(c => c.js));
  const declared = new Set([...manifest.content_scripts.flatMap(c => c.js), ...dynamic]);
  for (const f of declared) assert.ok(fs.existsSync(path.join(ROOT, 'extension', f)), 'absent : ' + f);
  for (const f of fs.readdirSync(path.join(ROOT, 'extension/content'))) assert.ok(declared.has('content/' + f), 'non déclaré : ' + f);
  assert.ok(!fs.readdirSync(path.join(ROOT, 'extension/content')).some(f => /diag/i.test(f)));
  for (const c of manifest.content_scripts) for (const m of c.matches) assert.match(m, /^https:\/\/www\.netflix\.com\//);
  for (const c of Object.values(platforms).flatMap(p => p.scripts)) for (const m of c.matches) assert.match(m, /^https:\/\/(www|static)\.crunchyroll\.com\/|^https:\/\/www\.primevideo\.com\//);
});

test('extension : ni postMessage vers \'*\', ni trace dans la console', () => {
  for (const f of EXT_JS) {
    const src = read(f).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(src, /postMessage\([^;]*['"]\*['"]\s*\)/, f);
    assert.doesNotMatch(src, /console\.(log|debug|info|warn|error)/, f);
  }
  assert.match(read('extension/content/netflix-main.js'), /postMessage\([^;]*window\.location\.origin\)/);
});

function bridge() {
  const listeners = [];
  const sent = [];
  const win = { location: { origin: 'https://www.netflix.com' }, addEventListener: (t, fn) => { if (t === 'message') listeners.push(fn); } };
  const ctx = { window: win, chrome: { runtime: { sendMessage: (m, cb) => { sent.push(m); if (cb) cb(); }, lastError: undefined } }, Number };
  vm.createContext(ctx);
  vm.runInContext(read('extension/content/netflix-bridge.js'), ctx);
  const post = (data, extra = {}) => listeners.forEach(fn => fn(Object.assign({ source: win, origin: 'https://www.netflix.com', data }, extra)));
  return { post, sent, win };
}

test('relai Netflix : seuls les messages de la même fenêtre, de netflix.com et de la bonne forme passent', () => {
  const { post, sent } = bridge();
  const ok = { __wl: true, type: 'wl_watched', kind: 'episode', title: ' Dahmer ', season: 1, episode: 3 };
  post(ok);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(sent)), [{ type: 'wl_watched', kind: 'episode', title: 'Dahmer', season: 1, episode: 3 }]);
  post({ __wl: true, type: 'wl_watched', kind: 'movie', title: 'Film', season: null, episode: null });
  assert.strictEqual(sent.length, 2);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(sent[1])), { type: 'wl_watched', kind: 'movie', title: 'Film', season: null, episode: null });
  /* rejetés */
  post(ok, { source: {} });                               /* autre fenêtre (iframe, popup) */
  post(ok, { origin: 'https://evil.example' });           /* autre origine */
  post(ok, { origin: 'null' });
  post({ __wl: true, kind: 'episode', title: 'x', season: 1, episode: 1 }); /* type manquant */
  post({ ...ok, kind: undefined });                       /* sorte (épisode/film) manquante */
  post({ ...ok, kind: 'show' });
  post({ ...ok, season: null });                          /* épisode sans saison */
  post({ __wl: true, type: 'wl_watched', kind: 'movie', title: 'Film', season: 1, episode: 2 }); /* film avec saison */
  post({ ...ok, title: '' });
  post({ ...ok, title: 'x'.repeat(301) });
  post({ ...ok, title: { toString: () => 'x' } });
  post({ ...ok, season: '1' });
  post({ ...ok, episode: -1 });
  post({ ...ok, episode: 1.5 });
  post('wl_watched');
  post(null);
  assert.strictEqual(sent.length, 2);
});

/* Service worker chargé dans un bac à sable : fetch simulé (réponses en file), stockage en mémoire */
function serviceWorker({ token = 'tok', responses = [] } = {}) {
  let onMessage;
  const fetches = [];
  const tabsCreated = [];
  const store = token ? { wlToken: token } : {};
  const ctx = {
    chrome: {
      runtime: { id: 'ext-id', getURL: p => 'chrome-extension://ext-id/' + p, onMessage: { addListener: fn => { onMessage = fn; } } },
      tabs: { create: (o) => { tabsCreated.push(o.url); } },
      storage: { local: {
        get: (k, cb) => cb(Object.fromEntries(k.filter(x => x in store).map(x => [x, store[x]]))),
        set: (o, cb) => { Object.assign(store, JSON.parse(JSON.stringify(o))); if (cb) cb(); },
      } },
    },
    fetch: (url, opts) => {
      fetches.push({ url, body: JSON.parse(opts.body), apikey: opts.headers.apikey });
      const next = responses.length ? responses.shift() : { status: 200, data: true };
      if (next === 'network') return Promise.reject(new TypeError('Failed to fetch'));
      return Promise.resolve({ ok: next.status >= 200 && next.status < 300, status: next.status, json: () => Promise.resolve(next.data) });
    },
    URL, Date, Number, JSON, Promise, Object, Math, isFinite,
    importScripts: (...files) => files.forEach(f => vm.runInContext(read('extension/' + f), ctx)),
  };
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('extension/background.js'), ctx);
  const call = (msg, sender = { id: 'ext-id', tab: { id: 1 }, url: 'https://www.netflix.com/watch/123' }) =>
    new Promise(res => { const r = onMessage(msg, sender, res); if (r !== true) setTimeout(() => res(undefined), 5); });
  return { call, fetches, store, tabsCreated };
}
const EP = { type: 'wl_watched', kind: 'episode', title: 'Dark', season: 2, episode: 3 };

test('service worker : expéditeur vérifié (cette extension, onglet netflix.com) et message revalidé', async () => {
  const { call, fetches } = serviceWorker({ responses: [{ status: 200, data: { status: 'updated', title: 'Dark', season: 2, episode: 3 } }] });
  const tab = { id: 1 };
  assert.strictEqual((await call(EP, { id: 'autre', tab, origin: 'https://www.netflix.com' })).reason, 'sender');
  assert.strictEqual((await call(EP, { id: 'ext-id', origin: 'https://www.netflix.com' })).reason, 'sender'); /* pas d'onglet */
  assert.strictEqual((await call(EP, { id: 'ext-id', tab, origin: 'https://evil.example' })).reason, 'sender');
  assert.strictEqual((await call(EP, { id: 'ext-id', tab, url: 'https://evil.example/watch/1' })).reason, 'sender');
  assert.strictEqual((await call({ ...EP, season: '1' })).reason, 'invalid');
  assert.strictEqual((await call({ ...EP, kind: undefined })).reason, 'invalid');
  assert.strictEqual((await call({ ...EP, kind: 'movie' })).reason, 'invalid');          /* film avec saison */
  assert.strictEqual((await call({ ...EP, season: null, episode: null })).reason, 'invalid'); /* épisode sans saison */
  assert.strictEqual(fetches.length, 0);
  const r = await call(EP);
  assert.deepStrictEqual({ ...r }, { ok: true, status: 'updated' });
  assert.deepStrictEqual(fetches.map(f => f.body), [{ p_token: 'tok', p_title: 'Dark', p_season: 2, p_episode: 3, p_type: 'episode' }]);
  assert.match(fetches[0].url, /\/rest\/v1\/rpc\/mark_watched_by_title$/);
  /* même détection dans les 2 minutes : pas de second appel */
  assert.strictEqual((await call(EP)).skipped, true);
  assert.strictEqual(fetches.length, 1);
});

test('service worker : dernière détection gardée pour la fenêtre (wlLast), sans le jeton', async () => {
  const cases = [
    [{ status: 200, data: { status: 'updated', title: 'Dark', season: 2, episode: 3 } }, { status: 'updated', matchedTitle: 'Dark', season: 2, episode: 3 }],
    [{ status: 200, data: { status: 'already_up_to_date', title: 'Dark', season: 2, episode: 5 } }, { status: 'already_up_to_date', matchedTitle: 'Dark', season: 2, episode: 5 }],
    [{ status: 200, data: { status: 'not_found', title: 'Dark', season: 2, episode: 3 } }, { status: 'not_found', season: 2, episode: 3 }],
    [{ status: 200, data: { status: 'ambiguous', title: 'Dark', season: 2, episode: 3, count: 2 } }, { status: 'ambiguous' }],
    [{ status: 200, data: { status: 'invalid_token' } }, { status: 'invalid_token' }],
    [{ status: 200, data: { status: 'bizarre' } }, { status: 'server_error' }],
    [{ status: 500, data: { message: 'boom' } }, { status: 'server_error' }],
    ['network', { status: 'network' }],
  ];
  for (const [resp, expected] of cases) {
    const { call, store } = serviceWorker({ token: 'jeton-secret-42', responses: [resp] });
    await call(EP);
    const last = store.wlLast;
    assert.ok(last && typeof last.at === 'number', JSON.stringify(resp));
    assert.strictEqual(last.title, 'Dark');
    assert.strictEqual(last.kind, 'episode');
    for (const [k, v] of Object.entries(expected)) assert.strictEqual(last[k], v, k + ' pour ' + JSON.stringify(resp));
    assert.ok(!JSON.stringify(last).includes('jeton-secret-42'), 'le jeton ne doit pas être recopié');
  }
  const noToken = serviceWorker({ token: null });
  assert.strictEqual((await noToken.call(EP)).reason, 'no_token');
  assert.strictEqual(noToken.store.wlLast.status, 'no_token');
  assert.strictEqual(noToken.fetches.length, 0);
});

test('service worker : base pas encore migrée -> réessaie sans p_type et comprend la réponse true/false', async () => {
  const pgrst = { status: 404, data: { code: 'PGRST202', message: 'Could not find the function public.mark_watched_by_title(p_episode, p_season, p_title, p_token, p_type)' } };
  const a = serviceWorker({ responses: [pgrst, { status: 200, data: true }] });
  const r = await a.call(EP);
  assert.strictEqual(r.status, 'legacy_updated');
  assert.deepStrictEqual(a.fetches.map(f => f.body), [
    { p_token: 'tok', p_title: 'Dark', p_season: 2, p_episode: 3, p_type: 'episode' },
    { p_token: 'tok', p_title: 'Dark', p_season: 2, p_episode: 3 },
  ]);
  const b = serviceWorker({ responses: [pgrst, { status: 200, data: false }] });
  await b.call({ type: 'wl_watched', kind: 'movie', title: 'Matrix', season: null, episode: null });
  assert.strictEqual(b.store.wlLast.status, 'legacy_no_change');
  assert.deepStrictEqual(b.fetches[1].body, { p_token: 'tok', p_title: 'Matrix', p_season: null, p_episode: null });
  /* nouvelle base : un seul appel */
  const c = serviceWorker({ responses: [{ status: 200, data: { status: 'updated', title: 'Matrix', season: null, episode: null } }] });
  await c.call({ type: 'wl_watched', kind: 'movie', title: 'Matrix', season: null, episode: null });
  assert.strictEqual(c.fetches.length, 1);
  assert.strictEqual(c.fetches[0].body.p_type, 'movie');
});

/* --- Détection Netflix (monde MAIN) : lecteur, horloge et minuteries simulés --- */
function netflixPage() {
  let clock = 1_000_000;
  const timers = [];
  const posts = [];
  const page = { movieId: 1, type: 'episode', season: 2, episode: 3, timeMs: 0, durationMs: 50 * 60 * 1000, titleText: 'DarkS2E3Ce qui était', endUi: false };
  const player = {
    getMovieId: () => page.movieId,
    getCurrentTime: () => page.timeMs,
    getDuration: () => page.durationMs,
  };
  const win = {
    location: { origin: 'https://www.netflix.com' },
    postMessage: (m, origin) => posts.push({ ...JSON.parse(JSON.stringify(m)), origin }),
    netflix: {
      appContext: { state: { playerApp: { getAPI: () => ({ videoPlayer: {
        getAllPlayerSessionIds: () => ['s1'], getVideoPlayerBySessionId: () => player } }) } } },
      falcorCache: { get videos() { return { [page.movieId]: { summary: { value: { type: page.type, season: page.season, episode: page.episode } } } }; } },
    },
  };
  const doc = {
    querySelector: sel => {
      if (sel === '[data-uia="video-title"]') return { textContent: page.titleText };
      if (page.endUi && /next-episode-seamless-button|watch-credits|postplay/.test(sel)) return {};
      return null;
    },
  };
  const ctx = { window: win, document: doc, Date: { now: () => clock }, Number, String, parseInt,
    setTimeout: fn => timers.push(fn), setInterval: fn => timers.push(fn) };
  vm.createContext(ctx);
  vm.runInContext(read('extension/content/netflix-main.js'), ctx);
  const check = timers[timers.length - 1];
  /* avance de `seconds` en vérifiant toutes les 5 s ; la vidéo avance de `rate` x le temps écoulé */
  const play = (seconds, rate = 1) => {
    for (let t = 0; t < seconds; t += 5) { clock += 5000; page.timeMs = Math.min(page.durationMs, page.timeMs + 5000 * rate); check(); }
  };
  const at = pct => { page.timeMs = Math.round(page.durationMs * pct); };
  return { page, posts, play, at, check, wait: s => { clock += s * 1000; check(); } };
}

test('Netflix : un épisode est marqué à 80 %, pas avant, et une seule fois', () => {
  const n = netflixPage();
  n.check(); /* lancement : rien */
  n.play(39 * 60); /* 78 % */
  assert.strictEqual(n.posts.length, 0);
  n.play(60); /* 80 % */
  assert.strictEqual(n.posts.length, 1);
  assert.deepStrictEqual(n.posts[0], { __wl: true, type: 'wl_watched', kind: 'episode', title: 'Dark', season: 2, episode: 3, origin: 'https://www.netflix.com' });
  n.play(9 * 60);
  assert.strictEqual(n.posts.length, 1);
});

test('Netflix : générique de fin / bouton « Épisode suivant » -> marqué dès 50 %, jamais avant', () => {
  const n = netflixPage();
  n.page.endUi = true; /* affiché trop tôt (ou resté de l'épisode précédent) */
  n.play(24 * 60); /* 48 % */
  assert.strictEqual(n.posts.length, 0);
  n.play(60); /* 50 % */
  assert.strictEqual(n.posts.length, 1);
});

test('Netflix : épisode suivant lancé automatiquement puis abandonné -> non marqué', () => {
  const n = netflixPage();
  n.at(0.7); n.check();
  n.play(10 * 60); /* jusqu'à 90 % : S2E3 marqué */
  assert.strictEqual(n.posts.length, 1);
  /* lecture automatique de S2E4 : bouton de fin encore à l'écran, 30 s regardées puis arrêt */
  Object.assign(n.page, { movieId: 2, episode: 4, titleText: 'DarkS2E4Suite', timeMs: 0, endUi: true });
  n.check();
  n.play(30);
  n.page.endUi = false;
  n.wait(3600); /* onglet laissé ouvert, vidéo en pause */
  assert.strictEqual(n.posts.length, 1);
});

test('Netflix : un saut dans la barre de progression ne suffit pas (20 s de lecture réelle exigées)', () => {
  const n = netflixPage();
  n.check();
  n.play(5);
  n.at(0.95); n.wait(5); /* saut direct à 95 % : non compté */
  assert.strictEqual(n.posts.length, 0);
  n.play(10);
  assert.strictEqual(n.posts.length, 0); /* 15 s réellement regardées */
  n.play(10);
  assert.strictEqual(n.posts.length, 1);
  /* lecture accélérée x2 ou onglet ralenti : compte toujours */
  const m = netflixPage();
  m.at(0.79); m.check();
  m.play(30, 2);
  assert.strictEqual(m.posts.length, 1);
});

test('Netflix : un film reste à 90 % (générique de fin dès 80 %)', () => {
  const n = netflixPage();
  Object.assign(n.page, { type: 'movie', season: null, episode: null, titleText: 'Matrix', durationMs: 120 * 60 * 1000 });
  n.at(0.8); n.check();
  n.play(11 * 60); /* ~89 % */
  assert.strictEqual(n.posts.length, 0);
  n.play(60);
  assert.strictEqual(n.posts.length, 1);
  assert.deepStrictEqual(n.posts[0], { __wl: true, type: 'wl_watched', kind: 'movie', title: 'Matrix', season: null, episode: null, origin: 'https://www.netflix.com' });
  const m = netflixPage();
  Object.assign(m.page, { type: 'movie', season: null, episode: null, titleText: 'Matrix', durationMs: 120 * 60 * 1000, endUi: true });
  m.at(0.75); m.check();
  m.play(4 * 60); /* 78 % */
  assert.strictEqual(m.posts.length, 0);
  m.play(3 * 60); /* > 80 % avec générique */
  assert.strictEqual(m.posts.length, 1);
});

/* --- Fenêtre de l'extension : textes de la dernière détection (français) --- */
function popup(wlLast, lang = 'fr') {
  const messages = JSON.parse(read('extension/_locales/' + lang + '/messages.json'));
  const getMessage = (key, subs) => {
    const m = messages[key];
    if (!m) return '';
    return m.message.replace(/\$(\w+)\$/g, (all, name) => {
      const p = m.placeholders && m.placeholders[name.toLowerCase()];
      return p ? p.content.replace(/\$(\d)/g, (x, i) => (subs || [])[i - 1] ?? '') : all;
    });
  };
  const el = () => {
    const e = { className: '', children: [], _text: '', style: {}, disabled: false, classList: { toggle: () => {} }, get main() { return e.children.length ? e.children[0].textContent : e._text; }, appendChild: c => e.children.push(c), addEventListener: () => {} };
    Object.defineProperty(e, 'textContent', { get: () => e._text + e.children.map(c => c.textContent).join(' | '), set: v => { e._text = v; e.children = []; } });
    return e;
  };
  const els = { token: el(), save: el(), status: el(), last: el(), importNetflix: el(), csvFile: el(), csvLabel: el(), importStatus: el(), openDetected: el() };
  const listeners = [];
  const onChanged = (changes, area) => listeners.forEach(fn => fn(changes, area));
  const store = { wlToken: 'tok', wlLast };
  const ctx = {
    document: { documentElement: {}, title: '', querySelectorAll: () => [], getElementById: id => els[id],
      createElement: () => el(), createTextNode: t => ({ textContent: t }) },
    chrome: {
      i18n: { getMessage, getUILanguage: () => lang },
      runtime: { sendMessage: (m, cb) => cb && cb({ ok: true }) },
      tabs: { create: () => {} },
      storage: { local: { get: (k, cb) => cb(store), set: (o, cb) => cb && cb(), remove: (k, cb) => cb && cb() },
        onChanged: { addListener: fn => { listeners.push(fn); } } },
    },
    Date, Number, String,
  };
  vm.createContext(ctx);
  vm.runInContext(read('extension/options.js'), ctx);
  return { last: els.last, importStatus: els.importStatus, importNetflix: els.importNetflix,
    update: v => onChanged({ wlLast: { newValue: v } }, 'local'), updateImport: v => onChanged({ wlImport: { newValue: v } }, 'local') };
}

test('fenêtre : dernière détection et réponse du serveur en français clair', () => {
  const at = Date.UTC(2026, 9, 8, 19, 40);
  const ep = { at, kind: 'episode', title: 'Dark', season: 2, episode: 3 };
  const text = last => popup(last).last.main;
  assert.strictEqual(text({ ...ep, status: 'updated', matchedTitle: 'Dark' }), 'Mis à jour : Dark S2E3');
  assert.strictEqual(text({ ...ep, title: 'DARK', status: 'updated', matchedTitle: 'Dark' }), 'Mis à jour : Dark S2E3'); /* titre de la watchlist */
  assert.strictEqual(text({ ...ep, status: 'already_up_to_date', matchedTitle: 'Dark', episode: 5 }), 'Déjà à jour : Dark S2E5');
  assert.strictEqual(text({ ...ep, title: 'Squid Game', status: 'not_found' }), 'Pas dans ta liste : Squid Game S2E3');
  assert.strictEqual(text({ ...ep, title: 'Lupin', status: 'ambiguous' }), 'Plusieurs titres correspondent à « Lupin », rien modifié');
  assert.match(text({ ...ep, status: 'invalid_token' }), /^Jeton invalide/);
  assert.match(text({ ...ep, status: 'no_token' }), /^Aucun jeton enregistré : Dark S2E3/);
  assert.match(text({ ...ep, status: 'network' }), /^Cinepisode injoignable/);
  assert.match(text({ ...ep, status: 'server_error' }), /^Erreur du serveur/);
  assert.strictEqual(text({ ...ep, status: 'legacy_updated' }), 'Mis à jour : Dark S2E3');
  assert.match(text({ ...ep, status: 'legacy_no_change' }), /^Aucun changement pour Dark S2E3/);
  assert.strictEqual(text({ at, kind: 'movie', title: 'Matrix', season: null, episode: null, status: 'updated', matchedTitle: 'The Matrix' }), 'Mis à jour : The Matrix');
  assert.match(popup(null).last.textContent, /^Rien détecté pour l'instant/);
  /* couleur + date */
  const p = popup({ ...ep, status: 'not_found' });
  assert.strictEqual(p.last.className, 'warn');
  assert.match(p.last.textContent, /\| Le .*2026|\| Le \d/);
  /* mise à jour en direct */
  p.update({ ...ep, status: 'updated', matchedTitle: 'Dark' });
  assert.strictEqual(p.last.main, 'Mis à jour : Dark S2E3');
  assert.strictEqual(p.last.className, 'ok');
  /* anglais */
  assert.strictEqual(popup({ ...ep, status: 'updated', matchedTitle: 'Dark' }, 'en').last.main, 'Updated: Dark S2E3');
});

test('fenêtre : chaque statut a un texte dans les deux langues, sans marqueur $...$ oublié', () => {
  const src = read('extension/options.js');
  const keys = [...src.matchAll(/\[\s*'(last\w+)'\s*,\s*'(?:ok|warn|err)'\s*\]/g)].map(m => m[1]);
  assert.ok(keys.length >= 12);
  for (const l of ['fr', 'en']) {
    const msgs = JSON.parse(read('extension/_locales/' + l + '/messages.json'));
    for (const k of [...keys, 'lastAt', 'lastNone', 'lastTitle']) {
      assert.ok(msgs[k], l + ' : ' + k);
      for (const [, name] of msgs[k].message.matchAll(/\$(\w+)\$/g)) assert.ok(msgs[k].placeholders && msgs[k].placeholders[name.toLowerCase()], l + ' ' + k + ' : ' + name);
    }
  }
  assert.strictEqual(JSON.parse(read('extension/manifest.json')).version, '0.6.1');
});

test('service worker : détections en direct sans correspondance envoyées à l\'onglet « Détectés » (extension_push_detections)', async () => {
  const { call, fetches, store } = serviceWorker({ token: 'jeton-secret-42', responses: [
    { status: 200, data: { status: 'not_found', title: '1899', season: 1, episode: 1 } },
    { status: 200, data: { status: 'ok', inserted: 1, updated: 0, unchanged: 0, invalid: 0 } },
    { status: 200, data: { status: 'updated', title: 'Dark', season: 2, episode: 4 } },
    { status: 200, data: { status: 'ambiguous', title: 'Lupin', season: 1, episode: 2, count: 2 } },
    { status: 200, data: { status: 'ok', inserted: 1, updated: 0, unchanged: 0, invalid: 0 } },
  ] });
  await call({ ...EP, title: '1899', season: 1, episode: 1 });
  await new Promise((r) => setTimeout(r, 5));
  await call({ ...EP, episode: 4 });
  await call({ ...EP, title: 'Lupin', season: 1, episode: 2 });
  await new Promise((r) => setTimeout(r, 10));
  const pushes = fetches.filter(f => /extension_push_detections$/.test(f.url));
  assert.strictEqual(pushes.length, 2, 'mis à jour : rien envoyé à « Détectés »');
  assert.deepStrictEqual(pushes.map(f => f.body.p_items.map(i => [i.source, i.title, i.type, i.season, i.episode])),
    [[['live', '1899', 'show', 1, 1]], [['live', 'Lupin', 'show', 1, 2]]]);
  assert.ok(pushes.every(f => typeof f.body.p_items[0].watched_at === 'number' && f.body.p_token === 'jeton-secret-42'));
  assert.strictEqual(store.wlLive, undefined, 'plus de liste locale wlLive');
});

/* --- Import de l'historique (service worker) --- */
const PAGE = { id: 'ext-id', url: 'chrome-extension://ext-id/options.html' };
const CSV = 'Title,Date\n"Dark: Season 1: Secrets",01/10/2026\n"Dark: Season 1: Lies",02/10/2026\n"Inception",03/10/2026\n';
async function waitFor(fn) { for (let i = 0; i < 100; i++) { if (fn()) return; await new Promise(r => setTimeout(r, 5)); } throw new Error('délai'); }

test('import CSV : expéditeur vérifié (page de l\'extension), détections envoyées par lot, onglet « Détectés » ouvert', async () => {
  const sw = serviceWorker({ token: 'jeton-secret-42', responses: [{ status: 200, data: { status: 'ok', inserted: 2, updated: 0, unchanged: 0, invalid: 0 } }] });
  assert.strictEqual((await sw.call({ type: 'wl_import_csv', text: CSV }, { id: 'ext-id', tab: { id: 1 }, url: 'https://www.netflix.com/watch/1' })).reason, 'sender');
  assert.strictEqual((await sw.call({ type: 'wl_import_csv', text: CSV }, { id: 'autre', url: 'chrome-extension://autre/options.html' })).reason, 'sender');
  assert.strictEqual((await sw.call({ type: 'wl_import_csv', text: '' }, PAGE)).reason, 'csv');
  assert.strictEqual(sw.fetches.length, 0);
  const r = await sw.call({ type: 'wl_import_csv', text: CSV }, PAGE);
  assert.strictEqual(r.started, true);
  await waitFor(() => sw.store.wlImport && sw.store.wlImport.state === 'done');
  assert.strictEqual(sw.fetches.length, 1);
  assert.match(sw.fetches[0].url, /\/rest\/v1\/rpc\/extension_push_detections$/);
  const items = sw.fetches[0].body.p_items;
  assert.deepStrictEqual(items.map(i => [i.source, i.title, i.type, i.season, i.episode]),
    [['netflix_csv', 'Dark', 'show', 1, 2], ['netflix_csv', 'Inception', 'movie', null, null]]);
  assert.deepStrictEqual(Object.keys(items[0]).sort(), ['episode', 'progress_pct', 'season', 'source', 'title', 'type', 'watched_at']);
  assert.deepStrictEqual({ ...sw.store.wlImport.sent }, { inserted: 2, updated: 0, unchanged: 0, invalid: 0 });
  assert.ok(!JSON.stringify(sw.store.wlImport).includes('jeton-secret-42'));
  assert.deepStrictEqual(sw.tabsCreated, ['https://cinepisode.com/#detectes']);
});

test('import CSV : jeton invalide, plafond et absence de jeton signalés ; rien d\'ouvert', async () => {
  for (const [data, err] of [[{ status: 'invalid_token' }, 'invalid_token'], [{ status: 'limit', limit: 20000 }, 'limit'], [{ message: 'boom' }, 'server_error']]) {
    const sw = serviceWorker({ responses: [{ status: 200, data }] });
    await sw.call({ type: 'wl_import_csv', text: CSV }, PAGE);
    await waitFor(() => sw.store.wlImport && sw.store.wlImport.state === 'error');
    assert.strictEqual(sw.store.wlImport.error, err);
    assert.deepStrictEqual(sw.tabsCreated, []);
  }
  const none = serviceWorker({ token: null });
  assert.strictEqual((await none.call({ type: 'wl_import_csv', text: CSV }, PAGE)).reason, 'no_token');
  assert.strictEqual(none.store.wlImport.error, 'no_token');
});

test('fenêtre : avancement et résultat de l\'import en français clair', () => {
  const p = popup(null);
  p.updateImport({ state: 'running', step: 'history', pages: 3, items: 250, at: Date.now() });
  assert.match(p.importStatus.textContent, /^Lecture de l'historique : 250 visionnages \(3 pages\)/);
  assert.strictEqual(p.importNetflix.disabled, true);
  p.updateImport({ state: 'running', step: 'history', pages: 3, items: 250, at: Date.now() - 11 * 60 * 1000 });
  assert.strictEqual(p.importNetflix.disabled, false, 'import arrêté depuis 10 min : boutons réactivés');
  p.updateImport({ state: 'done', titles: 42, sent: { inserted: 40, updated: 2, unchanged: 0, invalid: 0 }, at: Date.now() });
  assert.match(p.importStatus.textContent, /^42 titres envoyés \(40 nouveaux, 2 plus récents\)\. .*« Détectés »/);
  p.updateImport({ state: 'done', titles: 42, sent: { inserted: 0, updated: 0, unchanged: 42, invalid: 0 }, at: Date.now() });
  assert.strictEqual(p.importStatus.textContent, 'Rien de nouveau depuis le dernier import.');
  p.updateImport({ state: 'error', error: 'netflix_auth', at: Date.now() });
  assert.match(p.importStatus.textContent, /^Connecte-toi à Netflix/);
  assert.strictEqual(p.importStatus.className, 'err');
});
