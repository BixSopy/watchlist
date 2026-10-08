'use strict';
/*
 * Crunchyroll — page www.crunchyroll.com (enregistré seulement après « Activer Crunchyroll »).
 * Sur une page /watch/ : titre de la série, saison et épisode lus dans les métadonnées de la
 * page (JSON-LD TVEpisode/Movie, sinon le titre affiché), position de la vidéo reçue de l'iframe
 * du lecteur (content/crunchyroll-player.js). Mêmes règles que Netflix (lib/watch-rules.js).
 * Saison : celle de Crunchyroll, telle quelle (le site gère les écarts de numérotation).
 *
 * Messages de l'iframe acceptés seulement s'ils viennent de https://static.crunchyroll.com, d'une
 * iframe de cette page (event.source) et ont la forme exacte attendue. Aucune trace console.
 */
(function () {
  var W = self.CinepisodeWatch;
  if (!W) return;
  var PLAYER_ORIGIN = 'https://static.crunchyroll.com';
  var DUB_RE = /\s+\((?:[\w\u00C0-\u017F-]+\s+)?(?:Dub|Dubbed|Sub|Subbed|Subtitled|VF|VOSTFR|Doublage)\)\s*$/i;
  var tracker = W.createTracker();
  var player = null; /* dernier relevé de l'iframe : {t, d, end, paused, at} */

  function isChildFrame(src) {
    var frames = document.querySelectorAll('iframe');
    for (var i = 0; i < frames.length; i++) if (frames[i].contentWindow === src) return true;
    return false;
  }
  function num(v) { return typeof v === 'number' && isFinite(v) && v >= 0 && v < 2e8; }
  window.addEventListener('message', function (ev) {
    if (ev.origin !== PLAYER_ORIGIN || !isChildFrame(ev.source)) return;
    var d = ev.data;
    if (!d || typeof d !== 'object' || d.__wlcr !== true || !num(d.t) || !num(d.d) || typeof d.end !== 'boolean') return;
    player = { t: d.t, d: d.d, end: d.end, paused: d.paused === true, at: Date.now() };
  });

  function watchId() {
    var m = /\/watch\/([A-Za-z0-9]+)/.exec(location.pathname);
    return m ? m[1] : null;
  }
  function int(v) {
    var n = typeof v === 'number' ? v : (typeof v === 'string' && /^\d{1,5}$/.test(v.trim()) ? parseInt(v, 10) : NaN);
    return Number.isInteger(n) && n >= 0 ? n : null;
  }
  function clean(t) { return typeof t === 'string' ? t.replace(DUB_RE, '').replace(/\s+/g, ' ').trim() : ''; }
  function ldObjects() {
    var out = [];
    var scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (var i = 0; i < scripts.length; i++) {
      var j; try { j = JSON.parse(scripts[i].textContent); } catch (e) { continue; }
      var list = Array.isArray(j) ? j : (j && Array.isArray(j['@graph']) ? j['@graph'] : [j]);
      for (var k = 0; k < list.length; k++) if (list[k] && typeof list[k] === 'object') out.push(list[k]);
    }
    return out;
  }
  function nameOf(o) { return o && typeof o === 'object' ? clean(o.name) : ''; }
  /* {kind, title, season, episode} pour la vidéo de cette page, ou null */
  function metadata(id) {
    var lds = ldObjects();
    for (var i = 0; i < lds.length; i++) {
      var o = lds[i];
      var url = String(o.url || o['@id'] || '');
      if (url && url.indexOf(id) < 0) continue; /* métadonnées d'une page précédente (navigation sans rechargement) */
      if (o['@type'] === 'TVEpisode') {
        var series = nameOf(o.partOfSeries) || nameOf(o.partOfTVSeries);
        var season = int(o.partOfSeason && o.partOfSeason.seasonNumber);
        var ep = int(o.episodeNumber);
        if (series && season !== null && ep !== null) return { kind: 'episode', title: series, season: season, episode: ep };
      }
      if (o['@type'] === 'Movie' && nameOf(o)) return { kind: 'movie', title: nameOf(o) };
    }
    return null;
  }

  function check() {
    var id = watchId();
    if (!id || !player || Date.now() - player.at > 8000 || player.paused) return;
    var meta = metadata(id);
    if (!meta) return;
    var s = tracker.track(id, player.t);
    if (s.sent || !W.isDone(meta.kind, player.t, player.d, s, player.end)) return;
    var det = W.detection(meta.kind, meta.title, meta.season, meta.episode);
    if (!det) return;
    s.sent = true;
    chrome.runtime.sendMessage(det, function () { void chrome.runtime.lastError; });
  }
  setInterval(check, W.RULES.CHECK_EVERY_MS);
})();
