'use strict';
/* Service worker (MV3) : reçoit les détections du relai Netflix (content/netflix-bridge.js),
 * revalide l'expéditeur et la forme du message, dédoublonne, puis appelle la fonction Supabase
 * mark_watched_by_title() — même jeton que Tautulli, bornée à la watchlist de son propriétaire.
 *
 * Le résultat de la dernière détection est gardé dans chrome.storage.local (clé wlLast, jamais le
 * jeton) pour que la fenêtre de l'extension l'affiche en clair (« Mis à jour : Dark S2E3 »...).
 *
 * 0.5.0 : import de l'historique (bouton de la fenêtre de l'extension). Le service worker lit
 * l'historique Netflix dans un onglet netflix.com, ou le fichier CSV transmis par la fenêtre,
 * regroupe par titre (lib/import.js) et envoie les détections à extension_push_detections().
 * Les détections en direct sans correspondance (« pas dans ta liste », « plusieurs titres ») sont
 * envoyées de la même façon. Tout se choisit ensuite dans l'onglet « Détectés » de Cinepisode.
 * Rien n'est envoyé ailleurs qu'à Supabase.
 *
 * 0.6.0 : Crunchyroll et Prime Video, activables séparément (permissions facultatives demandées
 * depuis la fenêtre de l'extension). Historique lu directement par le service worker avec la
 * session du navigateur (lib/crunchyroll.js, lib/prime.js), détection en direct par des scripts
 * enregistrés seulement quand la permission est accordée (lib/platforms.js).
 *
 * 0.6.1 : Crunchyroll lu depuis un onglet www.crunchyroll.com (existant, sinon ouvert en arrière-plan
 * puis refermé) par chrome.scripting : requêtes même origine, comme le site. En cas d'échec, l'étape
 * et le statut HTTP sont affichés, avec un diagnostic copiable sans aucun secret.
 * 0.6.2 : historique Crunchyroll paginé par curseur (meta.next_page, lib/crunchyroll.js). Si une page
 * après la première échoue, ce qui a été lu est quand même envoyé ; la fenêtre le signale (partial)
 * avec un diagnostic, et la date du dernier import n'avance pas (le prochain import relit tout). */
importScripts('lib/import.js', 'lib/platforms.js', 'lib/crunchyroll.js', 'lib/prime.js');
var I = self.CinepisodeImport;
var PLATFORMS = self.CinepisodePlatforms;
var CR = self.CinepisodeCrunchyroll;
var PV = self.CinepisodePrime;
var SUPA_URL = 'https://batfulcvvquffgfeppcx.supabase.co';
var SUPA_KEY = 'sb_publishable_AgSykBvnAW4cZmuMZJWnrA_lcFL5eT0';
/* Pages d'où une détection peut venir : Netflix (content_scripts du manifeste) et les pages des
 * plateformes activées (scripts enregistrés seulement après la permission, lib/platforms.js) */
var ALLOWED_ORIGINS = ['https://www.netflix.com', 'https://www.crunchyroll.com', 'https://www.primevideo.com'];
/* Réponses structurées de mark_watched_by_title (migration 20261008120000_mark_watched_fiable) */
var SERVER_STATUSES = ['updated', 'already_up_to_date', 'not_found', 'ambiguous', 'invalid_token', 'invalid_input'];

var lastSent = null; /* {key, at} — évite de renvoyer la même détection en boucle */

function sameAsLast(key) {
  if (!lastSent || lastSent.key !== key) return false;
  return (Date.now() - lastSent.at) < 2 * 60 * 1000; /* 2 min */
}

/* Message venu d'un content script de cette extension, dans un onglet d'une origine autorisée */
function trustedSender(sender) {
  if (!sender || sender.id !== chrome.runtime.id || !sender.tab) return false;
  var origin = sender.origin;
  if (!origin && sender.url) { try { origin = new URL(sender.url).origin; } catch (e) { return false; } }
  return ALLOWED_ORIGINS.indexOf(origin) >= 0;
}

function intOrNull(v) {
  if (v === null || v === undefined) return null;
  return (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100000) ? v : undefined;
}

