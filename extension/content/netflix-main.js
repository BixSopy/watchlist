'use strict';
/*
 * Détection du titre/saison/épisode en cours sur Netflix — basée sur des mécanismes
 * vérifiés en conditions réelles (Session 19, scripts de diagnostic retirés depuis, voir l'historique git) :
 *  - netflix.appContext.state.playerApp.getAPI().videoPlayer : session active, avec
 *    getMovieId()/getCurrentTime()/getDuration() confirmés fonctionnels.
 *  - netflix.falcorCache.videos[movieId].summary.value : {type, season, episode, runtime}
 *    confirmé fiable (contrairement à document.title, toujours "Netflix", abandonné —
 *    voir l'historique de ce fichier).
 *  - [data-uia="video-title"] : texte visible du titre. Netflix concatène série+repère
 *    épisode+titre d'épisode sans séparateur (ex. "DAHMERE3Faire un Dahmer") : on isole
 *    le nom de la série en coupant sur "S<saison>E<épisode>" ou "E<épisode>", dont on
 *    connaît déjà les valeurs exactes via falcorCache.
 *
 * MONDE D'EXÉCUTION (important) : ce script tourne dans le "monde MAIN" (déclaré dans
 * manifest.json via "world":"MAIN"), c'est-à-dire directement dans le contexte JS de la
 * page Netflix — seul moyen d'accéder à window.netflix (un content script "isolé"
 * classique a sa propre copie de window et ne le voit jamais, même si le DOM est partagé).
 * Contrepartie : pas d'accès à chrome.runtime ici, donc on relaie via window.postMessage
 * vers content/netflix-bridge.js (lui en monde isolé), qui parle à l'extension. Le message est
 * adressé à l'origine exacte de la page (jamais '*') et n'est relayé que s'il en a la forme exacte.
 * Aucune trace dans la console (le titre regardé n'a pas à y apparaître).
 */

(function () {
function getActive() {
  try {
    var vp = window.netflix.appContext.state.playerApp.getAPI().videoPlayer;
    var sid = vp.getAllPlayerSessionIds()[0];
    if (!sid) return null;
    var player = vp.getVideoPlayerBySessionId(sid);
    var movieId = player.getMovieId();
    var node = window.netflix.falcorCache.videos && window.netflix.falcorCache.videos[movieId];
    var summary = node && node.summary && node.summary.value;
    if (!summary) return null;
    return {
      movieId: movieId,
      type: summary.type, /* 'episode' | 'movie' */
      season: summary.season || null,
      episode: summary.episode || null,
      currentTimeMs: player.getCurrentTime(),
      durationMs: player.getDuration(),
    };
  } catch (e) {
    return null;
  }
}

function getShowTitle(info) {
  var el = document.querySelector('[data-uia="video-title"]');
  var raw = el ? el.textContent.trim() : '';
  if (!raw) return null;
  if (info.type !== 'episode' || !info.season || !info.episode) return raw; /* film : texte brut = titre */
  var markers = ['S' + info.season + 'E' + info.episode, 'E' + info.episode];
  for (var i = 0; i < markers.length; i++) {
    var idx = raw.indexOf(markers[i]);
    if (idx > 0) return raw.slice(0, idx).trim();
  }
  return raw; /* repere non trouve : texte brut envoye tel quel, le matching par titre echouera proprement cote serveur */
}

var lastKey = null;
function toInt(v) {
  var n = typeof v === 'number' ? v : parseInt(v, 10);
  return Number.isInteger(n) && n >= 0 ? n : null;
}
function send(title, season, episode) {
  window.postMessage({ __wl: true, type: 'wl_watched', title: String(title), season: toInt(season), episode: toInt(episode) }, window.location.origin);
}

function check() {
  var info = getActive();
  if (!info) return;
  var title = getShowTitle(info);
  if (!title) return;

  if (info.type === 'episode') {
    var key = title + '|' + info.season + '|' + info.episode;
    if (key === lastKey) return;
    lastKey = key;
    send(title, info.season, info.episode);
  } else if (info.type === 'movie') {
    var pct = info.durationMs ? info.currentTimeMs / info.durationMs : 0;
    if (pct >= 0.9) {
      var mkey = 'film|' + title;
      if (mkey === lastKey) return;
      lastKey = mkey;
      send(title, null, null);
    }
  }
}

setTimeout(check, 3000);
setInterval(check, 5000);
})();
