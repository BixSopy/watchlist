'use strict';
/* Page « Titres détectés » (extension 0.5.0).
 *
 * Sources : historique Netflix (lu dans un onglet netflix.com de ce navigateur), fichier CSV Netflix,
 * détections en direct restées sans correspondance (« pas dans ta liste », « plusieurs titres »).
 * Correspondance avec la liste Cinepisode et choix des fiches TMDB : ici, dans le navigateur.
 *
 * Ce qui sort du navigateur :
 *  - vers Supabase : le jeton (lecture de la liste), puis, au clic sur « Appliquer » uniquement,
 *    les changements cochés (identifiant du titre + saison/épisode, ou fiche TMDB à ajouter) ;
 *  - vers le proxy TMDB de cinepisode.com : le NOM des titres absents de la liste (recherche),
 *    sans date ni progression. Jamais l'historique lui-même.
 * Aucun innerHTML avec des données extérieures : tout passe par textContent. */
(function () {
var I = CinepisodeImport;
var SUPA_URL = 'https://batfulcvvquffgfeppcx.supabase.co';
var SUPA_KEY = 'sb_publishable_AgSykBvnAW4cZmuMZJWnrA_lcFL5eT0';
var TMDB_PROXY = 'https://cinepisode.com/api/tmdb';
var IMG = 'https://image.tmdb.org/t/p/w92';
var NETFLIX_ORIGIN = 'https://www.netflix.com';
var POSTER_RE = /^\/[A-Za-z0-9_.-]{1,200}$/;

var lang = ((chrome.i18n && chrome.i18n.getUILanguage && chrome.i18n.getUILanguage()) || 'fr').split('-')[0] === 'fr' ? 'fr' : 'en';
var TMDB_LANG = lang === 'fr' ? 'fr-FR' : 'en-US';
var TXT = {
  fr: {
    pageTitle: 'Titres détectés',
    intro: 'Récupère ce que tu as regardé sur Netflix, vérifie la liste, coche ce que tu veux, puis clique sur « Appliquer ». Rien n\u2019est modifié dans Cinepisode avant ce clic.',
    importNetflix: 'Importer mon historique Netflix',
    importCsv: 'Importer le fichier CSV Netflix',
    csvHint: 'Fichier CSV : netflix.com › Compte › Profil › Activité de visionnage › « Télécharger tout ». Il ne contient pas les numéros d\u2019épisode : ils sont estimés (≈).',
    selectAll: 'Tout sélectionner',
    ignoreSelected: 'Ignorer la sélection',
    apply: 'Appliquer la sélection ({n})',
    privacy: 'Ton historique Netflix reste dans ce navigateur. Seuls les changements que tu valides sont envoyés à Cinepisode ; pour les titres absents de ta liste, seul leur nom est cherché sur TMDB via le serveur Cinepisode.',
    fAll: 'Tous', fNew: 'Nouveaux', fUpdates: 'Mises à jour', fAmbiguous: 'Ambigus', fUnchanged: 'Déjà à jour',
    srcNetflix: 'Historique Netflix', srcCsv: 'CSV Netflix', srcLive: 'Détecté en direct',
    film: 'Film', serie: 'Série', anime: 'Anime',
    badgeNew: 'Nouveau', badgeUpdate: 'Mise à jour', badgeAmbiguous: 'À choisir', badgeNone: 'Introuvable', badgeUnchanged: 'À jour', badgePending: 'Recherche…',
    seen: 'Vu jusqu\u2019à {p}', seenApprox: 'Vu jusqu\u2019à ≈ {p} (estimé)',
    movieSeen: 'Film vu',
    inList: 'Dans ta liste : {from}', toWatch: 'pas commencé',
    becomes: '{from} → {to}', finished: 'Terminé', inProgress: 'En cours · {p}',
    addAs: 'Ajouter : {title}{year} — {status}', addStatusSerie: 'en cours à {p} (terminé si c\u2019est le dernier épisode)', addStatusFilm: 'terminé',
    pickList: 'Plusieurs titres de ta liste portent ce nom. Lequel mettre à jour ?', pickListPlaceholder: '— Choisir —',
    pickTmdb: 'Plusieurs fiches possibles. Laquelle ?',
    noTmdb: 'Aucune fiche TMDB trouvée : ajoute-le à la main depuis Cinepisode.',
    noProgress: 'Numéros d\u2019épisode inconnus (Netflix ne les donne pas pour ce titre) : rien à appliquer.',
    alreadyOk: 'Ta liste est déjà à jour pour ce titre.',
    viaTmdb: 'reconnu par sa fiche TMDB',
    ignore: 'Ignorer',
    empty: 'Rien à afficher ici. Lance un import ci-dessus.',
    emptyFilter: 'Aucun titre dans ce filtre.',
    noToken: 'Aucun jeton enregistré : ouvre la fenêtre de l\u2019extension et colle ton jeton (Cinepisode › Réglages › Suivi auto).',
    invalidToken: 'Jeton invalide : génère un nouveau jeton dans Cinepisode (Réglages › Suivi auto) et colle-le dans la fenêtre de l\u2019extension.',
    listError: 'Impossible de lire ta liste Cinepisode ({e}). Réessaie dans un instant.',
    rpcMissing: 'Le serveur Cinepisode n\u2019a pas encore la mise à jour nécessaire à l\u2019import. Réessaie plus tard.',
    lastImport: 'Dernier import Netflix : {d}.',
    neverImported: 'Aucun import Netflix pour l\u2019instant.',
    openingNetflix: 'Ouverture de Netflix dans un onglet en arrière-plan…',
    readingSession: 'Lecture de ton profil Netflix…',
    readingHistory: 'Lecture de l\u2019historique : {n} visionnages ({p} pages)…',
    readingMeta: 'Numéros de saison et d\u2019épisode : {i} / {n} séries…',
    searchingTmdb: 'Recherche des nouveaux titres sur TMDB : {i} / {n}…',
    preparing: 'Préparation…',
    applying: 'Enregistrement dans Cinepisode…',
    netflixAuth: 'Netflix ne répond pas comme prévu. Ouvre netflix.com, connecte-toi, choisis ton profil, puis recommence. (Sinon, utilise le fichier CSV.)',
    netflixError: 'Lecture de l\u2019historique Netflix impossible ({e}). Netflix a peut-être changé son site : utilise le fichier CSV en attendant.',
    netflixTab: 'Impossible d\u2019ouvrir ou de lire l\u2019onglet Netflix ({e}).',
    importDone: '{n} titres trouvés dans ton historique{profile}. Vérifie la liste ci-dessous, puis « Appliquer ».',
    importTruncated: ' (historique très long : seuls les 20 000 visionnages les plus récents ont été lus)',
    metaFailed: ' Certains numéros d\u2019épisode n\u2019ont pas pu être lus chez Netflix.',
    csvDone: '{n} titres trouvés dans le fichier. Vérifie la liste ci-dessous, puis « Appliquer ».',
    csvError: 'Fichier illisible : choisis le fichier NetflixViewingHistory.csv téléchargé depuis Netflix.',
    csvTooBig: 'Fichier trop volumineux (20 Mo maximum).',
    tmdbQuota: 'Quota quotidien de recherche atteint : les titres restants seront cherchés demain.',
    tmdbError: 'Recherche TMDB indisponible pour l\u2019instant ({e}) : réessaie plus tard (les titres restent ici).',
    tmdbLimit: ' {n} titres seront cherchés au prochain passage (limite par import).',
    applied: 'Enregistré : {u} mis à jour, {a} ajoutés{extra}. Ils apparaissent dans Cinepisode à la prochaine synchronisation (30 s maximum).',
    appliedExtra: ', {d} déjà présents, {k} déjà à jour, {x} refusés',
    applyError: 'Enregistrement impossible ({e}). Rien n\u2019a été perdu : réessaie.',
    profile: ' (profil « {p} »)',
  },
  en: {
    pageTitle: 'Detected titles',
    intro: 'Fetch what you watched on Netflix, review the list, tick what you want, then click “Apply”. Nothing changes in Cinepisode before that click.',
    importNetflix: 'Import my Netflix history',
    importCsv: 'Import the Netflix CSV file',
    csvHint: 'CSV file: netflix.com › Account › Profile › Viewing activity › “Download all”. It has no episode numbers: they are estimated (≈).',
    selectAll: 'Select all',
    ignoreSelected: 'Ignore selection',
    apply: 'Apply selection ({n})',
    privacy: 'Your Netflix history stays in this browser. Only the changes you confirm are sent to Cinepisode; for titles missing from your list, only their name is searched on TMDB through the Cinepisode server.',
    fAll: 'All', fNew: 'New', fUpdates: 'Updates', fAmbiguous: 'Ambiguous', fUnchanged: 'Up to date',
    srcNetflix: 'Netflix history', srcCsv: 'Netflix CSV', srcLive: 'Detected live',
    film: 'Movie', serie: 'Series', anime: 'Anime',
    badgeNew: 'New', badgeUpdate: 'Update', badgeAmbiguous: 'Choose', badgeNone: 'Not found', badgeUnchanged: 'Up to date', badgePending: 'Searching…',
    seen: 'Watched up to {p}', seenApprox: 'Watched up to ≈ {p} (estimated)',
    movieSeen: 'Movie watched',
    inList: 'In your list: {from}', toWatch: 'not started',
    becomes: '{from} → {to}', finished: 'Finished', inProgress: 'Watching · {p}',
    addAs: 'Add: {title}{year} — {status}', addStatusSerie: 'watching at {p} (finished if it is the last episode)', addStatusFilm: 'finished',
    pickList: 'Several titles in your list have this name. Which one should be updated?', pickListPlaceholder: '— Choose —',
    pickTmdb: 'Several possible matches. Which one?',
    noTmdb: 'No TMDB match found: add it manually in Cinepisode.',
    noProgress: 'Episode numbers unknown (Netflix does not provide them for this title): nothing to apply.',
    alreadyOk: 'Your list is already up to date for this title.',
    viaTmdb: 'matched by its TMDB entry',
    ignore: 'Ignore',
    empty: 'Nothing here yet. Start an import above.',
    emptyFilter: 'No title in this filter.',
    noToken: 'No token saved: open the extension window and paste your token (Cinepisode › Settings › Auto-tracking).',
    invalidToken: 'Invalid token: generate a new one in Cinepisode (Settings › Auto-tracking) and paste it in the extension window.',
    listError: 'Could not read your Cinepisode list ({e}). Try again in a moment.',
    rpcMissing: 'The Cinepisode server does not have the update needed for imports yet. Try again later.',
    lastImport: 'Last Netflix import: {d}.',
    neverImported: 'No Netflix import yet.',
    openingNetflix: 'Opening Netflix in a background tab…',
    readingSession: 'Reading your Netflix profile…',
    readingHistory: 'Reading history: {n} views ({p} pages)…',
    readingMeta: 'Season and episode numbers: {i} / {n} series…',
    searchingTmdb: 'Searching new titles on TMDB: {i} / {n}…',
    preparing: 'Preparing…',
    applying: 'Saving to Cinepisode…',
    netflixAuth: 'Netflix did not answer as expected. Open netflix.com, sign in, pick your profile, then try again. (Or use the CSV file.)',
    netflixError: 'Could not read the Netflix history ({e}). Netflix may have changed its site: use the CSV file meanwhile.',
    netflixTab: 'Could not open or read the Netflix tab ({e}).',
    importDone: '{n} titles found in your history{profile}. Review the list below, then “Apply”.',
    importTruncated: ' (very long history: only the 20,000 most recent views were read)',
    metaFailed: ' Some episode numbers could not be read from Netflix.',
    csvDone: '{n} titles found in the file. Review the list below, then “Apply”.',
    csvError: 'Unreadable file: pick the NetflixViewingHistory.csv file downloaded from Netflix.',
    csvTooBig: 'File too large (20 MB max).',
    tmdbQuota: 'Daily search quota reached: remaining titles will be searched tomorrow.',
    tmdbError: 'TMDB search unavailable right now ({e}): try again later (titles stay here).',
    tmdbLimit: ' {n} titles will be searched next time (per-import limit).',
    applied: 'Saved: {u} updated, {a} added{extra}. They show up in Cinepisode at the next sync (30 s max).',
    appliedExtra: ', {d} already there, {k} already up to date, {x} rejected',
    applyError: 'Could not save ({e}). Nothing was lost: try again.',
    profile: ' (profile “{p}”)',
  },
};
function t(key, vars) {
  var s = (TXT[lang] && TXT[lang][key]) || TXT.fr[key] || key;
  if (vars) s = s.replace(/\{(\w+)\}/g, function (_, k) { return vars[k] === undefined || vars[k] === null ? '' : String(vars[k]); });
  return s;
}

/* ---------- État ---------- */
var state = { token: null, list: null, detected: [], selection: {}, filter: 'all', busy: false, meta: {} };
var el = function (id) { return document.getElementById(id); };

/* ---------- Stockage local ---------- */
function storageGet(keys) { return new Promise(function (res) { chrome.storage.local.get(keys, res); }); }
function storageSet(obj) { return new Promise(function (res) { chrome.storage.local.set(obj, res); }); }
function saveDetected() { return storageSet({ wlDetected: state.detected, wlImportMeta: state.meta }); }

/* ---------- Supabase (jeton) ---------- */
function rpc(name, body) {
  return fetch(SUPA_URL + '/rest/v1/rpc/' + name, {
    method: 'POST', credentials: 'omit',
    headers: { apikey: SUPA_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(function (r) {
    return r.json().catch(function () { return null; }).then(function (data) {
      if (r.status === 404 || (data && data.code === 'PGRST202')) { var e = new Error('rpc_missing'); e.code = 'rpc_missing'; throw e; }
      if (!r.ok) { var e2 = new Error('HTTP ' + r.status); e2.code = 'http'; throw e2; }
      if (data && data.status === 'invalid_token') { var e3 = new Error('invalid_token'); e3.code = 'invalid_token'; throw e3; }
      return data;
    });
  });
}
function loadList() {
  return rpc('extension_list_titles', { p_token: state.token }).then(function (data) {
    if (!data || data.status !== 'ok' || !Array.isArray(data.items)) throw new Error('format');
    state.list = data.items;
    return state.list;
  });
}

/* ---------- Proxy TMDB de cinepisode.com (jeton, quota du compte) ---------- */
function tmdb(path, params) {
  var q = new URLSearchParams(Object.assign({ path: path }, params || {}));
  return fetch(TMDB_PROXY + '?' + q.toString(), { credentials: 'omit', headers: { 'X-Cinepisode-Token': state.token } })
    .then(function (r) {
      if (r.status === 401) { var e = new Error('invalid_token'); e.code = 'invalid_token'; throw e; }
      if (r.status === 429) { var e2 = new Error('quota'); e2.code = 'quota'; throw e2; }
      if (!r.ok) { var e3 = new Error('HTTP ' + r.status); e3.code = 'http'; throw e3; }
      return r.json();
    });
}

/* ---------- Onglet Netflix : relai de requêtes même origine (cookies Netflix de ce navigateur) ---------- */
/* Exécutée DANS l'onglet netflix.com (monde isolé de l'extension) : simple fetch même origine.
 * Refuse toute autre adresse. Le résultat revient uniquement à cette page de l'extension. */
function netflixRelayFetch(url, opts) {
  if (typeof url !== 'string' || url.indexOf('https://www.netflix.com/') !== 0) return Promise.resolve({ status: 0, body: '' });
  opts = opts || {};
  return fetch(url, { method: opts.method === 'POST' ? 'POST' : 'GET', headers: opts.headers || {}, body: opts.method === 'POST' ? opts.body : undefined,
    credentials: 'include', redirect: 'follow' })
    .then(function (r) {
      return r.text().then(function (text) {
        return { status: r.status, body: text.length > 8 * 1024 * 1024 ? '' : text, finalUrl: r.url };
      });
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
function netflixTab() {
  return new Promise(function (resolve, reject) {
    chrome.tabs.query({ url: NETFLIX_ORIGIN + '/*' }, function (tabs) {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      var ready = (tabs || []).filter(function (tb) { return tb.status === 'complete'; });
      if (ready.length) return resolve(ready[0].id);
      if (tabs && tabs.length) return waitTabComplete(tabs[0].id, 30000).then(function () { resolve(tabs[0].id); }, reject);
      progress(t('openingNetflix'), 3);
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

/* ---------- Affichage : progression et messages ---------- */
function progress(text, pct) {
  el('progress').hidden = text === null;
  if (text === null) return;
  el('progressText').textContent = text;
  el('progressBar').style.width = Math.max(2, Math.min(100, pct || 0)) + '%';
}
function message(text, tone) {
  var m = el('message');
  m.hidden = !text;
  m.textContent = text || '';
  m.className = 'message' + (tone ? ' ' + tone : '');
}
function setBusy(b) {
  state.busy = b;
  el('importNetflix').disabled = b || !state.token;
  el('csvFile').disabled = b || !state.token;
  renderBulk();
}
function errorText(e) { return (e && (e.code || e.message)) || '?'; }
function handleCommonError(e) {
  if (e && e.code === 'invalid_token') { message(t('invalidToken'), 'err'); return true; }
  if (e && e.code === 'rpc_missing') { message(t('rpcMissing'), 'err'); return true; }
  return false;
}
function renderLastImport() {
  var d = state.meta.netflixLastAt;
  if (!d) { el('lastImport').textContent = t('neverImported'); return; }
  var f;
  try { f = new Date(d).toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { f = new Date(d).toLocaleString(); }
  el('lastImport').textContent = t('lastImport', { d: f });
}

/* ---------- Liste détectée : état visible ---------- */
function visibleDetected() { return state.detected.filter(function (d) { return !d.dismissed && !d.applied; }); }
function selOf(d) {
  var s = state.selection[d.key];
  if (!s) { s = state.selection[d.key] = { checked: I.defaultChecked(d), candidate: 0, target: null, touched: false }; return s; }
  /* Tant que l'utilisateur n'a pas touché la case, elle suit le défaut (une ligne « en recherche »
   * devient cochée quand sa fiche TMDB sans ambiguïté arrive) */
  if (!s.touched) s.checked = I.defaultChecked(d);
  return s;
}
function selectable(d) {
  var s = selOf(d);
  if (d.list) {
    if (d.list.state === 'update') return d.kind === 'movie' || !!d.progress;
    if (d.list.state === 'ambiguous') return !!s.target && (d.kind === 'movie' || !!d.progress);
    return false;
  }
  if (!d.tmdb || (d.tmdb.state !== 'unambiguous' && d.tmdb.state !== 'ambiguous')) return false;
  return d.kind === 'movie' || !!d.progress;
}
function filterOf(d) { var f = I.detectedFilter(d); return f === 'pending' ? 'new' : f; }
function inFilter(d) {
  var f = filterOf(d);
  if (state.filter === 'all') return f !== 'unchanged';
  return f === state.filter;
}
function checkedList() { return visibleDetected().filter(function (d) { return selOf(d).checked && selectable(d); }); }

function epLabel(p) { return p ? 'S' + p.season + 'E' + p.episode : ''; }
function listProgressLabel(m) {
  if (m.type === 'film') return m.status === 'termine' ? t('finished') : t('toWatch');
  if (m.season === null || m.season === undefined || m.episode === null || m.episode === undefined) return t('toWatch');
  return 'S' + m.season + 'E' + m.episode;
}

/* ---------- Rendu ---------- */
function node(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined && text !== null) n.textContent = text; return n; }
function posterNode(path, kind) {
  if (typeof path === 'string' && POSTER_RE.test(path)) {
    var img = node('img', 'poster');
    img.alt = ''; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer';
    /* Affiche indisponible : on remet le pictogramme */
    img.addEventListener('error', function () { if (img.parentNode) img.parentNode.replaceChild(node('div', 'poster', kind === 'movie' ? '🎬' : '📺'), img); });
    img.src = IMG + path;
    return img;
  }
  return node('div', 'poster', kind === 'movie' ? '🎬' : '📺');
}
function renderFilters() {
  var counts = { all: 0, new: 0, updates: 0, ambiguous: 0, unchanged: 0 };
  visibleDetected().forEach(function (d) { var f = filterOf(d); counts[f] = (counts[f] || 0) + 1; if (f !== 'unchanged') counts.all++; });
  var box = el('filters');
  box.textContent = '';
  [['all', 'fAll'], ['new', 'fNew'], ['updates', 'fUpdates'], ['ambiguous', 'fAmbiguous'], ['unchanged', 'fUnchanged']].forEach(function (f) {
    var b = node('button', 'chip', t(f[1]));
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', state.filter === f[0] ? 'true' : 'false');
    b.appendChild(node('span', 'n', String(counts[f[0]] || 0)));
    b.addEventListener('click', function () { state.filter = f[0]; render(); });
    box.appendChild(b);
  });
}
function renderBulk() {
  var n = checkedList().length;
  var apply = el('apply');
  apply.textContent = t('apply', { n: n });
  apply.disabled = state.busy || n === 0;
  el('ignoreSelected').disabled = state.busy || n === 0;
  var rows = visibleDetected().filter(inFilter).filter(selectable);
  var all = el('selectAll');
  all.disabled = state.busy || rows.length === 0;
  var checkedVisible = rows.filter(function (d) { return selOf(d).checked; }).length;
  all.checked = rows.length > 0 && checkedVisible === rows.length;
  all.indeterminate = checkedVisible > 0 && checkedVisible < rows.length;
}
function rowFor(d) {
  var s = selOf(d);
  var li = node('li', 'row');
  var cb = node('input');
  cb.type = 'checkbox';
  cb.checked = s.checked && selectable(d);
  cb.disabled = state.busy || !selectable(d);
  cb.setAttribute('aria-label', d.title);
  cb.addEventListener('change', function () { s.checked = cb.checked; s.touched = true; renderBulk(); });
  li.appendChild(cb);

  var cand = !d.list && d.tmdb && d.tmdb.candidates[s.candidate || 0];
  var poster = d.list && d.list.matches.length === 1 ? d.list.matches[0].poster : cand ? cand.poster : null;
  li.appendChild(posterNode(poster, d.kind));

  var body = node('div');
  var title = node('div', 'title', d.title);
  if (d.year) title.appendChild(node('span', 'year', d.year));
  body.appendChild(title);

  var sub = node('div', 'sub');
  var f = filterOf(d);
  var badge = f === 'updates' ? ['badgeUpdate', 'update'] : f === 'ambiguous' ? ['badgeAmbiguous', 'ambiguous'] : f === 'unchanged' ? ['badgeUnchanged', '']
    : d.tmdb && d.tmdb.state === 'none' ? ['badgeNone', 'none'] : d.tmdb && d.tmdb.state === 'pending' ? ['badgePending', ''] : ['badgeNew', 'new'];
  sub.appendChild(node('span', 'badge ' + badge[1], t(badge[0])));
  sub.appendChild(node('span', null, t(d.source === 'netflix_csv' ? 'srcCsv' : d.source === 'live' ? 'srcLive' : 'srcNetflix')));
  sub.appendChild(node('span', null, '·'));
  sub.appendChild(node('span', null, d.kind === 'movie' ? t('movieSeen') : d.progress ? t(d.progress.approx ? 'seenApprox' : 'seen', { p: epLabel(d.progress) }) : t('serie')));
  if (d.list && d.list.viaTmdb) sub.appendChild(node('span', 'badge', t('viaTmdb')));
  body.appendChild(sub);

  var change = node('div', 'change');
  if (d.list && d.list.state === 'update') {
    var m = d.list.matches[0];
    var to = d.kind === 'movie' ? t('finished') : epLabel(d.progress);
    change.textContent = t('inList', { from: listProgressLabel(m) + ' → ' + to });
  } else if (d.list && d.list.state === 'unchanged') {
    change.textContent = t('alreadyOk');
  } else if (d.list && d.list.state === 'ambiguous') {
    change.textContent = t('pickList');
    var sel = node('select');
    var ph = node('option', null, t('pickListPlaceholder')); ph.value = ''; sel.appendChild(ph);
    d.list.matches.forEach(function (mm) {
      var o = node('option', null, mm.title + ' — ' + t(mm.type) + ' (' + listProgressLabel(mm) + ')');
      o.value = mm.id; if (s.target === mm.id) o.selected = true; sel.appendChild(o);
    });
    sel.disabled = state.busy;
    sel.addEventListener('change', function () { s.target = sel.value || null; s.checked = !!s.target; s.touched = true; render(); });
    change.appendChild(document.createElement('br'));
    change.appendChild(sel);
  } else if (d.tmdb && d.tmdb.state === 'none') {
    change.textContent = t('noTmdb');
  } else if (d.tmdb && d.tmdb.state === 'pending') {
    change.textContent = '';
  } else if (d.tmdb && cand) {
    if (d.kind !== 'movie' && !d.progress) change.textContent = t('noProgress');
    else change.textContent = t('addAs', { title: cand.title, year: cand.year ? ' (' + cand.year + ')' : '',
      status: d.kind === 'movie' ? t('addStatusFilm') : t('addStatusSerie', { p: epLabel(d.progress) }) });
    if (d.tmdb.state === 'ambiguous' && d.tmdb.candidates.length > 1) {
      var sel2 = node('select');
      d.tmdb.candidates.forEach(function (c, i) {
        var o2 = node('option', null, c.title + (c.year ? ' (' + c.year + ')' : '') + (c.originalTitle && c.originalTitle !== c.title ? ' — ' + c.originalTitle : ''));
        o2.value = String(i); if ((s.candidate || 0) === i) o2.selected = true; sel2.appendChild(o2);
      });
      sel2.disabled = state.busy;
      sel2.setAttribute('aria-label', t('pickTmdb'));
      sel2.addEventListener('change', function () {
        s.candidate = parseInt(sel2.value, 10) || 0;
        /* La fiche choisie est peut-être déjà dans la liste (titre traduit autrement) */
        I.linkByTmdbId(d, state.list || [], s.candidate);
        render();
      });
      change.appendChild(document.createElement('br'));
      change.appendChild(sel2);
    }
  }
  if (d.hiddenNumbers && d.kind !== 'movie' && !d.progress && !(d.tmdb && d.tmdb.state === 'none')) change.textContent = t('noProgress');
  body.appendChild(change);
  li.appendChild(body);

  var ign = node('button', 'ghost ignore', t('ignore'));
  ign.type = 'button';
  ign.disabled = state.busy;
  ign.addEventListener('click', function () { d.dismissed = true; saveDetected(); render(); });
  li.appendChild(ign);
  return li;
}
function render() {
  renderFilters();
  var list = el('list');
  list.textContent = '';
  var vis = visibleDetected();
  var rows = vis.filter(inFilter);
  /* Ordre : à valider d'abord (mises à jour, nouveaux), puis à choisir, puis le reste ; récents en premier */
  var rank = { updates: 0, new: 1, ambiguous: 2, unchanged: 3 };
  rows.sort(function (a, b) {
    return (rank[filterOf(a)] - rank[filterOf(b)]) || ((b.dateMs || 0) - (a.dateMs || 0));
  });
  var frag = document.createDocumentFragment();
  rows.slice(0, 1500).forEach(function (d) { frag.appendChild(rowFor(d)); });
  list.appendChild(frag);
  el('empty').hidden = rows.length > 0;
  el('empty').textContent = vis.length ? t('emptyFilter') : t('empty');
  renderBulk();
}

/* ---------- Recherche TMDB des titres absents de la liste ---------- */
async function lookupPending() {
  var pending = state.detected.filter(function (d) { return !d.dismissed && !d.applied && !d.list && d.tmdb && d.tmdb.state === 'pending'; });
  if (!pending.length) return '';
  var todo = pending.slice(0, I.TMDB_SEARCH_MAX);
  var note = pending.length > todo.length ? t('tmdbLimit', { n: pending.length - todo.length }) : '';
  for (var i = 0; i < todo.length; i++) {
    var d = todo[i];
    progress(t('searchingTmdb', { i: i + 1, n: todo.length }), 100 * (i + 1) / todo.length);
    var titles = [d.title].concat(d.altTitles || []);
    for (var k = 0; k < titles.length; k++) {
      var data = await tmdb(d.kind === 'movie' ? '/search/movie' : '/search/tv', { query: titles[k].slice(0, 200), language: TMDB_LANG, include_adult: 'false' });
      var results = (data && Array.isArray(data.results) ? data.results : []).map(function (r) { return Object.assign({}, r, { media_type: d.kind === 'movie' ? 'movie' : 'tv' }); });
      I.applyTmdbResults(d, results);
      if (d.tmdb.state !== 'none') break;
    }
    I.linkByTmdbId(d, state.list || [], d.tmdb.state === 'unambiguous' ? 0 : -1);
    if (i % 10 === 9) { await saveDetected(); render(); }
  }
  await saveDetected();
  return note;
}
async function lookupSafely() {
  try { return await lookupPending(); }
  catch (e) {
    await saveDetected();
    if (handleCommonError(e)) return null;
    if (e && e.code === 'quota') { message(t('tmdbQuota'), 'warn'); return null; }
    message(t('tmdbError', { e: errorText(e) }), 'warn');
    return null;
  }
}

/* ---------- Intégration de nouvelles fiches ---------- */
function integrate(groups, source) {
  var incoming = [];
  for (var i = 0; i < groups.length; i++) {
    var d = I.detectedFromGroup(groups[i], state.list || [], source);
    if (d.key) incoming.push(d);
  }
  state.detected = I.mergeDetected(state.detected, incoming);
  refreshAll();
  return incoming.length;
}
function refreshAll() {
  state.detected.forEach(function (d) { if (!d.dismissed && !d.applied) I.refreshAgainstList(d, state.list || []); });
}
async function pullLive() {
  var st = await storageGet(['wlLive']);
  var live = Array.isArray(st.wlLive) ? st.wlLive : [];
  if (!live.length) return;
  var incoming = live.map(I.detectedFromLive).filter(Boolean);
  state.detected = I.mergeDetected(state.detected, incoming);
  await storageSet({ wlLive: [] });
}

/* ---------- Import Netflix ---------- */
async function importNetflix() {
  if (state.busy || !state.token) return;
  setBusy(true); message(''); progress(t('preparing'), 1);
  try {
    if (!state.list) await loadList();
    var tabId;
    try { tabId = await netflixTab(); } catch (e) { message(t('netflixTab', { e: errorText(e) }), 'err'); return; }
    progress(t('readingSession'), 5);
    var session = null;
    try { session = await inTab(tabId, netflixReadSession, [], 'MAIN'); } catch (e) { session = null; }
    if (!session || !session.userGuid) {
      var page = await inTab(tabId, netflixRelayFetch, [NETFLIX_ORIGIN + '/browse', { method: 'GET' }]);
      session = page && page.status === 200 ? I.extractNetflixSession(page.body) : null;
    }
    var fetchFn = function (url, opts) { return inTab(tabId, netflixRelayFetch, [url, opts]); };
    var since = typeof state.meta.netflixLastMs === 'number' ? state.meta.netflixLastMs - 3 * 86400000 : null;
    var hist;
    try {
      hist = await I.fetchNetflixHistory(fetchFn, session, { sinceMs: since,
        onProgress: function (p, n) { progress(t('readingHistory', { n: n, p: p }), Math.min(60, 8 + p)); } });
    } catch (e) {
      message(e && (e.code === 'netflix_auth' || e.code === 'netflix_parse') ? t('netflixAuth') : t('netflixError', { e: errorText(e) }), 'err');
      return;
    }
    var shows = hist.items.filter(function (g) { return g.kind === 'show'; });
    var meta = await I.fetchNetflixMetadata(fetchFn, shows, function (i, n) {
      progress(t('readingMeta', { i: i + 1, n: n }), 60 + 30 * (i + 1) / Math.max(1, n));
    });
    var n = integrate(hist.items, 'netflix');
    var maxDate = hist.items.reduce(function (m, g) { return g.dateMs && g.dateMs > m ? g.dateMs : m; }, state.meta.netflixLastMs || 0);
    state.meta.netflixLastMs = maxDate || null;
    state.meta.netflixLastAt = Date.now();
    await saveDetected();
    render(); renderLastImport();
    var note = await lookupSafely();
    var profile = session && session.profileName ? t('profile', { p: session.profileName }) : '';
    if (note !== null) message(t('importDone', { n: n, profile: profile }) + (hist.truncated ? t('importTruncated') : '') + (meta.failed ? t('metaFailed') : '') + (note || ''), 'ok');
  } catch (e) {
    if (!handleCommonError(e)) message(t('listError', { e: errorText(e) }), 'err');
  } finally {
    progress(null); setBusy(false); render();
  }
}

/* ---------- Import du fichier CSV ---------- */
function readFile(file) {
  return new Promise(function (resolve, reject) {
    var r = new FileReader();
    r.onload = function () { resolve(String(r.result || '')); };
    r.onerror = function () { reject(new Error('read')); };
    r.readAsText(file, 'utf-8');
  });
}
async function importCsv(file) {
  if (!file || state.busy || !state.token) return;
  if (file.size > 20 * 1024 * 1024) { message(t('csvTooBig'), 'err'); return; }
  setBusy(true); message(''); progress(t('preparing'), 5);
  try {
    if (!state.list) await loadList();
    var text = await readFile(file);
    var parsed = I.parseNetflixCsv(text);
    if (parsed.error || !parsed.items.length) { message(t('csvError'), 'err'); return; }
    var n = integrate(parsed.items, 'netflix_csv');
    state.meta.csvLastAt = Date.now();
    await saveDetected();
    render();
    var note = await lookupSafely();
    if (note !== null) message(t('csvDone', { n: n }) + (note || ''), 'ok');
  } catch (e) {
    if (!handleCommonError(e)) message(t('csvError'), 'err');
  } finally {
    progress(null); setBusy(false); el('csvFile').value = ''; render();
  }
}

/* ---------- Appliquer (seul moment où la liste Cinepisode est modifiée) ---------- */
async function enrichForInsert(d) {
  var s = selOf(d);
  var c = d.tmdb && d.tmdb.candidates[s.candidate || 0];
  if (!c || c.tmdbType !== 'tv' || !d.progress) return;
  var details = await tmdb('/tv/' + c.tmdbId, { language: 'en-US', append_to_response: 'keywords' });
  d.finished = I.isSeriesFinished(d.progress, details);
  if (I.isAnimeCandidate(c)) {
    var names = (details.genres || []).map(function (g) { return g.name; })
      .concat(((details.keywords && details.keywords.results) || []).map(function (k) { return k.name; }));
    d.animeGenre = I.detectAnimeGenreFromKeywords(names);
  }
}
async function apply() {
  if (state.busy) return;
  var chosen = checkedList();
  if (!chosen.length) return;
  setBusy(true); message(''); progress(t('applying'), 5);
  var counts = { updated: 0, already_up_to_date: 0, inserted: 0, duplicate: 0, invalid: 0, not_found: 0 };
  try {
    var inserts = chosen.filter(function (d) { return !d.list; });
    for (var i = 0; i < inserts.length; i++) {
      progress(t('applying'), 5 + 45 * (i + 1) / inserts.length);
      await enrichForInsert(inserts[i]);
    }
    var selection = {};
    chosen.forEach(function (d) { selection[d.key] = selOf(d); });
    var payload = I.buildApplyPayload(chosen, selection);
    var chunks = I.chunkPayload(payload);
    for (var c = 0; c < chunks.length; c++) {
      progress(t('applying'), 50 + 50 * (c + 1) / chunks.length);
      var res = await rpc('extension_apply_import', { p_token: state.token, p_updates: chunks[c].updates, p_inserts: chunks[c].inserts });
      if (!res || res.status !== 'ok') throw new Error((res && res.status) || 'format');
      var doneIds = {}, doneTmdb = {};
      (res.updates || []).forEach(function (u) { counts[u.result] = (counts[u.result] || 0) + 1; if (u.result === 'updated' || u.result === 'already_up_to_date') doneIds[u.id] = true; });
      (res.inserts || []).forEach(function (x) { counts[x.result] = (counts[x.result] || 0) + 1; if (x.result === 'inserted' || x.result === 'duplicate') doneTmdb[x.tmdb_id] = true; });
      chosen.forEach(function (d) {
        var s = selOf(d);
        var target = d.list ? (d.list.state === 'ambiguous' ? s.target : d.list.matches[0] && d.list.matches[0].id) : null;
        var cand = !d.list && d.tmdb ? d.tmdb.candidates[s.candidate || 0] : null;
        if ((target && doneIds[target]) || (cand && doneTmdb[cand.tmdbId])) { d.applied = true; d.appliedAt = Date.now(); }
      });
    }
    await saveDetected();
    await loadList();
    refreshAll();
    var extra = counts.duplicate || counts.already_up_to_date || counts.invalid || counts.not_found
      ? t('appliedExtra', { d: counts.duplicate, k: counts.already_up_to_date, x: counts.invalid + counts.not_found }) : '';
    message(t('applied', { u: counts.updated, a: counts.inserted, extra: extra }), 'ok');
  } catch (e) {
    await saveDetected();
    if (!handleCommonError(e)) message(t('applyError', { e: errorText(e) }), 'err');
  } finally {
    progress(null); setBusy(false); render();
  }
}

/* ---------- Démarrage ---------- */
function bind() {
  document.documentElement.lang = lang;
  document.title = 'Cinepisode — ' + t('pageTitle');
  document.querySelectorAll('[data-t]').forEach(function (n) { n.textContent = t(n.getAttribute('data-t')); });
  el('importNetflix').addEventListener('click', importNetflix);
  el('csvFile').addEventListener('change', function () { importCsv(el('csvFile').files && el('csvFile').files[0]); });
  el('apply').addEventListener('click', apply);
  el('selectAll').addEventListener('change', function () {
    var on = el('selectAll').checked;
    visibleDetected().filter(inFilter).filter(selectable).forEach(function (d) { var x = selOf(d); x.checked = on; x.touched = true; });
    render();
  });
  el('ignoreSelected').addEventListener('click', function () {
    checkedList().forEach(function (d) { d.dismissed = true; });
    saveDetected(); render();
  });
  /* Détection en direct pendant que la page est ouverte */
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local' || !changes.wlLive || state.busy || !state.list) return;
    var v = changes.wlLive.newValue;
    if (!Array.isArray(v) || !v.length) return;
    pullLive().then(function () { refreshAll(); return lookupSafely(); }).then(function () { saveDetected(); render(); });
  });
}
async function start() {
  bind();
  var st = await storageGet(['wlToken', 'wlDetected', 'wlImportMeta']);
  state.token = typeof st.wlToken === 'string' && st.wlToken.trim() ? st.wlToken.trim() : null;
  state.detected = Array.isArray(st.wlDetected) ? st.wlDetected : [];
  state.meta = st.wlImportMeta && typeof st.wlImportMeta === 'object' ? st.wlImportMeta : {};
  renderLastImport();
  setBusy(false);
  render();
  if (!state.token) { message(t('noToken'), 'err'); return; }
  setBusy(true);
  try {
    await loadList();
    await pullLive();
    refreshAll();
    await saveDetected();
    render();
    await lookupSafely();
  } catch (e) {
    if (!handleCommonError(e)) message(t('listError', { e: errorText(e) }), 'err');
  } finally {
    progress(null); setBusy(false); render();
  }
}
start();
})();