/* Détection valide : épisode = saison et épisode entiers ; film = sans saison ni épisode */
function validDetection(msg) {
  var title = typeof msg.title === 'string' ? msg.title.trim() : '';
  var season = intOrNull(msg.season);
  var episode = intOrNull(msg.episode);
  if (!title || title.length > 300 || season === undefined || episode === undefined) return null;
  if (msg.kind === 'episode' && season !== null && episode !== null) return { kind: 'episode', title: title, season: season, episode: episode };
  if (msg.kind === 'movie' && season === null && episode === null) return { kind: 'movie', title: title, season: null, episode: null };
  return null;
}

/* Traduit la réponse du serveur en statut simple.
 * Base pas encore migrée : l'ancienne fonction renvoie true/false (legacy_updated / legacy_no_change). */
function interpret(data) {
  if (data === true) return { status: 'legacy_updated' };
  if (data === false) return { status: 'legacy_no_change' };
  if (data && typeof data === 'object' && SERVER_STATUSES.indexOf(data.status) >= 0) {
    return {
      status: data.status,
      matchedTitle: typeof data.title === 'string' ? data.title.slice(0, 300) : null,
      season: intOrNull(data.season) === undefined ? null : intOrNull(data.season),
      episode: intOrNull(data.episode) === undefined ? null : intOrNull(data.episode),
    };
  }
  return { status: 'server_error' };
}

function remember(det, result) {
  var last = {
    at: Date.now(),
    kind: det ? det.kind : null,
    title: det ? det.title : null,
    season: det ? det.season : null,
    episode: det ? det.episode : null,
    status: result.status,
    matchedTitle: result.matchedTitle || null,
  };
  /* Pour « Déjà à jour », on montre la progression réellement enregistrée dans la watchlist */
  if (result.status === 'already_up_to_date' && det && det.kind === 'episode') {
    last.season = result.season; last.episode = result.episode;
  }
  try { chrome.storage.local.set({ wlLast: last }); } catch (e) { /* stockage indisponible : rien à afficher */ }
}

