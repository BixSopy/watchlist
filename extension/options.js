'use strict';
/* Fenêtre de l'extension (0.8.0 : appairage en un clic, jeton manuel en option avancée) : trois états et une vue Réglages.
 *  - viewOff  : pas de jeton (ou changement de jeton) ;
 *  - viewMain : connecté, carte « En ce moment » (au repos ou détection en cours, clé wlNow),
 *               grille des 5 plateformes, import de l'historique, compteur « Détectés » (wlPending) ;
 *  - viewSettings : jeton, fichier CSV, interrupteurs des plateformes, règles, diagnostic, déconnexion.
 * Textes traduits par Chrome (_locales/fr, _locales/en ; anglais par défaut). Aucun innerHTML. */
var msg = function (k) { return chrome.i18n.getMessage(k) || k; };
var msgWith = function (k, value) { return chrome.i18n.getMessage(k, [value]) || k; };
var msgN = function (k, values) { return chrome.i18n.getMessage(k, values) || k; };
var lang = (chrome.i18n.getUILanguage() || 'en').split('-')[0];
var $ = function (id) { return document.getElementById(id); };
var all = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };
document.documentElement.lang = lang;
document.title = msg('optionsTitle');
all('[data-msg]').forEach(function (el) { el.textContent = msg(el.getAttribute('data-msg')); });
all('[data-title-msg]').forEach(function (el) { el.setAttribute('title', msg(el.getAttribute('data-title-msg'))); });
all('[data-aria-msg]').forEach(function (el) { el.setAttribute('aria-label', msg(el.getAttribute('data-aria-msg'))); });
all('[data-ph-msg]').forEach(function (el) { el.setAttribute('placeholder', msg(el.getAttribute('data-ph-msg'))); });

var PLATFORMS = (typeof self !== 'undefined' && self.CinepisodePlatforms) || {};
var NAMES = { netflix: 'Netflix', crunchyroll: 'Crunchyroll', prime: 'Prime Video', disneyplus: 'Disney+', appletv: 'Apple TV' };
var DETECTED_URL = 'https://cinepisode.com/#detectes';
var NOW_STALE_MS = 45 * 1000;      /* plus de nouvelle de la page de lecture depuis 45 s : au repos */
var STALE_MS = 10 * 60 * 1000;     /* import « en cours » sans nouvelle depuis 10 min : service worker arrêté */

/* ---------- Vues ---------- */
var views = { off: $('viewOff'), main: $('viewMain'), settings: $('viewSettings') };
var current = null;
var reduceMotion = false;
try { reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { /* rien */ }
function show(name) {
  Object.keys(views).forEach(function (k) { views[k].hidden = k !== name; views[k].classList.remove('slide-in', 'slide-out', 'recede', 'return'); });
  current = name;
}
/* Réglages : glissent depuis la droite par-dessus la vue principale, qui recule un peu */
function openSettings() {
  if (current !== 'main') return show('settings');
  views.settings.hidden = false;
  views.settings.classList.add('slide-in');
  views.main.classList.add('recede');
  current = 'settings';
  var done = function () { if (current === 'settings') { views.main.hidden = true; views.main.classList.remove('recede'); views.settings.classList.remove('slide-in'); } };
  if (reduceMotion) done(); else setTimeout(done, 290);
}
function closeSettings() {
  if (current !== 'settings') return;
  views.main.hidden = false;
  views.main.classList.add('return');
  views.settings.classList.add('slide-out');
  current = 'main';
  var done = function () { if (current === 'main') { views.settings.hidden = true; views.settings.classList.remove('slide-out'); views.main.classList.remove('return'); } };
  if (reduceMotion) done(); else setTimeout(done, 250);
}

/* ---------- Connexion (jeton) ---------- */
var tokenInput = $('token');
var statusEl = $('status');
var token = '';
var changing = false;
function maskToken(t) { return t ? '•••• ' + t.slice(-4) : ''; }
function applyToken(t) {
  token = t || '';
  $('tokenMask').textContent = maskToken(token);
  if (!token) { changing = false; tokenInput.value = ''; setOffMode(); show('off'); return; }
  if (current === 'off' && !changing) show('main');
  if (current === null) show('main');
}
function setOffMode() {
  $('cancelChange').hidden = !changing;
  $('openApp').hidden = changing;
  $('offFootText').textContent = msg(changing ? 'changeTokenFoot' : 'noAccount');
  /* Changement de jeton : l'ancien reste actif, l'en-tête le dit */
  var dot = views.off.querySelector('.conn .dot'), label = views.off.querySelector('.conn [data-msg]');
  if (dot) dot.className = changing ? 'dot ok' : 'dot off';
  if (label) label.textContent = msg(changing ? 'connected' : 'notConnected');
}
$('save').addEventListener('click', function () {
  var t = tokenInput.value.trim();
  if (!t) { statusEl.textContent = msg('tokenEmpty'); statusEl.className = 'err'; return; }
  /* Nouveau jeton : l'ancien résultat (ex. « Jeton invalide ») ne s'applique plus */
  chrome.storage.local.set({ wlToken: t }, function () {
    chrome.storage.local.remove('wlLast', function () {
      statusEl.textContent = ''; statusEl.className = '';
      changing = false; tokenInput.value = '';
      token = t; $('tokenMask').textContent = maskToken(t);
      renderLast(null);
      show('main');
    });
  });
});
/* Appairage : ouvre cinepisode.com/pair, qui renverra un jeton propre à cet appareil (background.js) */
var PAIR_URL = 'https://cinepisode.com/?pair=1';
$('pairBtn').addEventListener('click', function () {
  var v = (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || '';
  chrome.tabs.create({ url: PAIR_URL + '&ext=' + encodeURIComponent(chrome.runtime.id) + '&v=' + encodeURIComponent(v) });
  window.close();
});
tokenInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') $('save').click(); });
$('changeToken').addEventListener('click', function () { changing = true; $('manualBox').open = true; setOffMode(); statusEl.textContent = ''; statusEl.className = ''; show('off'); });
$('cancelChange').addEventListener('click', function () { changing = false; setOffMode(); show('main'); });
$('openSettings').addEventListener('click', openSettings);
$('closeSettings').addEventListener('click', closeSettings);
document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && current === 'settings' && !document.querySelector('.info.open')) closeSettings(); });

