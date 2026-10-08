'use strict';
/*
 * Règles communes de détection en direct (Crunchyroll, Prime Video ; extension 0.6.0).
 * Mêmes règles que Netflix (content/netflix-main.js) :
 *  - épisode : position >= 80 % de la durée, OU écran de fin (générique, « Épisode suivant »)
 *    affiché alors que la position a dépassé 50 % ;
 *  - film : position >= 90 %, OU écran de fin après 80 % ;
 *  - au moins 20 s de lecture réellement observée sur cette vidéo (un saut dans la barre de
 *    progression ne compte pas ; un épisode suivant lancé puis abandonné n'est jamais marqué) ;
 *  - une seule fois par vidéo et par page.
 * Chargé avant le script de la plateforme dans le même monde isolé ; testable avec node --test.
 */
(function (root) {
  var R = {
    EPISODE_DONE: 0.8, MOVIE_DONE: 0.9, CREDITS_MIN_EPISODE: 0.5, CREDITS_MIN_MOVIE: 0.8,
    MIN_WATCHED_MS: 20000, CHECK_EVERY_MS: 5000,
  };

  /* Etat par vidéo : temps réellement observé, dernier relevé, déjà envoyé ? */
  function createTracker() {
    var videos = {};
    return {
      track: function (key, currentMs, now) {
        var s = videos[key] || (videos[key] = { watchedMs: 0, lastMediaMs: null, lastWallMs: null, sent: false });
        var t = typeof now === 'number' ? now : Date.now();
        if (s.lastMediaMs !== null && typeof currentMs === 'number') {
          var dMedia = currentMs - s.lastMediaMs;
          var dWall = t - s.lastWallMs;
          if (dMedia > 0 && dMedia <= dWall * 2 + 2000) s.watchedMs += dMedia;
        }
        s.lastMediaMs = currentMs;
        s.lastWallMs = t;
        return s;
      },
    };
  }

  function isDone(kind, currentMs, durationMs, s, endUi) {
    if (!durationMs || durationMs <= 0 || !isFinite(durationMs) || typeof currentMs !== 'number') return false;
    if (!s || s.watchedMs < R.MIN_WATCHED_MS) return false;
    var pct = currentMs / durationMs;
    if (kind === 'episode') return pct >= R.EPISODE_DONE || (!!endUi && pct >= R.CREDITS_MIN_EPISODE);
    if (kind === 'movie') return pct >= R.MOVIE_DONE || (!!endUi && pct >= R.CREDITS_MIN_MOVIE);
    return false;
  }

  /* Repère « saison/épisode » affiché par les lecteurs, en anglais et en français :
   * « S2 E5 », « S2:E5 », « S2 É5 », « S2 Ép. 5 », « Season 2, Ep. 5 », « Saison 2, épisode 5 »,
   * « Saison 2 Ép. 5 ». Renvoie {season, episode} ou null. */
  var EP_RES = [
    /\bS\s?(\d{1,4})\s*[:.,-]?\s*(?:E|É|Ep\.?|Ép\.?)\s?(\d{1,5})\b/i,
    /\b(?:Season|Saison|Staffel|Temporada|Stagione)\s+(\d{1,4})\s*[,:.\-–]?\s*(?:Ep\.?|Ép\.?|Episode|Épisode|Folge|Episodio|É|E)\s*(\d{1,5})\b/i,
  ];
  function parseEpisodeLabel(text) {
    if (typeof text !== 'string') return null;
    var t = text.replace(/\s+/g, ' ');
    for (var i = 0; i < EP_RES.length; i++) {
      var m = EP_RES[i].exec(t);
      if (m) return { season: parseInt(m[1], 10), episode: parseInt(m[2], 10) };
    }
    return null;
  }

  /* Message envoyé au service worker : épisode = saison et épisode entiers ; film = vides */
  function detection(kind, title, season, episode) {
    if (kind !== 'episode' && kind !== 'movie') return null;
    if (typeof title !== 'string') return null;
    var t = title.replace(/\s+/g, ' ').trim();
    if (!t || t.length > 300) return null;
    var ok = function (v) { return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100000; };
    if (kind === 'episode') {
      if (!ok(season) || !ok(episode)) return null;
      return { type: 'wl_watched', kind: 'episode', title: t, season: season, episode: episode };
    }
    return { type: 'wl_watched', kind: 'movie', title: t, season: null, episode: null };
  }

  var api = { RULES: R, createTracker: createTracker, isDone: isDone, parseEpisodeLabel: parseEpisodeLabel, detection: detection };
  root.CinepisodeWatch = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