function rpc(body, name) {
  return fetch(SUPA_URL + '/rest/v1/rpc/' + (name || 'mark_watched_by_title'), {
    method: 'POST',
    headers: { apikey: SUPA_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(function (r) { return r.json().catch(function () { return null; }).then(function (data) { return { r: r, data: data }; }); });
}

/* Appelle la nouvelle signature (avec p_type) ; si la base n'a pas encore la migration, PostgREST
 * ne trouve pas la fonction (404 / PGRST202) : on réessaie avec l'ancienne signature. */
function markWatched(token, det) {
  var base = { p_token: token, p_title: det.title, p_season: det.season, p_episode: det.episode };
  var withType = Object.assign({}, base, { p_type: det.kind });
  return rpc(withType).then(function (res) {
    var missing = res.r.status === 404 || (res.data && res.data.code === 'PGRST202');
    return missing ? rpc(base) : res;
  });
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || typeof msg !== 'object') return;
  if (IMPORT_TYPES.indexOf(msg.type) >= 0) return onImportMessage(msg, sender, sendResponse);
  if (msg.type !== 'wl_watched') return;
  if (!trustedSender(sender)) { sendResponse({ ok: false, reason: 'sender' }); return; }
  var det = validDetection(msg);
  if (!det) { remember(null, { status: 'invalid_detection' }); sendResponse({ ok: false, reason: 'invalid' }); return; }

  var key = det.kind + '|' + det.title + '|' + det.season + '|' + det.episode;
  if (sameAsLast(key)) { sendResponse({ ok: true, skipped: true }); return; }

  chrome.storage.local.get(['wlToken'], function (res) {
    var token = res.wlToken;
    if (!token) { remember(det, { status: 'no_token' }); sendResponse({ ok: false, reason: 'no_token' }); return; }

    markWatched(token, det).then(function (out) {
      var result = out.r.ok ? interpret(out.data) : { status: 'server_error' };
      if (out.r.ok) lastSent = { key: key, at: Date.now() };
      remember(det, result);
      /* Pas dans la liste / plusieurs titres : envoyé à l'onglet « Détectés » de Cinepisode */
      if (result.status === 'not_found' || result.status === 'ambiguous') pushLive(token, det);
      sendResponse({ ok: out.r.ok, status: result.status });
    }).catch(function () {
      remember(det, { status: 'network' });
      sendResponse({ ok: false, reason: 'network' });
    });
  });
  return true; /* réponse asynchrone */
});

/* ======================= Import de l'historique (0.5.0) ======================= */
var NETFLIX_ORIGIN = 'https://www.netflix.com';
var DETECTED_URL = 'https://cinepisode.com/#detectes';
var CSV_MAX_CHARS = 20 * 1024 * 1024;
var importRunning = false;
var IMPORT_TYPES = ['wl_import_netflix', 'wl_import_csv', 'wl_import_crunchyroll', 'wl_import_prime'];

/* Message venu d'une page de cette extension (fenêtre de l'extension / page d'options) */
function trustedExtensionPage(sender) {
  var base = chrome.runtime.getURL('');
  return !!sender && sender.id === chrome.runtime.id && typeof sender.url === 'string' && sender.url.indexOf(base) === 0;
}

/* État de l'import, affiché par la fenêtre de l'extension (clé wlImport, jamais le jeton) */
function setImportState(patch) {
  return new Promise(function (resolve) {
    chrome.storage.local.get(['wlImport'], function (res) {
      var cur = (res && res.wlImport && typeof res.wlImport === 'object') ? res.wlImport : {};
      /* Nouvel import : le diagnostic du précédent échec disparaît */
      var reset = patch.state === 'running' && patch.source ? { errStep: null, errStatus: null, diag: null, partial: false } : {};
      var next = Object.assign({}, cur, reset, patch, { at: Date.now() });
      chrome.storage.local.set({ wlImport: next }, function () { resolve(next); });
    });
  });
}
function storageGet(keys) { return new Promise(function (resolve) { chrome.storage.local.get(keys, function (r) { resolve(r || {}); }); }); }

/* Envoi des détections, par lots de 1 000 (limite de la RPC) */
async function pushDetections(token, items, onProgress) {
  var sum = { inserted: 0, updated: 0, unchanged: 0, invalid: 0 };
  var chunks = I.chunkItems(items, I.PUSH_MAX);
  for (var i = 0; i < chunks.length; i++) {
    var out = await rpc({ p_token: token, p_items: chunks[i] }, 'extension_push_detections');
    var data = out.data;
    if (data && data.status === 'invalid_token') { var e = new Error('invalid_token'); e.code = 'invalid_token'; throw e; }
    if (data && data.status === 'limit') { var e2 = new Error('limit'); e2.code = 'limit'; throw e2; }
    if (!out.r.ok || !data || data.status !== 'ok') { var e3 = new Error('server'); e3.code = 'server_error'; throw e3; }
    sum.inserted += data.inserted | 0; sum.updated += data.updated | 0; sum.unchanged += data.unchanged | 0; sum.invalid += data.invalid | 0;
    if (onProgress) onProgress(i + 1, chunks.length);
  }
  return sum;
}
function pushLive(token, det) {
  var item = I.pushItemFromLive(det, Date.now());
  if (!item) return;
  rpc({ p_token: token, p_items: [item] }, 'extension_push_detections').catch(function () { /* hors ligne : rien */ });
}

/* ---------- Onglet Netflix : relai de requêtes même origine (cookies Netflix de ce navigateur) ---------- */
/* Exécutée DANS l'onglet netflix.com (monde isolé de l'extension) : simple fetch même origine.
 * Refuse toute autre adresse. Le résultat ne revient qu'au service worker. */
function netflixRelayFetch(url, opts) {
  if (typeof url !== 'string' || url.indexOf('https://www.netflix.com/') !== 0) return Promise.resolve({ status: 0, body: '' });
  opts = opts || {};
  return fetch(url, { method: opts.method === 'POST' ? 'POST' : 'GET', headers: opts.headers || {}, body: opts.method === 'POST' ? opts.body : undefined,
    credentials: 'include', redirect: 'follow' })
    .then(function (r) {
      return r.text().then(function (text) { return { status: r.status, body: text.length > 8 * 1024 * 1024 ? '' : text }; });
    })
    .catch(function () { return { status: 0, body: '' }; });
}
/* Exécutée DANS l'onglet netflix.com (monde de la page) : identifiant du profil actif */
function netflixReadSession() {
  try {
    var d = window.netflix.reactContext.models.userInfo.data;
    return { userGuid: d.userGuid || null, profileName: d.name || null };
  } catch (e) { return null; }
}
function waitTabComplete(tabId, timeoutMs) {
  return new Promise(function (resolve, reject) {
    var done = false;
    function finish(ok) { if (done) return; done = true; chrome.tabs.onUpdated.removeListener(onUpd); clearTimeout(timer); ok ? resolve() : reject(new Error('timeout')); }
    function onUpd(id, info) { if (id === tabId && info.status === 'complete') finish(true); }
    var timer = setTimeout(function () { finish(false); }, timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpd);
    chrome.tabs.get(tabId, function (tab) { if (!chrome.runtime.lastError && tab && tab.status === 'complete') finish(true); });
  });
}
/* Onglet netflix.com existant, sinon ouvert en arrière-plan sur /browse */
function netflixTab() {
  return new Promise(function (resolve, reject) {
    chrome.tabs.query({ url: NETFLIX_ORIGIN + '/*' }, function (tabs) {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      var ready = (tabs || []).filter(function (tb) { return tb.status === 'complete'; });
      if (ready.length) return resolve(ready[0].id);
      if (tabs && tabs.length) return waitTabComplete(tabs[0].id, 30000).then(function () { resolve(tabs[0].id); }, reject);
      chrome.tabs.create({ url: NETFLIX_ORIGIN + '/browse', active: false }, function (tab) {
        if (chrome.runtime.lastError || !tab) return reject(new Error((chrome.runtime.lastError && chrome.runtime.lastError.message) || 'tab'));
        waitTabComplete(tab.id, 45000).then(function () { setTimeout(function () { resolve(tab.id); }, 1500); }, reject);
      });
    });
  });
}
function inTab(tabId, func, args, world) {
  return chrome.scripting.executeScript({ target: { tabId: tabId }, func: func, args: args || [], world: world || 'ISOLATED' })
    .then(function (res) { return res && res[0] ? res[0].result : null; });
}

function openDetected() { try { chrome.tabs.create({ url: DETECTED_URL, active: true }); } catch (e) { /* rien */ } }

async function runNetflixImport(token) {
  await setImportState({ state: 'running', source: 'netflix', step: 'tab', pages: 0, items: 0, done: 0, total: 0, error: null, sent: null, truncated: false, metaFailed: false, profile: null });
  var tabId;
  try { tabId = await netflixTab(); } catch (e) { await setImportState({ state: 'error', error: 'netflix_tab' }); return; }
  await setImportState({ step: 'session' });
  var session = null;
  try { session = await inTab(tabId, netflixReadSession, [], 'MAIN'); } catch (e) { session = null; }
  if (!session || !session.userGuid) {
    var page = await inTab(tabId, netflixRelayFetch, [NETFLIX_ORIGIN + '/browse', { method: 'GET' }]).catch(function () { return null; });
    session = page && page.status === 200 ? I.extractNetflixSession(page.body) : null;
  }
  var fetchFn = function (url, opts) { return inTab(tabId, netflixRelayFetch, [url, opts]); };
  var meta = (await storageGet(['wlImportMeta'])).wlImportMeta || {};
  var since = typeof meta.netflixLastMs === 'number' ? meta.netflixLastMs - 3 * 86400000 : null;
  var hist;
  try {
    hist = await I.fetchNetflixHistory(fetchFn, session, { sinceMs: since,
      onProgress: function (p, n) { setImportState({ step: 'history', pages: p, items: n }); } });
  } catch (e) {
    await setImportState({ state: 'error', error: e && (e.code === 'netflix_auth' || e.code === 'netflix_parse') ? 'netflix_auth' : 'netflix_http' });
    return;
  }
  var shows = hist.items.filter(function (g) { return g.kind === 'show'; });
  var metaRes = await I.fetchNetflixMetadata(fetchFn, shows, function (i, n) {
    if (i % 5 === 0) setImportState({ step: 'meta', done: i, total: n });
  });
  var items = I.pushItemsFromGroups(hist.items, 'netflix');
  await setImportState({ step: 'push', done: 0, total: items.length });
  var sent;
  try {
    sent = await pushDetections(token, items, function (d, n) { setImportState({ done: d, total: n }); });
  } catch (e) {
    await setImportState({ state: 'error', error: (e && e.code) || 'network' });
    return;
  }
  meta.netflixLastMs = I.latestDate(hist.items, meta.netflixLastMs);
  meta.netflixLastAt = Date.now();
  chrome.storage.local.set({ wlImportMeta: meta });
  await setImportState({ state: 'done', step: 'done', titles: items.length, sent: sent, truncated: hist.truncated,
    metaFailed: !!metaRes.failed, profile: session && session.profileName ? String(session.profileName).slice(0, 60) : null });
  if (sent.inserted + sent.updated > 0) openDetected();
}

async function runCsvImport(token, text) {
  await setImportState({ state: 'running', source: 'netflix_csv', step: 'parse', pages: 0, items: 0, done: 0, total: 0, error: null, sent: null, truncated: false, metaFailed: false, profile: null });
  var parsed = I.parseNetflixCsv(text);
  if (parsed.error || !parsed.items.length) { await setImportState({ state: 'error', error: 'csv' }); return; }
  var items = I.pushItemsFromGroups(parsed.items, 'netflix_csv');
  await setImportState({ step: 'push', done: 0, total: items.length });
  var sent;
  try {
    sent = await pushDetections(token, items, function (d, n) { setImportState({ done: d, total: n }); });
  } catch (e) {
    await setImportState({ state: 'error', error: (e && e.code) || 'network' });
    return;
  }
  var meta = (await storageGet(['wlImportMeta'])).wlImportMeta || {};
  meta.csvLastAt = Date.now();
  chrome.storage.local.set({ wlImportMeta: meta });
  await setImportState({ state: 'done', step: 'done', titles: items.length, sent: sent });
  if (sent.inserted + sent.updated > 0) openDetected();
}

/* ======================= Crunchyroll et Prime Video (0.6.0) ======================= */
function permissionsContains(origins) {
  return new Promise(function (resolve) {
    try { chrome.permissions.contains({ origins: origins }, function (ok) { void chrome.runtime.lastError; resolve(!!ok); }); }
    catch (e) { resolve(false); }
  });
}
/* Requête directe du service worker, avec les cookies de la plateforme (permission accordée),
 * limitée aux adresses de cette plateforme. Renvoie {status, body}. */
var PLATFORM_FETCH_PREFIXES = {
  crunchyroll: ['https://www.crunchyroll.com/'],
  prime: ['https://www.primevideo.com/', 'https://atv-ps.primevideo.com/', 'https://atv-ps-eu.primevideo.com/', 'https://atv-ps-fe.primevideo.com/'],
};
function platformFetch(platform) {
  var prefixes = PLATFORM_FETCH_PREFIXES[platform] || [];
  return function (url, opts) {
    var allowed = typeof url === 'string' && prefixes.some(function (p) { return url.indexOf(p) === 0; });
    if (!allowed) return Promise.resolve({ status: 0, body: '' });
    opts = opts || {};
    return fetch(url, { method: opts.method === 'POST' ? 'POST' : 'GET', headers: opts.headers || {},
      body: opts.method === 'POST' ? opts.body : undefined, credentials: 'include', redirect: 'follow' })
      .then(function (r) {
        return r.text().then(function (text) { return { status: r.status, body: text.length > 8 * 1024 * 1024 ? '' : text }; });
      })
      .catch(function () { return { status: 0, body: '' }; });
  };
}
function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
/* Identifiant d'appareil propre à cette installation (demandé par Crunchyroll et Prime Video pour
 * leurs jetons ; aléatoire, sans lien avec l'utilisateur). */
async function deviceId() {
  var st = await storageGet(['wlDeviceId']);
  if (typeof st.wlDeviceId === 'string' && /^[0-9a-f-]{36}$/.test(st.wlDeviceId)) return st.wlDeviceId;
  var id = (self.crypto && self.crypto.randomUUID) ? self.crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, function () { return (Math.random() * 16 | 0).toString(16); });
  chrome.storage.local.set({ wlDeviceId: id });
  return id;
}
function uiLocale() {
  var l = '';
  try { l = chrome.i18n.getUILanguage(); } catch (e) { l = ''; }
  return /^fr/i.test(l || 'fr') ? { cr: 'fr-FR', pv: 'fr_FR' } : { cr: 'en-US', pv: 'en_US' };
}

