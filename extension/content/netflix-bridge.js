'use strict';
/* Monde isolé (par défaut) : reçoit les détections de netflix-main.js (monde MAIN,
 * seul endroit avec accès à window.netflix) via postMessage, et relaie vers le
 * service worker avec chrome.runtime — API indisponible depuis le monde MAIN. */
window.addEventListener('message', function (ev) {
  if (ev.source !== window || !ev.data || ev.data.__wl !== true) return;
  console.log('[WL] relai vers le background :', ev.data);
  chrome.runtime.sendMessage(
    { type: 'wl_watched', title: ev.data.title, season: ev.data.season, episode: ev.data.episode },
    function (res) { console.log('[WL] reponse background :', res); }
  );
});
