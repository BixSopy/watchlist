'use strict';
/* Textes traduits par Chrome (_locales/fr, _locales/en ; anglais par défaut) */
var msg = function (k) { return chrome.i18n.getMessage(k) || k; };
var msgWith = function (k, value) { return chrome.i18n.getMessage(k, [value]) || k; };
var lang = (chrome.i18n.getUILanguage() || 'en').split('-')[0];
document.documentElement.lang = lang;
document.title = msg('optionsTitle');
document.querySelectorAll('[data-msg]').forEach(function (el) { el.textContent = msg(el.getAttribute('data-msg')); });

var tokenInput = document.getElementById('token');
var saveBtn = document.getElementById('save');
var statusEl = document.getElementById('status');
var lastEl = document.getElementById('last');

/* Dernière détection, écrite par background.js dans chrome.storage.local (clé wlLast).
 * Statut -> [clé du texte, couleur]. Les textes avec $LABEL$ reçoivent « Dark S2E3 » ou le titre du film. */
var LAST_TEXTS = {
  updated: ['lastUpdated', 'ok'],
  already_up_to_date: ['lastAlready', 'ok'],
  legacy_updated: ['lastLegacyUpdated', 'ok'],
  not_found: ['lastNotFound', 'warn'],
  ambiguous: ['lastAmbiguous', 'warn'],
  legacy_no_change: ['lastLegacyNoChange', 'warn'],
  invalid_token: ['lastInvalidToken', 'err'],
  no_token: ['lastNoToken', 'err'],
  network: ['lastNetwork', 'err'],
  server_error: ['lastServerError', 'err'],
  invalid_input: ['lastInvalidInput', 'err'],
  invalid_detection: ['lastInvalidDetection', 'err'],
};

/* « Dark S2E3 » pour un épisode, le titre seul pour un film. Titre de la watchlist quand le
 * serveur l'a trouvé (mis à jour / déjà à jour), sinon le titre lu sur Netflix. */
function lastLabel(last) {
  var useMatched = (last.status === 'updated' || last.status === 'already_up_to_date') && last.matchedTitle;
  var title = String((useMatched ? last.matchedTitle : last.title) || '?');
  if (last.status === 'ambiguous') return title; /* « Plusieurs titres correspondent à « Lupin » » */
  if (last.kind === 'episode' && Number.isInteger(last.season) && Number.isInteger(last.episode)) {
    return title + ' S' + last.season + 'E' + last.episode;
  }
  return title;
}

function lastText(last) {
  var entry = LAST_TEXTS[last.status] || LAST_TEXTS.server_error;
  return { text: msgWith(entry[0], lastLabel(last)), tone: entry[1] };
}

function renderLast(last) {
  lastEl.textContent = '';
  if (!last || typeof last !== 'object' || !last.status) {
    lastEl.className = '';
    lastEl.textContent = msg('lastNone');
    return;
  }
  var t = lastText(last);
  lastEl.className = t.tone;
  lastEl.appendChild(document.createTextNode(t.text));
  if (typeof last.at === 'number') {
    var when = document.createElement('span');
    when.className = 'when';
    var date = new Date(last.at);
    var formatted;
    try { formatted = date.toLocaleString(lang, { dateStyle: 'short', timeStyle: 'short' }); } catch (e) { formatted = date.toLocaleString(); }
    when.textContent = msgWith('lastAt', formatted);
    lastEl.appendChild(when);
  }
}

chrome.storage.local.get(['wlToken', 'wlLast'], function (res) {
  if (res.wlToken) tokenInput.value = res.wlToken;
  renderLast(res.wlLast);
});

/* Mise à jour en direct si une détection arrive pendant que la fenêtre est ouverte */
chrome.storage.onChanged.addListener(function (changes, area) {
  if (area === 'local' && changes.wlLast) renderLast(changes.wlLast.newValue);
});

saveBtn.addEventListener('click', function () {
  var token = tokenInput.value.trim();
  if (!token) {
    statusEl.textContent = msg('tokenEmpty');
    statusEl.className = 'err';
    return;
  }
  /* Nouveau jeton : l'ancien résultat (ex. « Jeton invalide ») ne s'applique plus */
  chrome.storage.local.set({ wlToken: token }, function () {
    chrome.storage.local.remove('wlLast', function () {
      statusEl.textContent = msg('saved');
      statusEl.className = 'ok';
      renderLast(null);
    });
  });
});

/* ---------- Import de l'historique (0.5.0) ----------
 * Le travail est fait par le service worker (background.js) : la fenêtre peut se fermer pendant
 * l'import. Ici : deux boutons, l'avancement (clé wlImport) et un lien vers l'onglet « Détectés ». */