/* Déconnexion : confirmation en place, puis jeton et états locaux effacés */
$('logout').addEventListener('click', function () { $('logout').hidden = true; $('logoutConfirm').hidden = false; });
$('logoutNo').addEventListener('click', function () { $('logout').hidden = false; $('logoutConfirm').hidden = true; });
$('logoutYes').addEventListener('click', function () {
  /* Jeton d'appareil : révoqué côté serveur par background.js ; ancien jeton : simplement oublié */
  chrome.runtime.sendMessage({ type: 'wl_unpair' }, function () {
    void chrome.runtime.lastError;
    chrome.storage.local.remove(['wlToken', 'wlLast', 'wlNow', 'wlPending']);
    $('logout').hidden = false; $('logoutConfirm').hidden = true;
    renderLast(null); renderNow(null); renderPending(null);
    applyToken('');
  });
});
$('version').textContent = 'v' + ((chrome.runtime.getManifest && chrome.runtime.getManifest().version) || '');

/* ---------- Dernière détection (clé wlLast, écrite par background.js) ----------
 * Statut -> [clé du texte, couleur]. Les textes avec $LABEL$ reçoivent « Dark S2E3 » ou le titre du film. */
var lastEl = $('last');
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
var TONE_MARK = { ok: '✓', warn: '!', err: '×' };
/* « Dark S2E3 » pour un épisode, le titre seul pour un film. Titre de la watchlist quand le
 * serveur l'a trouvé (mis à jour / déjà à jour), sinon le titre lu sur la plateforme. */
function lastLabel(last) {
  var useMatched = (last.status === 'updated' || last.status === 'already_up_to_date') && last.matchedTitle;
  var title = String((useMatched ? last.matchedTitle : last.title) || '?');
  if (last.status === 'ambiguous') return title;
  if (last.kind === 'episode' && Number.isInteger(last.season) && Number.isInteger(last.episode)) return title + ' S' + last.season + 'E' + last.episode;
  return title;
}
function lastText(last) {
  var entry = LAST_TEXTS[last.status] || LAST_TEXTS.server_error;
  return { text: msgWith(entry[0], lastLabel(last)), tone: entry[1] };
}
function renderLast(last) {
  var row = $('lastRow'), tone = $('lastTone');
  lastEl.textContent = '';
  if (!last || typeof last !== 'object' || !last.status) {
    lastEl.className = ''; row.className = 'last'; tone.textContent = '•';
    lastEl.textContent = msg('lastNone');
    return;
  }
  var t = lastText(last);
  lastEl.className = t.tone;
  row.className = 'last ' + t.tone;
  tone.textContent = TONE_MARK[t.tone] || '•';
  lastEl.appendChild(document.createTextNode(t.text));
  if (typeof last.at === 'number') {
    var when = document.createElement('span');
    when.className = 'when';
    var date = new Date(last.at), formatted;
    try { formatted = date.toLocaleString(lang, { dateStyle: 'short', timeStyle: 'short' }); } catch (e) { formatted = date.toLocaleString(); }
    when.textContent = msgWith('lastAt', formatted);
    lastEl.appendChild(when);
  }
}

