'use strict';
/* Monde isolé (par défaut) : reçoit les détections de netflix-main.js (monde MAIN, seul endroit
 * avec accès à window.netflix) via postMessage, et les relaie au service worker avec
 * chrome.runtime — API indisponible depuis le monde MAIN.
 *
 * Contrôles stricts : le message doit venir de cette même fenêtre (event.source), de l'origine
 * Netflix attendue (event.origin), et avoir exactement la forme prévue. Tout le reste est ignoré
 * (iframes, autres onglets, messages d'autres scripts). Les scripts de la page Netflix partagent
 * le monde MAIN et peuvent donc toujours imiter un message : le service worker revalide tout et la
 * fonction Supabase est bornée à la watchlist du propriétaire du jeton. */
var WL_ALLOWED_ORIGINS = ['https://www.netflix.com'];

/* Forme attendue : épisode = saison et épisode entiers ; film = saison et épisode vides */
function wlValidDetection(d) {
  if (!d || typeof d !== 'object' || d.__wl !== true || d.type !== 'wl_watched') return null;
  if (d.kind !== 'episode' && d.kind !== 'movie') return null;
  if (typeof d.title !== 'string') return null;
  var title = d.title.trim();
  if (!title || title.length > 300) return null;
  function num(v) {
    return (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100000) ? v : undefined;
  }
  if (d.kind === 'episode') {
    var season = num(d.season), episode = num(d.episode);
    if (season === undefined || episode === undefined) return null;
    return { kind: 'episode', title: title, season: season, episode: episode };
  }
  if (d.season !== null || d.episode !== null) return null;
  return { kind: 'movie', title: title, season: null, episode: null };
}

window.addEventListener('message', function (ev) {
  if (ev.source !== window) return;
  if (ev.origin !== window.location.origin || WL_ALLOWED_ORIGINS.indexOf(ev.origin) < 0) return;
  var det = wlValidDetection(ev.data);
  if (!det) return;
  chrome.runtime.sendMessage({ type: 'wl_watched', kind: det.kind, title: det.title, season: det.season, episode: det.episode }, function () {
    void chrome.runtime.lastError; /* pas de réponse (service worker relancé) : rien à faire */
  });
});
