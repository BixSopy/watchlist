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
 * QUAND UN TITRE EST MARQUÉ VU (version 0.4.0) — jamais au simple lancement :
 *  - épisode : position >= 80 % de la durée, OU générique de fin / bouton « Épisode suivant »
 *    affiché par Netflix alors que la position a dépassé 50 % (le générique ne peut pas être
 *    dans la première moitié : évite de marquer l'épisode suivant pendant la transition) ;
 *  - film : position >= 90 %, OU générique de fin affiché après 80 % ;
 *  - dans tous les cas, au moins 20 s de lecture réellement observée sur CETTE vidéo (temps de
 *    lecture qui avance normalement entre deux vérifications ; un saut dans la barre de
 *    progression ne compte pas). Un épisode suivant lancé automatiquement puis abandonné après
 *    quelques secondes n'est donc jamais marqué : il démarre à 0 %.
 *  - une seule fois par vidéo et par page.
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
var EPISODE_DONE = 0.8;          /* épisode : 80 % */
var MOVIE_DONE = 0.9;            /* film : 90 % */
var CREDITS_MIN_EPISODE = 0.5;   /* générique de fin d'épisode : seulement après 50 % */
var CREDITS_MIN_MOVIE = 0.8;     /* générique de fin de film : seulement après 80 % */
var MIN_WATCHED_MS = 20000;      /* lecture réellement observée sur la vidéo */
var CHECK_EVERY_MS = 5000;

/* Interface de fin de vidéo affichée par Netflix : bouton « Épisode suivant » (avec ou sans
 * compte à rebours), « Regarder le générique », écran post-lecture. Plusieurs sélecteurs, car
 * Netflix les renomme parfois ; aucun n'est indispensable (le seuil de 80 % suffit seul). */
var END_UI_SELECTORS = [
  '[data-uia^="next-episode-seamless-button"]',
  '[data-uia="watch-credits-seamless-button"]',
  '[data-uia^="postplay"]',
  '[data-uia="player-postplay"]',
  '.watch-video--postplay',
];

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
  return raw; /* repère non trouvé : texte brut envoyé tel quel, le serveur répondra « pas dans ta liste » */
}

function endUiShown() {
  for (var i = 0; i < END_UI_SELECTORS.length; i++) {
    try { if (document.querySelector(END_UI_SELECTORS[i])) return true; } catch (e) { /* sélecteur refusé : ignoré */ }
  }
  return false;
}

/* Etat par vidéo : temps de lecture réellement observé, dernier relevé, déjà envoyé ? */
var videos = {};
function track(info) {
  var key = String(info.movieId);
  var s = videos[key] || (videos[key] = { watchedMs: 0, lastMediaMs: null, lastWallMs: null, sent: false });
  var now = Date.now();
  if (s.lastMediaMs !== null && typeof info.currentTimeMs === 'number') {
    var dMedia = info.currentTimeMs - s.lastMediaMs;
    var dWall = now - s.lastWallMs;
    /* Lecture normale (jusqu'à x2, onglet en arrière-plan ralenti compris) ; un saut dans la
     * barre de progression avance bien plus vite que l'horloge et n'est pas compté. */
    if (dMedia > 0 && dMedia <= dWall * 2 + 2000) s.watchedMs += dMedia;
  }
  s.lastMediaMs = info.currentTimeMs;
  s.lastWallMs = now;
  return s;
}

function isDone(info, s, endUi) {
  if (!info.durationMs || info.durationMs <= 0 || typeof info.currentTimeMs !== 'number') return false;
  if (s.watchedMs < MIN_WATCHED_MS) return false;
  var pct = info.currentTimeMs / info.durationMs;
  if (info.type === 'episode') return pct >= EPISODE_DONE || (endUi && pct >= CREDITS_MIN_EPISODE);
  if (info.type === 'movie') return pct >= MOVIE_DONE || (endUi && pct >= CREDITS_MIN_MOVIE);
  return false;
}

function toInt(v) {
  var n = typeof v === 'number' ? v : parseInt(v, 10);
  return Number.isInteger(n) && n >= 0 ? n : null;
}
function send(kind, title, season, episode) {
  window.postMessage({ __wl: true, type: 'wl_watched', kind: kind, title: String(title),
    season: kind === 'episode' ? toInt(season) : null, episode: kind === 'episode' ? toInt(episode) : null }, window.location.origin);
}

function check() {
  var info = getActive();
  if (!info || (info.type !== 'episode' && info.type !== 'movie')) return;
  if (info.type === 'episode' && (toInt(info.season) === null || toInt(info.episode) === null)) return;
  var s = track(info);
  if (s.sent || !isDone(info, s, endUiShown())) return;
  var title = getShowTitle(info);
  if (!title) return;
  s.sent = true;
  send(info.type, title, info.season, info.episode);
}

setTimeout(check, 3000);
setInterval(check, CHECK_EVERY_MS);
})();