/* ---------- Crunchyroll : requêtes depuis l'onglet www.crunchyroll.com (0.6.1) ----------
 * Depuis le service worker, les requêtes partaient avec l'origine chrome-extension:// : Cloudflare
 * et l'API de Crunchyroll pouvaient les refuser (statut inattendu, page HTML de contrôle). Depuis un
 * onglet du site, c'est une requête même origine, avec les cookies du site, comme le site lui-même. */
var CR_TAB_ORIGIN = 'https://www.crunchyroll.com';
/* Exécutée DANS l'onglet www.crunchyroll.com (monde isolé de l'extension) : fetch même origine.
 * Refuse toute autre adresse. Renvoie {status, body, cf, net} au service worker seulement ; cf :
 * en-tête cf-mitigated (contrôle Cloudflare), net : nom de l'erreur réseau. */
function crRelayFetch(url, opts) {
  if (typeof url !== 'string' || url.indexOf('https://www.crunchyroll.com/') !== 0) return Promise.resolve({ status: 0, body: '', net: 'refused' });
  opts = opts || {};
  return fetch(url, { method: opts.method === 'POST' ? 'POST' : 'GET', headers: opts.headers || {}, body: opts.method === 'POST' ? opts.body : undefined,
    credentials: 'include', redirect: 'follow', cache: 'no-store' })
    .then(function (r) {
      var cf = !!(r.headers && r.headers.get && r.headers.get('cf-mitigated'));
      return r.text().then(function (text) { return { status: r.status, body: text.length > 8 * 1024 * 1024 ? '' : text, cf: cf }; });
    })
    .catch(function (e) { return { status: 0, body: '', net: String((e && e.name) || 'error').slice(0, 40) }; });
}
/* Exécutée DANS l'onglet : identifiant d'appareil du site (cookie device_id, s'il est lisible), pour
 * que le jeton soit demandé avec le même identifiant que le site. Jamais stocké ni affiché. */