/* ---------- En ce moment (clé wlNow, écrite par background.js pendant la lecture) ---------- */
var nowState = null;
function isLive(now) { return !!now && typeof now === 'object' && typeof now.at === 'number' && Date.now() - now.at < NOW_STALE_MS && typeof now.title === 'string' && now.title; }
function nowSubText(now) {
  if (now.kind === 'episode' && Number.isInteger(now.season) && Number.isInteger(now.episode)) return msgN('nowEpisode', [String(now.season), String(now.episode)]);
  if (now.kind === 'movie') return msg('nowMovie');
  return '';
}
function renderNow(now) {
  nowState = now || null;
  var live = isLive(now);
  $('nowLive').hidden = !live;
  $('nowIdle').hidden = live;
  var plat = live && NAMES[now.platform] ? NAMES[now.platform] : '';
  $('nowPlatform').textContent = plat;
  var chip = null;
  all('.chip.playing').forEach(function (c) { c.classList.remove('playing'); });
  if (!live) return;
  if (now.platform) chip = document.querySelector('[data-chip="' + now.platform + '"]');
  if (chip) chip.classList.add('playing');
  var poster = $('nowPoster');
  poster.setAttribute('data-p', now.platform || '');
  poster.textContent = now.title.slice(0, 18);
  $('nowTitle').textContent = now.title;
  $('nowTitle').setAttribute('title', now.title);
  $('nowSub').textContent = nowSubText(now);
  var pct = Math.max(0, Math.min(100, Math.round(Number(now.pct) || 0)));
  var rule = now.kind === 'movie' ? 90 : 80;
  var done = now.done === true || pct >= rule;
  $('nowBar').style.width = pct + '%';
  $('nowBarBox').className = done ? 'bar done' : 'bar';
  $('nowMark').style.left = rule + '%';
  $('nowPct').textContent = msgWith('nowPct', String(pct));
  var r = $('nowRule');
  r.textContent = done ? msg('nowCounted') : msgWith('nowRule', String(rule));
  r.className = done ? 'ok' : '';
}
/* La page de lecture envoie l'avancement toutes les quelques secondes : sans nouvelle, la carte repasse au repos */
setInterval(function () { if (nowState && !isLive(nowState) && !$('nowLive').hidden) renderNow(nowState); }, 5000);

/* ---------- Compteur « Détectés » (clé wlPending ; remis à zéro à l'ouverture de l'onglet) ---------- */
function renderPending(p) {
  var n = p && typeof p.count === 'number' ? p.count | 0 : 0;
  var el = $('pending');
  el.textContent = '';
  if (n <= 0) { el.textContent = msg('pendingNone'); return; }
  var b = document.createElement('b');
  b.textContent = String(n);
  el.appendChild(b);
  el.appendChild(document.createTextNode(' ' + msg(n === 1 ? 'pendingOne' : 'pendingMany')));
}
$('openDetected').addEventListener('click', function () {
  chrome.storage.local.set({ wlPending: { count: 0, at: Date.now() } });
  chrome.tabs.create({ url: DETECTED_URL });
});

chrome.storage.local.get(['wlToken', 'wlLast', 'wlNow', 'wlPending'], function (res) {
  res = res || {};
  renderLast(res.wlLast);
  renderNow(res.wlNow);
  renderPending(res.wlPending);
  applyToken(res.wlToken);
  /* Jeton d'appareil : encore valide ? (retiré depuis le site => retour à « non relié ») */
  if (/^cpd_/.test(res.wlToken || '')) chrome.runtime.sendMessage({ type: 'wl_check_pair' }, function (r) {
    void chrome.runtime.lastError;
    if (r && r.revoked) { statusEl.textContent = msg('pairedRevoked'); statusEl.className = 'err'; }
  });
});
chrome.storage.onChanged.addListener(function (changes, area) {
  if (area !== 'local') return;
  if (changes.wlLast) renderLast(changes.wlLast.newValue);
  if (changes.wlNow) renderNow(changes.wlNow.newValue);
  if (changes.wlPending) renderPending(changes.wlPending.newValue);
  if (changes.wlImport) renderImport(changes.wlImport.newValue);
  if (changes.wlToken && !changes.wlToken.newValue && token) applyToken('');
  else if (changes.wlToken && changes.wlToken.newValue && changes.wlToken.newValue !== token) { statusEl.textContent = ''; statusEl.className = ''; changing = false; applyToken(changes.wlToken.newValue); show('main'); }
});

