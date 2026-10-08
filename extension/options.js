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
  server_error: 'importErrServer', network: 'importErrNetwork', busy: 'importBusy',
  permission: 'importErrPermission', crunchyroll_auth: 'importErrCrunchyrollAuth', crunchyroll_http: 'importErrCrunchyroll',
  crunchyroll_blocked: 'importErrCrunchyrollBlocked', crunchyroll_rate: 'importErrCrunchyrollRate', crunchyroll_tab: 'importErrCrunchyrollTab',
  prime_auth: 'importErrPrimeAuth', prime_http: 'importErrPrime' };
var PLATFORM_SOURCES = ['crunchyroll', 'prime'];

var STEP_NAMES = { tab: 'importStepNameTab', token: 'importStepNameToken', account: 'importStepNameAccount', history: 'importStepNameHistory', push: 'importStepNamePush' };
/* « Étape jeton : HTTP 401 » (étape et statut de l'échec, s'ils sont connus) */
function importErrDetail(st) {
  if (!st || st.state !== 'error' || !st.errStep || !STEP_NAMES[st.errStep]) return '';
  var status = typeof st.errStatus === 'number' && st.errStatus > 0 ? msgN('importErrHttp', [String(st.errStatus)])
    : st.errStatus === 0 ? msg('importErrNoResponse')
    : st.diag && st.diag.parse ? msg('importErrBadAnswer') : '';
  if (!status) return msgN('importErrStep', [msg(STEP_NAMES[st.errStep]), '?']).replace(/\s*:\s*\?$/, '');
  return msgN('importErrStep', [msg(STEP_NAMES[st.errStep]), status]);
}
/* Texte du diagnostic copiable : seulement des champs connus et sûrs (aucun jeton, cookie,
 * identifiant de compte ou d'appareil ; le service worker n'en met jamais dans diag). */