function crReadDeviceId() {
  try {
    var m = /(?:^|;\s*)device_id=([0-9a-fA-F-]{36})(?:;|$)/.exec(document.cookie || '');
    return m ? m[1] : null;
  } catch (e) { return null; }
}
/* Onglet existant du site (déjà chargé), sinon ouvert en arrière-plan ; opened : à refermer après */
function platformTab(origin, path) {
  return new Promise(function (resolve, reject) {
    chrome.tabs.query({ url: origin + '/*' }, function (tabs) {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      var ready = (tabs || []).filter(function (tb) { return tb.status === 'complete'; });
      if (ready.length) return resolve({ id: ready[0].id, opened: false });
      if (tabs && tabs.length) return waitTabComplete(tabs[0].id, 30000).then(function () { resolve({ id: tabs[0].id, opened: false }); }, reject);
      chrome.tabs.create({ url: origin + path, active: false }, function (tab) {
        if (chrome.runtime.lastError || !tab) return reject(new Error((chrome.runtime.lastError && chrome.runtime.lastError.message) || 'tab'));
        waitTabComplete(tab.id, 45000).then(function () { setTimeout(function () { resolve({ id: tab.id, opened: true }); }, 1500); }, reject);
      });
    });
  });
}
function closeTab(tab) { try { if (tab && tab.opened) chrome.tabs.remove(tab.id, function () { void chrome.runtime.lastError; }); } catch (e) { /* déjà fermé */ } }
function extVersion() { try { return chrome.runtime.getManifest().version; } catch (e) { return '?'; } }
function browserVersion() {
  try { var m = /(?:Chrome|Chromium|Edg|Firefox)\/(\d+)/.exec(navigator.userAgent || ''); return m ? m[0].split('/')[0] + ' ' + m[1] : null; } catch (e) { return null; }
}
/* Diagnostic d'un import en échec : étape, statut, quelques indications. JAMAIS de jeton, cookie,
 * identifiant de compte ou d'appareil, ni de contenu de réponse : il est fait pour être copié. */