/* ---------- Import de l'historique (0.5.0, plateformes en 0.6.0) ----------
 * Le travail est fait par le service worker (background.js) : la fenêtre peut se fermer pendant
 * l'import. Ici : les boutons, l'avancement (clé wlImport) et le diagnostic copiable. */
var importNetflixBtn = $('importNetflix');
var csvInput = $('csvFile');
var csvLabel = $('csvLabel');
var importStatusEl = $('importStatus');
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
/* Texte du diagnostic de l'import : seulement des champs connus et sûrs (aucun jeton, cookie,
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
  try { navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); }); } catch (e) { done(false); }
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
    btn.type = 'button'; btn.className = 'btn sm diag'; btn.textContent = msg('importCopyDiag');
    btn.addEventListener('click', function () { copyDiag(st, btn); });
    importStatusEl.appendChild(btn);
  }
  var busy = isRunning(st);
  importNetflixBtn.disabled = busy;
  all('[data-role="import"]').forEach(function (b) { b.disabled = busy; });
  csvInput.disabled = busy;
  csvLabel.classList.toggle('disabled', busy);
}
function startImport(message) {
  chrome.runtime.sendMessage(message, function (res) {
    if (chrome.runtime.lastError) { renderImport({ state: 'error', error: 'network' }); return; }
    if (res && !res.ok) renderImport({ state: 'error', error: res.reason === 'busy' ? 'busy' : res.reason === 'no_token' ? 'no_token' : res.reason === 'csv' ? 'csv' : 'server_error' });
  });
}
chrome.storage.local.get(['wlImport'], function (res) { renderImport(res && res.wlImport); });
importNetflixBtn.addEventListener('click', function () { startImport({ type: 'wl_import_netflix' }); });
all('[data-role="import"]').forEach(function (b) {
  b.addEventListener('click', function () { startImport({ type: 'wl_import_' + b.getAttribute('data-p') }); });
});
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

/* ---------- Plateformes (0.6.0, Disney+ et Apple TV en 0.7.0) ----------
 * Une puce de la grille (ou l'interrupteur des Réglages) demande la permission facultative du site
 * (chrome.permissions.request, sur le clic) ; le service worker enregistre alors la détection en
 * direct. L'interrupteur la retire. Netflix est toujours active (permission à l'installation). */
var granted = {};
function q(role, name) { return document.querySelector('[data-role="' + role + '"][data-p="' + name + '"]'); }
function setPlatformState(name, ok, note) {
  var was = granted[name];
  granted[name] = ok;
  var chip = q('chip', name), st = q('state', name), tip = q('tip', name), sw = q('switch', name), imp = q('import', name);
  var denied = note === 'denied' && !ok;
  if (chip) {
    chip.classList.toggle('on', ok);
    chip.classList.toggle('off', !ok);
    chip.classList.toggle('denied', denied);
    chip.setAttribute('aria-pressed', String(ok));
    chip.setAttribute('aria-label', NAMES[name] + ' : ' + msg(ok ? 'chipActive' : denied ? 'chipDenied' : 'chipOff'));
    if (ok && was === false) { chip.classList.remove('pop'); void chip.offsetWidth; chip.classList.add('pop'); }
  }
  if (st) {
    st.textContent = msg(ok ? 'chipActive' : denied ? 'chipDenied' : 'chipOff');
    st.setAttribute('title', denied ? msg('platformDenied') : ok ? msg(PLATFORMS[name] && PLATFORMS[name].liveOnly ? 'platformEnabledLive' : 'platformEnabled') : '');
  }
  if (tip) tip.textContent = denied ? msg('platformDenied') : msgWith('chipTip', NAMES[name]);
  if (sw) sw.setAttribute('aria-checked', String(ok));
  if (imp) imp.hidden = !ok; /* absent : détection en direct seulement (Disney+, Apple TV) */
  renderPlatCount();
}
function renderPlatCount() {
  var n = 1 + Object.keys(PLATFORMS).filter(function (k) { return granted[k]; }).length;
  $('platCount').textContent = msgN('platformsCount', [String(n), String(1 + Object.keys(PLATFORMS).length)]);
}
function refreshPlatform(name, note) {
  if (!chrome.permissions || !PLATFORMS[name]) return;
  chrome.permissions.contains({ origins: PLATFORMS[name].origins }, function (ok) { setPlatformState(name, !!ok, note); });
}
function enablePlatform(name) {
  chrome.permissions.request({ origins: PLATFORMS[name].origins }, function (ok) {
    void chrome.runtime.lastError;
    refreshPlatform(name, ok ? null : 'denied');
  });
}
function disablePlatform(name) {
  chrome.permissions.remove({ origins: PLATFORMS[name].origins }, function () { void chrome.runtime.lastError; refreshPlatform(name); });
}
Object.keys(PLATFORMS).forEach(function (name) {
  refreshPlatform(name);
  var chip = q('chip', name), sw = q('switch', name);
  /* Puce : active la plateforme ; déjà active, elle ouvre les Réglages (où on peut la désactiver) */
  if (chip) chip.addEventListener('click', function () { if (granted[name]) openSettings(); else enablePlatform(name); });
  if (sw) sw.addEventListener('click', function () { if (granted[name]) disablePlatform(name); else enablePlatform(name); });
});
var netflixChip = document.querySelector('[data-chip="netflix"]');
if (netflixChip) netflixChip.addEventListener('click', openSettings);
renderPlatCount();
if (chrome.permissions && chrome.permissions.onAdded) {
  chrome.permissions.onAdded.addListener(function () { Object.keys(PLATFORMS).forEach(function (n) { refreshPlatform(n); }); });
  chrome.permissions.onRemoved.addListener(function () { Object.keys(PLATFORMS).forEach(function (n) { refreshPlatform(n); }); });
}

