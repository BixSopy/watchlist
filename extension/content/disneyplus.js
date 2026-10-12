'use strict';
/*
 * Disney+ — www.disneyplus.com (enregistré seulement après « Activer Disney+ », extension 0.7.0).
 * Détection en direct uniquement (Disney+ n'a pas de page d'historique).
 *  - page de lecture : /play/<id> ou /<langue>/play/<id> ;
 *  - titre : .title-field ; repère d'épisode : .subtitle-field, en français ou en anglais
 *    (« S1: ép. 6 Titre », « S1: Ep. 6 Title ») ; sans sous-titre : film ;
 *  - progression : barre de progression du lecteur, web component <progress-bar> à shadow DOM
 *    ouvert (div.progress-bar__thumb, aria-valuenow / aria-valuemax), sinon la balise <video> ;
 *  - écran de fin : bouton « Épisode suivant » / « Passer le générique ».
 * Mêmes règles que les autres plateformes (lib/watch-rules.js). Aucune requête réseau, aucune trace.
 */
(function () {
  var W = self.CinepisodeWatch;
  if (!W) return;
  var PLAY_RE = /^\/(?:[a-z]{2}(?:-[a-z]{2,4})?\/)?play\/([\w-]+)/i;
  var END_RE = /(skip credits|next episode|passer (?:le )?générique|épisode suivant)/i;
  var tracker = W.createTracker();
  var current = null; /* {key, playId, durationS, meta} */

  function text(sel) {
    var el = document.querySelector(sel);
    return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }
  /* Position et durée en ms. Barre de progression d'abord (valeurs en secondes ; en ms si la
   * durée dépasse 6 h), sinon la vidéo. */
  function position() {
    var bars = document.querySelectorAll('progress-bar');
    for (var i = 0; i < bars.length; i++) {
      var sr = bars[i].shadowRoot;
      var thumb = sr && sr.querySelector('.progress-bar__thumb');
      if (!thumb) continue;
      var now = parseFloat(thumb.getAttribute('aria-valuenow'));
      var max = parseFloat(thumb.getAttribute('aria-valuemax'));
      if (!(max > 0) || !isFinite(max) || !(now >= 0) || !isFinite(now)) continue;
      var k = max > 6 * 3600 ? 1 : 1000;
      return { curMs: now * k, durMs: max * k };
    }
    var vids = document.querySelectorAll('video');
    for (var j = 0; j < vids.length; j++) {
      var v = vids[j];
      if (v.duration > 0 && isFinite(v.duration) && v.duration < 6 * 3600 && !v.paused) return { curMs: v.currentTime * 1000, durMs: v.duration * 1000 };
    }
    return null;
  }
  function readMeta() {
    var title = text('.title-field');
    if (!title) return null;
    var sub = text('.subtitle-field');
    var ep = sub ? W.parseEpisodeLabel(sub) : null;
    if (ep) return { kind: 'episode', title: title, season: ep.season, episode: ep.episode };
    if (sub) return null; /* sous-titre présent mais illisible : pas un film à coup sûr */
    return { kind: 'movie', title: title };
  }
  function endUi() {
    var els = document.querySelectorAll('button, [role="button"]');
    for (var j = 0; j < els.length && j < 150; j++) {
      var label = (els[j].getAttribute('aria-label') || '') + ' ' + (els[j].textContent || '');
      if (label.length < 80 && END_RE.test(label)) return true;
    }
    return false;
  }

  function check() {
    var m = PLAY_RE.exec(location.pathname || '');
    if (!m) { current = null; return; }
    var playId = m[1];
    var pos = position();
    if (!pos) return;
    var durationS = Math.round(pos.durMs / 1000);
    var meta = readMeta();
    if (meta) {
      var key = playId + '|' + meta.kind + '|' + meta.title + '|' + (meta.season || '') + '|' + (meta.episode || '');
      if (!current || current.key !== key) current = { key: key, playId: playId, durationS: durationS, meta: meta };
      else current.durationS = durationS;
    } else if (!current || current.playId !== playId || Math.abs(current.durationS - durationS) > 2) {
      current = null; /* autre vidéo (épisode suivant), titre pas encore lisible */
      return;
    }
    var s = tracker.track(current.key, pos.curMs);
    if (s.sent || !W.isDone(current.meta.kind, pos.curMs, pos.durMs, s, endUi())) return;
    var det = W.detection(current.meta.kind, current.meta.title, current.meta.season, current.meta.episode);
    if (!det) return;
    s.sent = true;
    chrome.runtime.sendMessage(det, function () { void chrome.runtime.lastError; });
  }
  setInterval(check, W.RULES.CHECK_EVERY_MS);
})();