function importDiag(platform, err, extra) {
  err = err || {};
  var d = { v: extVersion(), platform: platform, step: err.step || null, status: typeof err.status === 'number' ? err.status : null,
    code: err.code || null, cloudflare: !!err.cloudflare, at: new Date().toISOString() };
  if (err.api) d.api = err.api;
  if (typeof err.page === 'number') d.page = err.page;
  if (err.parse) d.parse = true;
  if (err.net) d.net = String(err.net).slice(0, 40);
  if (err.partial) d.partial = true;
  var b = browserVersion(); if (b) d.browser = b;
  if (extra) Object.keys(extra).forEach(function (k) { d[k] = extra[k]; });
  return d;
}
var CR_ERRORS = ['crunchyroll_auth', 'crunchyroll_blocked', 'crunchyroll_rate', 'crunchyroll_http', 'crunchyroll_tab'];

/* Import commun : lit l'historique (fetchHistory de la plateforme), envoie, mémorise la date */
async function runPlatformImport(token, platform) {
  var lib = platform === 'crunchyroll' ? CR : PV;
  await setImportState({ state: 'running', source: platform, step: 'session', pages: 0, items: 0, done: 0, total: 0, error: null, sent: null, truncated: false, metaFailed: false, profile: null, });
  if (!(await permissionsContains(PLATFORMS[platform].origins))) { await setImportState({ state: 'error', error: 'permission' }); return; }
  var meta = (await storageGet(['wlImportMeta'])).wlImportMeta || {};
  var lastKey = platform + 'LastMs';
  var since = typeof meta[lastKey] === 'number' ? meta[lastKey] - 3 * 86400000 : null;
  var loc = uiLocale();
  var fetchFn = platformFetch(platform), ownDev = await deviceId(), dev = ownDev, tab = null, via = 'worker', lastNet = null;
  if (platform === 'crunchyroll') {
    via = 'tab';
    await setImportState({ step: 'tab' });
    try { tab = await platformTab(CR_TAB_ORIGIN, '/'); } catch (e) {
      await setImportState({ state: 'error', error: 'crunchyroll_tab', errStep: 'tab', errStatus: null, diag: importDiag(platform, { step: 'tab', code: 'crunchyroll_tab' }, { via: via }) });
      return;
    }
    await setImportState({ step: 'session' });
    var siteDev = await inTab(tab.id, crReadDeviceId, []).catch(function () { return null; });
    if (siteDev) dev = siteDev;
    fetchFn = function (url, opts) {
      return inTab(tab.id, crRelayFetch, [url, opts]).then(function (r) {
        if (r && r.net) lastNet = r.net;
        return r || { status: 0, body: '', net: 'script' };
      }, function () { lastNet = 'script'; return { status: 0, body: '', net: 'script' }; });
    };
  }
  var hist;
  try {
    hist = await lib.fetchHistory(fetchFn, {
      deviceId: dev, locale: loc.cr, uxLocale: loc.pv, sinceMs: since, sleep: sleep,
      onProgress: function (a, b, c) {
        if (a === 'meta') { setImportState({ step: 'meta', done: b, total: c }); return; }
        if (a === 'history') { setImportState({ step: 'history', pages: b, items: c }); return; }
        setImportState({ step: 'history', pages: a, items: b });
      },
    });
  } catch (e) {
    closeTab(tab);
    var code = e && e.code;
    var error = platform === 'crunchyroll' ? (CR_ERRORS.indexOf(code) >= 0 ? code : 'crunchyroll_http')
      : (code === platform + '_auth' ? platform + '_auth' : platform + '_http');
    var errInfo = { step: e && e.step, status: e && e.status, code: error, cloudflare: e && e.cloudflare, api: e && e.api, page: e && e.page, parse: e && e.parse, net: e && e.status === 0 ? lastNet : null };
    await setImportState({ state: 'error', error: error, errStep: errInfo.step || null, errStatus: typeof errInfo.status === 'number' ? errInfo.status : null,
      diag: importDiag(platform, errInfo, { via: via, tabOpened: !!(tab && tab.opened), siteDeviceId: platform === 'crunchyroll' ? dev !== ownDev : undefined }) });
    return;
  }
  closeTab(tab);
  /* Lecture interrompue après la première page (0.6.2) : le début de l'historique est envoyé, avec
   * un diagnostic de la page en échec (aucun jeton ni identifiant) */
  var partial = hist.partial || null;
  var partialDiag = partial ? importDiag(platform, { step: partial.step || 'history', status: partial.status, code: partial.code,
    cloudflare: partial.cloudflare, api: hist.api, page: partial.page, parse: partial.parse, partial: true,
    net: partial.status === 0 ? lastNet : null }, { via: via }) : null;
  var items = I.pushItemsFromGroups(hist.items, platform);
  await setImportState({ step: 'push', done: 0, total: items.length });
  var sent = { inserted: 0, updated: 0, unchanged: 0, invalid: 0 };
  if (items.length) {
    try {
      sent = await pushDetections(token, items, function (d, n) { setImportState({ done: d, total: n }); });
    } catch (e) {
      await setImportState({ state: 'error', error: (e && e.code) || 'network', errStep: 'push', errStatus: null, diag: importDiag(platform, { step: 'push', code: (e && e.code) || 'network' }, { via: via }) });
      return;
    }
  }
  /* Import partiel : la date n'avance pas, pour que le prochain import relise la partie manquante */
  if (!partial) meta[lastKey] = I.latestDate(hist.items, meta[lastKey]);
  meta[platform + 'LastAt'] = Date.now();
  chrome.storage.local.set({ wlImportMeta: meta });
  await setImportState({ state: 'done', step: 'done', titles: items.length, sent: sent, truncated: !!hist.truncated, metaFailed: !!hist.metaFailed,
    partial: !!partial, diag: partialDiag });
  if (sent.inserted + sent.updated > 0) openDetected();
}

