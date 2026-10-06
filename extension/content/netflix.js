'use strict';
/*
 * Détection du titre/saison/épisode en cours sur Netflix — basée sur des mécanismes
 * vérifiés en conditions réelles (Session 19, voir extension/content/diagnostic*.js) :
 *  - netflix.appContext.state.playerApp.getAPI().videoPlayer : session active, avec
 *    getMovieId()/getCurrentTime()/getDuration() confirmés fonctionnels.
 *  - netflix.falcorCache.videos[movieId].summary.value : {type, season, episode, runtime}
 *    confirmé fiable (contrairement à document.title, toujours "Netflix", abandonné —
 *    voir l'historique de ce fichier).
 *  - [data-uia="video-title"] : texte visible du titre. Netflix concatène série+repère
 *    épisode+titre d'épisode sans séparateur (ex. "DAHMERE3Faire un Dahmer") : on isole
 *    le nom de la série en coupant sur "S<saison>E<épisode>" ou "E<épisode>", dont on
 *    connaît déjà les valeurs exactes via falcorCache.
 */

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
    console.log('[WL] getActive() echec :', e.message);
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
function send(title, season, episode) {
  chrome.runtime.sendMessage(
    { type: 'wl_watched', title: title, season: season, episode: episode },
    function (res) { console.log('[WL] reponse background :', res); }
  );
}

function check() {
  var info = getActive();
  if (!info) { console.log('[WL] aucune lecture active detectee'); return; }
  var title = getShowTitle(info);
  if (!title) { console.log('[WL] titre introuvable ([data-uia="video-title"] absent)'); return; }

  if (info.type === 'episode') {
    console.log('[WL] detecte :', title, 'S' + info.season + 'E' + info.episode);
    var key = title + '|' + info.season + '|' + info.episode;
    if (key === lastKey) return;
    lastKey = key;
    send(title, info.season, info.episode);
  } else if (info.type === 'movie') {
    var pct = info.durationMs ? info.currentTimeMs / info.durationMs : 0;
    console.log('[WL] film detecte :', title, Math.round(pct * 100) + '%');
    if (pct >= 0.9) {
      var mkey = 'film|' + title;
      if (mkey === lastKey) return;
      lastKey = mkey;
      send(title, null, null);
    }
  } else {
    console.log('[WL] type video non gere :', info.type);
  }
}

setTimeout(check, 3000);
setInterval(check, 20000);
