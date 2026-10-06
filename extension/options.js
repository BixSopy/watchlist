'use strict';
var tokenInput = document.getElementById('token');
var saveBtn = document.getElementById('save');
var statusEl = document.getElementById('status');

chrome.storage.local.get(['wlToken'], function (res) {
  if (res.wlToken) tokenInput.value = res.wlToken;
});

saveBtn.addEventListener('click', function () {
  var token = tokenInput.value.trim();
  if (!token) {
    statusEl.textContent = 'Jeton vide.';
    statusEl.className = 'err';
    return;
  }
  chrome.storage.local.set({ wlToken: token }, function () {
    statusEl.textContent = 'Enregistré.';
    statusEl.className = 'ok';
  });
});