/* Scripts de détection en direct : enregistrés quand la permission de la plateforme est accordée,
 * retirés quand elle est retirée (au démarrage, à l'installation et à chaque changement). */
async function syncPlatformScripts() {
  if (!chrome.scripting || !chrome.scripting.registerContentScripts || !chrome.permissions) return;
  var registered = [];
  try { registered = (await chrome.scripting.getRegisteredContentScripts()).map(function (c) { return c.id; }); } catch (e) { registered = []; }
  var names = Object.keys(PLATFORMS);
  for (var i = 0; i < names.length; i++) {
    var p = PLATFORMS[names[i]];
    var granted = await permissionsContains(p.origins);
    var ids = p.scripts.map(function (c) { return c.id; });
    var present = ids.filter(function (id) { return registered.indexOf(id) >= 0; });
    try {
      if (granted && present.length !== ids.length) {
        if (present.length) await chrome.scripting.unregisterContentScripts({ ids: present });
        await chrome.scripting.registerContentScripts(p.scripts.map(function (c) { return Object.assign({ persistAcrossSessions: true }, c); }));
      } else if (!granted && present.length) {
        await chrome.scripting.unregisterContentScripts({ ids: present });
      }
    } catch (e) { /* permission retirée entre-temps : resynchronisé au prochain changement */ }
  }
}
if (chrome.permissions && chrome.permissions.onAdded) {
  chrome.permissions.onAdded.addListener(function () { syncPlatformScripts(); });
  chrome.permissions.onRemoved.addListener(function () { syncPlatformScripts(); });
}
if (chrome.runtime.onInstalled) chrome.runtime.onInstalled.addListener(function () { syncPlatformScripts(); });
if (chrome.runtime.onStartup) chrome.runtime.onStartup.addListener(function () { syncPlatformScripts(); });

function onImportMessage(msg, sender, sendResponse) {
  if (!trustedExtensionPage(sender)) { sendResponse({ ok: false, reason: 'sender' }); return; }
  if (importRunning) { sendResponse({ ok: false, reason: 'busy' }); return; }
  if (msg.type === 'wl_import_csv' && (typeof msg.text !== 'string' || !msg.text || msg.text.length > CSV_MAX_CHARS)) {
    sendResponse({ ok: false, reason: 'csv' }); return;
  }
  chrome.storage.local.get(['wlToken'], function (res) {
    var token = res.wlToken;
    if (!token) { setImportState({ state: 'error', error: 'no_token' }); sendResponse({ ok: false, reason: 'no_token' }); return; }
    importRunning = true;
    sendResponse({ ok: true, started: true });
    var job = msg.type === 'wl_import_csv' ? runCsvImport(token, msg.text)
      : msg.type === 'wl_import_crunchyroll' ? runPlatformImport(token, 'crunchyroll')
        : msg.type === 'wl_import_prime' ? runPlatformImport(token, 'prime')
          : runNetflixImport(token);
    job.catch(function () { return setImportState({ state: 'error', error: 'network' }); })
      .then(function () { importRunning = false; });
  });
  return true;
}
