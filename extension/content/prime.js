'use strict';
/*
 * Prime Video — www.primevideo.com (enregistré seulement après « Activer Prime Video »).
 * Titre et repère « S2 E5 » lus dans le lecteur (textes en anglais et en français : « S2 É5 »,
 * « Saison 2, ép. 5 »…), position de la vidéo, écran de fin (« Épisode suivant », « Passer le
 * générique »). Prime masque ses commandes pendant la lecture : le dernier titre lu reste associé
 * à la vidéo tant que sa durée ne change pas. Pendant une publicité, rien n'est compté.
 * Mêmes règles que Netflix (lib/watch-rules.js). Aucune trace console.
 */
(function () {
  var W = self.CinepisodeWatch;
  if (!W) return;
  var VIDEO_SEL = ['[id^="dv-web-player"] video:not(.tst-video-overlay-player-html5)', '.dv-player-fullscreen video:not(.tst-video-overlay-player-html5)'];
  var END_SEL = ['.atvwebplayersdk-nextupcard-wrapper', '.atvwebplayersdk-nextupcard-button', '[class*="nextupcard"]'];
  var END_RE = /(skip credits|next episode|passer (?:le )?générique|épisode suivant)/i;
  var AD_SEL = '.atvwebplayersdk-ad-timer, .atvwebplayersdk-adtimeindicator-text, [class*="ad-timer"]';
  var VERSION_RE = /\s*\[[\w.]+\/[\w.]+\]$/;
  var SEASON_RE = /\s*[-–:]?\s*(?:Season|Saison|Staffel|Temporada|Stagione)\s+\d+\s*$/i;
  var tracker = W.createTracker();
  var current = null; /* {key, durationS, meta} */

  function video() {
    for (var s = 0; s < VIDEO_SEL.length; s++) {
      var list = document.querySelectorAll(VIDEO_SEL[s]);
      for (var i = 0; i < list.length; i++) {
        var v = list[i];
        if (v.duration > 0 && isFinite(v.duration) && v.duration < 6 * 3600) return v;
      }
    }
    return null;
  }
  function text(root, sel) {
    var el = root.querySelector(sel);
    return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }
  function cleanTitle(t) { return t.replace(VERSION_RE, '').replace(SEASON_RE, '').trim(); }
  function readMeta(v) {
    var root = v.closest('[id^="dv-web-player"]') || document;
    var title = text(root, '.atvwebplayersdk-title-text');
    if (!title) return null;
    var sub = root.querySelector('.atvwebplayersdk-episode-info, .atvwebplayersdk-subtitle-text');
    var ep = sub ? (W.parseEpisodeLabel(sub.getAttribute('aria-label') || '') || W.parseEpisodeLabel(sub.textContent || '')) : null;
    if (ep) return { kind: 'episode', title: cleanTitle(title), season: ep.season, episode: ep.episode };
    if (sub && (sub.textContent || '').trim()) return null; /* sous-titre présent mais illisible : pas un film à coup sûr */
    if (document.querySelector('[id^="av-ep-episode-"]')) return null; /* page d'une série sans repère d'épisode */
    return { kind: 'movie', title: cleanTitle(title) };
  }
  function endUi() {
    for (var i = 0; i < END_SEL.length; i++) if (document.querySelector(END_SEL[i])) return true;
    var els = document.querySelectorAll('[id^="dv-web-player"] button');
    for (var j = 0; j < els.length && j < 100; j++) {
      var label = (els[j].getAttribute('aria-label') || '') + ' ' + (els[j].textContent || '');
      if (label.length < 80 && END_RE.test(label)) return true;
    }
    return false;
  }

  function check() {
    var v = video();
    if (!v || v.paused) return;
    if (document.querySelector(AD_SEL)) return; /* publicité */
    var durationS = Math.round(v.duration);
    var meta = readMeta(v);
    if (meta) {
      var key = meta.kind + '|' + meta.title + '|' + (meta.season || '') + '|' + (meta.episode || '');
      if (!current || current.key !== key) current = { key: key, durationS: durationS, meta: meta };
      else current.durationS = durationS;
    } else if (!current || Math.abs(current.durationS - durationS) > 2) {
      current = null; /* autre vidéo, titre pas encore lisible */
      return;
    }
    var curMs = v.currentTime * 1000;
    var s = tracker.track(current.key, curMs);
    if (s.sent || !W.isDone(current.meta.kind, curMs, v.duration * 1000, s, endUi())) return;
    var det = W.detection(current.meta.kind, current.meta.title, current.meta.season, current.meta.episode);
    if (!det) return;
    s.sent = true;
    chrome.runtime.sendMessage(det, function () { void chrome.runtime.lastError; });
  }
  setInterval(check, W.RULES.CHECK_EVERY_MS);
})();
