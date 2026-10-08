'use strict';
/* Textes traduits par Chrome (_locales/fr, _locales/en ; anglais par défaut) */
var msg = function (k) { return chrome.i18n.getMessage(k) || k; };
document.documentElement.lang = (chrome.i18n.getUILanguage() || 'en').split('-')[0];
document.title = msg('optionsTitle');
document.querySelectorAll('[data-msg]').forEach(function (el) { el.textContent = msg(el.getAttribute('data-msg')); });

var tokenInput = document.getElementById('token');
var saveBtn = document.getElementById('save');
var statusEl = document.getElementById('status');

chrome.storage.local.get(['wlToken'], function (res) {
  if (res.wlToken) tokenInput.value = res.wlToken;
});

saveBtn.addEventListener('click', function () {
  var token = tokenInput.value.trim();
  if (!token) {
    statusEl.textContent = msg('tokenEmpty');
    statusEl.className = 'err';
    return;
  }
  chrome.storage.local.set({ wlToken: token }, function () {
    statusEl.textContent = msg('saved');
    statusEl.className = 'ok';
  });
});
