'use strict';
/*
 * Apple TV — tv.apple.com (enregistré seulement après « Activer Apple TV », extension 0.7.0).
 * Détection en direct uniquement (pas d'historique côté Apple). Non testé sur un compte réel.
 *  - vidéo : [data-testid="video-container"] video (les vidéos promo de l'accueil et des fiches,
 *    hors de ce conteneur, sont ignorées) ;
 *  - titre et repère : [data-testid="player-metadata-title"] / [data-testid="player-metadata-subtitle"]
 *    (« S1, E3 · Titre », « Saison 1, épisode 3 ») ; film si aucun repère et pas de série ;
 *  - exclus : sport (/sporting-event/, /live/), extraits (/clip/), bandes-annonces et bonus
 *    (titre ou sous-titre « Bande-annonce », « Trailer », « Teaser »…), vidéos de moins de 5 min ;
 *  - enchaînement automatique : quand la durée change ou que la lecture repart du début, l'épisode
 *    suivant n'est jamais rattaché à l'épisode précédent ; il est compté une fois son titre lu.
 * Mêmes règles que les autres plateformes (lib/watch-rules.js). Aucune requête réseau, aucune trace.
 */
(function () {
  var W = self.CinepisodeWatch;
  if (!W) return;
  var VIDEO_SEL = '[data-testid="video-container"] video';
  var EXCLUDED_PATH_RE = /\/(?:sporting-event|clip|live|trailer)s?(?:\/|$)/i;
  var EXCLUDED_TEXT_RE = /\b(?:bande[- ]annonce|trailer|teaser|extrait|clip|bonus|making[- ]of|featurette|aperçu|sneak peek)\b/i;
  var MIN_DURATION_S = 300;
  var END_RE = /(skip credits|next episode|passer (?:le )?générique|épisode suivant|regarder la suite)/i;
  var tracker = W.createTracker();
  var current = null; /* {key, durationS, lastMs, meta} */

  function video() {
    var list = document.querySelectorAll(VIDEO_SEL);
    for (var i = 0; i < list.length; i++) {
      var v = list[i];
      if (v.duration > 0 && isFinite(v.duration) && v.duration < 6 * 3600) return v;
    }
    return null;
  }
  function text(sel) {
    var el = document.querySelector(sel);
    return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }
  function readMeta() {
    var title = text('[data-testid="video-player"] [data-testid="player-metadata-title"]') || text('[data-testid="player-metadata-title"]');
    if (!title) return null;
    var sub = text('[data-testid="video-player"] [data-testid="player-metadata-subtitle"]') || text('[data-testid="player-metadata-subtitle"]');
    if (EXCLUDED_TEXT_RE.test(title) || EXCLUDED_TEXT_RE.test(sub)) return { excluded: true };
    var ep = sub ? W.parseEpisodeLabel(sub) : null;
    if (ep) return { kind: 'episode', title: title, season: ep.season, episode: ep.episode };
    var path = location.pathname || '';
    if (/\/(?:episode|show|season)\//i.test(path)) return null; /* page de série sans repère lisible */
    return { kind: 'movie', title: title };
  }
  function endUi() {
    var els = document.querySelectorAll('[data-testid="video-player"] button, [data-testid="video-container"] button');
    for (var j = 0; j < els.length && j < 100; j++) {
      var label = (els[j].getAttribute('aria-label') || '') + ' ' + (els[j].textContent || '');
      if (label.length < 80 && END_RE.test(label)) return true;
    }
    return false;
  }

  function check() {
    if (EXCLUDED_PATH_RE.test(location.pathname || '')) { current = null; return; }
    var v = video();
    if (!v || v.paused) return;
    if (v.duration < MIN_DURATION_S) { current = null; return; } /* promo, extrait */
    var durationS = Math.round(v.duration);
    var curMs = v.currentTime * 1000;
    var meta = readMeta();
    if (meta && meta.excluded) { current = null; return; }
    if (meta) {
      var key = meta.kind + '|' + meta.title + '|' + (meta.season || '') + '|' + (meta.episode || '');
      if (!current || current.key !== key) current = { key: key, durationS: durationS, lastMs: curMs, meta: meta };
      else current.durationS = durationS;
    } else if (!current || Math.abs(current.durationS - durationS) > 2 || curMs < current.lastMs - 60000) {
      current = null; /* épisode suivant lancé tout seul, titre pas encore lisible */
      return;
    }
    current.lastMs = curMs;
    var s = tracker.track(current.key, curMs);
    var prog = W.progress(current.meta.kind, current.meta.title, current.meta.season, current.meta.episode, curMs, v.duration * 1000, s.sent);
    if (prog) chrome.runtime.sendMessage(prog, function () { void chrome.runtime.lastError; });
    if (s.sent || !W.isDone(current.meta.kind, curMs, v.duration * 1000, s, endUi())) return;
    var det = W.detection(current.meta.kind, current.meta.title, current.meta.season, current.meta.episode);
    if (!det) return;
    s.sent = true;
    chrome.runtime.sendMessage(det, function () { void chrome.runtime.lastError; });
  }
  setInterval(check, W.RULES.CHECK_EVERY_MS);
})();