var DETECTED_URL = 'https://cinepisode.com/#detectes';
var importNetflixBtn = document.getElementById('importNetflix');
var csvInput = document.getElementById('csvFile');
var csvLabel = document.getElementById('csvLabel');
var importStatusEl = document.getElementById('importStatus');
var openDetectedBtn = document.getElementById('openDetected');
var msgN = function (k, values) { return chrome.i18n.getMessage(k, values) || k; };
var STALE_MS = 10 * 60 * 1000; /* « en cours » sans nouvelle depuis 10 min : service worker arrêté */
var IMPORT_ERRORS = { no_token: 'importErrNoToken', invalid_token: 'importErrToken', netflix_tab: 'importErrNetflixTab',
  netflix_auth: 'importErrNetflixAuth', netflix_http: 'importErrNetflix', csv: 'importErrCsv', limit: 'importErrLimit',
  server_error: 'importErrServer', network: 'importErrNetwork', busy: 'importBusy' };

function isRunning(st) { return !!st && st.state === 'running' && typeof st.at === 'number' && Date.now() - st.at < STALE_MS; }
function importStatusText(st) {
  if (!st || !st.state) return { text: '', tone: '' };
  if (st.state === 'error') return { text: msg(IMPORT_ERRORS[st.error] || 'importErrServer'), tone: 'err' };
  if (st.state === 'done') {
    var s = st.sent || {};
    if (!st.titles || (s.inserted | 0) + (s.updated | 0) === 0) return { text: msg('importNothing'), tone: 'ok' };
    var text = msgN('importDone', [String(st.titles), String(s.inserted | 0), String(s.updated | 0)]);
    if (st.truncated) text += msg('importTruncated');
    if (st.metaFailed) text += msg('importMetaFailed');
    return { text: text, tone: 'ok' };
  }
  if (!isRunning(st)) return { text: '', tone: '' };
  if (st.step === 'tab') return { text: msg('importStepTab'), tone: '', pct: 3 };
  if (st.step === 'session') return { text: msg('importStepSession'), tone: '', pct: 6 };
  if (st.step === 'history') return { text: msgN('importStepHistory', [String(st.items | 0), String(st.pages | 0)]), tone: '', pct: Math.min(55, 8 + (st.pages | 0)) };
  if (st.step === 'meta') return { text: msgN('importStepMeta', [String(st.done | 0), String(st.total | 0)]), tone: '', pct: 55 + 35 * (st.done | 0) / Math.max(1, st.total | 0) };
  if (st.step === 'parse') return { text: msg('importStepParse'), tone: '', pct: 20 };
  return { text: msg('importStepPush'), tone: '', pct: 92 };
}
function renderImport(st) {
  var t = importStatusText(st);
  importStatusEl.textContent = t.text;
  importStatusEl.className = t.tone;
  if (t.pct !== undefined) {
    var bar = document.createElement('div'); bar.className = 'bar';
    var fill = document.createElement('span'); fill.style.width = Math.max(2, Math.min(100, t.pct)) + '%';
    bar.appendChild(fill); importStatusEl.appendChild(bar);
  }
  var busy = isRunning(st);
  importNetflixBtn.disabled = busy;
  csvInput.disabled = busy;
  csvLabel.classList.toggle('disabled', busy);
}
function startImport(message) {
  chrome.runtime.sendMessage(message, function (res) {
    if (chrome.runtime.lastError) { renderImport({ state: 'error', error: 'network' }); return; }
    if (res && !res.ok) renderImport({ state: 'error', error: res.reason === 'busy' ? 'busy' : res.reason === 'no_token' ? 'no_token' : res.reason === 'csv' ? 'csv' : 'server_error' });
  });
}
chrome.storage.local.get(['wlImport'], function (res) { renderImport(res.wlImport); });
chrome.storage.onChanged.addListener(function (changes, area) {
  if (area === 'local' && changes.wlImport) renderImport(changes.wlImport.newValue);
});
importNetflixBtn.addEventListener('click', function () { startImport({ type: 'wl_import_netflix' }); });
/* Dans la petite fenêtre de l'extension, le sélecteur de fichier peut la fermer : on ouvre alors
 * la même page dans un onglet, où le fichier peut être choisi. */
csvLabel.addEventListener('click', function (e) {
  if (!chrome.tabs || !chrome.tabs.getCurrent) return;
  e.preventDefault();
  chrome.tabs.getCurrent(function (tab) {
    if (tab) { csvInput.click(); return; }
    chrome.runtime.openOptionsPage(function () { window.close(); });
  });
});
csvInput.addEventListener('change', function () {
  var file = csvInput.files && csvInput.files[0];
  if (!file) return;
  if (file.size > 20 * 1024 * 1024) { renderImport({ state: 'error', error: 'csv' }); csvInput.value = ''; return; }
  var reader = new FileReader();
  reader.onload = function () { csvInput.value = ''; startImport({ type: 'wl_import_csv', text: String(reader.result || '') }); };
  reader.onerror = function () { csvInput.value = ''; renderImport({ state: 'error', error: 'csv' }); };
  reader.readAsText(file, 'utf-8');
});
openDetectedBtn.addEventListener('click', function () { chrome.tabs.create({ url: DETECTED_URL }); });