var DIAG_FIELDS = ['v', 'platform', 'via', 'step', 'status', 'code', 'cloudflare', 'api', 'page', 'partial', 'parse', 'net', 'tabOpened', 'siteDeviceId', 'browser', 'at'];
function diagText(st) {
  var d = (st && st.diag) || {};
  var lines = ['Cinepisode – diagnostic import'];
  DIAG_FIELDS.forEach(function (k) {
    var v = d[k];
    if (v === undefined || v === null || v === '') return;
    if (typeof v === 'string') v = v.replace(/[^\w .:\/+-]/g, '').slice(0, 60);
    else if (typeof v !== 'number' && typeof v !== 'boolean') return;
    lines.push(k + ': ' + v);
  });
  if (st && st.state === 'error' && st.error) lines.push('error: ' + String(st.error).replace(/[^\w-]/g, '').slice(0, 40));
  return lines.join('\n');
}
function copyDiag(st, btn) {
  var text = diagText(st);
  var done = function (ok) { btn.textContent = msg(ok ? 'importDiagCopied' : 'importDiagCopyFailed'); };
  try {
    navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
  } catch (e) { done(false); }
}
function isRunning(st) { return !!st && st.state === 'running' && typeof st.at === 'number' && Date.now() - st.at < STALE_MS; }
function importStatusText(st) {
  if (!st || !st.state) return { text: '', tone: '' };
  if (st.state === 'error') {
    var detail = importErrDetail(st);
    return { text: msg(IMPORT_ERRORS[st.error] || 'importErrServer') + (detail ? ' ' + detail + '.' : ''), tone: 'err', diag: !!st.diag };
  }
  if (st.state === 'done') {
    var s = st.sent || {};
    /* 0.6.2 : lecture interrompue après la première page -> le début est envoyé, la note le dit */
    var partialNote = st.partial ? msg('importPartial') : '';
    var withDiag = !!(st.partial && st.diag);
    if (!st.titles || (s.inserted | 0) + (s.updated | 0) === 0) return { text: msg('importNothing') + partialNote, tone: 'ok', diag: withDiag };
    var text = msgN('importDone', [String(st.titles), String(s.inserted | 0), String(s.updated | 0)]);
    if (st.truncated) text += msg(PLATFORM_SOURCES.indexOf(st.source) >= 0 ? 'importTruncatedOther' : 'importTruncated');
    if (st.metaFailed) text += msg('importMetaFailed');
    return { text: text + partialNote, tone: 'ok', diag: withDiag };
  }
  if (!isRunning(st)) return { text: '', tone: '' };
  if (st.step === 'tab') return { text: msg(st.source === 'crunchyroll' ? 'importStepCrunchyrollTab' : 'importStepTab'), tone: '', pct: 3 };
  if (st.step === 'session') return { text: msg(st.source === 'crunchyroll' ? 'importStepCrunchyroll' : st.source === 'prime' ? 'importStepPrime' : 'importStepSession'), tone: '', pct: 6 };
  if (st.step === 'history') return { text: msgN('importStepHistory', [String(st.items | 0), String(st.pages | 0)]), tone: '', pct: Math.min(55, 8 + (st.pages | 0)) };
  if (st.step === 'meta') return { text: msgN(st.source === 'prime' ? 'importStepPrimeMeta' : 'importStepMeta', [String(st.done | 0), String(st.total | 0)]), tone: '', pct: 55 + 35 * (st.done | 0) / Math.max(1, st.total | 0) };
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
  if (t.diag) {
    var btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'secondary diag'; btn.textContent = msg('importCopyDiag');
    btn.addEventListener('click', function () { copyDiag(st, btn); });
    importStatusEl.appendChild(btn);
  }
  var busy = isRunning(st);
  importNetflixBtn.disabled = busy;
  document.querySelectorAll('.platform [data-role="import"]').forEach(function (b) { b.disabled = busy; });
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
/* ---------- Crunchyroll et Prime Video (0.6.0) ----------
 * « Activer » demande la permission facultative du site (chrome.permissions.request, sur le clic) ;
 * le service worker enregistre alors la détection en direct. « Désactiver » la retire. */
var PLATFORMS = (typeof self !== 'undefined' && self.CinepisodePlatforms) || {};
function platformBox(name) { return document.querySelector('.platform[data-platform="' + name + '"]'); }
function setPlatformState(name, granted, note) {
  var box = platformBox(name);
  if (!box) return;
  box.querySelector('[data-role="enable"]').hidden = granted;
  box.querySelector('[data-role="import"]').hidden = !granted;
  box.querySelector('[data-role="disable"]').hidden = !granted;
  var state = box.querySelector('[data-role="state"]');
  state.textContent = note === 'denied' ? msg('platformDenied') : granted ? msg('platformEnabled') : '';
  state.className = note === 'denied' ? 'state err' : 'state';
}
function refreshPlatform(name, note) {
  if (!chrome.permissions || !PLATFORMS[name]) return;
  chrome.permissions.contains({ origins: PLATFORMS[name].origins }, function (ok) { setPlatformState(name, !!ok, note); });
}
Object.keys(PLATFORMS).forEach(function (name) {
  var box = platformBox(name);
  if (!box) return;
  refreshPlatform(name);
  box.querySelector('[data-role="enable"]').addEventListener('click', function () {
    chrome.permissions.request({ origins: PLATFORMS[name].origins }, function (granted) {
      void chrome.runtime.lastError;
      refreshPlatform(name, granted ? null : 'denied');
    });
  });
  box.querySelector('[data-role="disable"]').addEventListener('click', function () {
    chrome.permissions.remove({ origins: PLATFORMS[name].origins }, function () { void chrome.runtime.lastError; refreshPlatform(name); });
  });
  box.querySelector('[data-role="import"]').addEventListener('click', function () { startImport({ type: 'wl_import_' + name }); });
});
if (chrome.permissions && chrome.permissions.onAdded) {
  chrome.permissions.onAdded.addListener(function () { Object.keys(PLATFORMS).forEach(function (n) { refreshPlatform(n); }); });
  chrome.permissions.onRemoved.addListener(function () { Object.keys(PLATFORMS).forEach(function (n) { refreshPlatform(n); }); });
}

openDetectedBtn.addEventListener('click', function () { chrome.tabs.create({ url: DETECTED_URL }); });