/* ---------- Diagnostic de la détection (0.7.1) : tout reste local ; copié sur clic ---------- */
(function () {
  var cb = $('diagDebug'), sw = $('diagSw'), btn = $('diagCopy'), out = $('diagStatus');
  if (!cb || !btn) return;
  var paint = function () { sw.setAttribute('aria-checked', String(!!cb.checked)); };
  chrome.storage.local.get(['cpDebug'], function (r) { cb.checked = !!(r && r.cpDebug); paint(); });
  cb.addEventListener('change', function () { paint(); chrome.storage.local.set({ cpDebug: cb.checked }); });
  btn.addEventListener('click', async function () {
    var d = { version: chrome.runtime.getManifest().version, ua: navigator.userAgent, at: new Date().toISOString() };
    try { d.registered = (await chrome.scripting.getRegisteredContentScripts()).map(function (c) { return { id: c.id, matches: c.matches, allFrames: !!c.allFrames }; }); } catch (e) { d.registered = 'error: ' + e.message; }
    try { d.origins = (await chrome.permissions.getAll()).origins; } catch (e) { d.origins = 'error'; }
    var st = await chrome.storage.local.get(['cpDiag', 'wlLast', 'wlToken']);
    d.tokenSet = !!st.wlToken; d.lastPage = st.cpDiag || null; d.lastResult = st.wlLast || null;
    var txt = JSON.stringify(d, null, 2);
    try { await navigator.clipboard.writeText(txt); out.className = ''; out.textContent = msg('diagCopied'); } catch (e) { out.className = 'raw'; out.textContent = txt; }
  });
})();

/* Icône « ! » Disney+ / Apple TV : infobulle au survol et au focus, ouverte/fermée au clic (Échap ferme) */
all('[data-role="info"]').forEach(function (b, i) {
  var wrap = b.parentNode, pop = wrap.querySelector('.info-pop');
  pop.id = 'info-pop-' + i;
  b.setAttribute('aria-describedby', pop.id);
  var place = function () {
    if (!wrap.getBoundingClientRect || !document.documentElement || !pop.style) return;
    var W = document.documentElement.clientWidth, w = Math.min(250, W - 16), r = wrap.getBoundingClientRect();
    var left = Math.max(8, Math.min(r.right - w, W - 8 - w));
    pop.style.width = w + 'px'; pop.style.right = 'auto'; pop.style.left = (left - r.left) + 'px';
  };
  ['mouseenter', 'focusin'].forEach(function (ev) { wrap.addEventListener(ev, place); });
  var set = function (o) { if (o) place(); wrap.classList.toggle('open', o); b.setAttribute('aria-expanded', String(o)); };
  b.addEventListener('click', function (e) { e.stopPropagation(); set(!wrap.classList.contains('open')); });
  b.addEventListener('keydown', function (e) { if (e.key === 'Escape') { set(false); e.stopPropagation(); } });
  document.addEventListener('click', function (e) { if (!wrap.contains(e.target)) set(false); });
});
