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
