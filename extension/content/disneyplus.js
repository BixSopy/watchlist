'use strict';
/*
 * Disney+ — *.disneyplus.com (enregistré seulement après « Activer Disney+ »).
 * Détection en direct uniquement (Disney+ n'a pas de page d'historique).
 * 0.7.1 (robustesse, après un premier essai sans détection) :
 *  - page de lecture : /play/<id>, /<langue>/play/<id>, /video/<id> ; navigation SPA suivie
 *    (relevé toutes les 5 s de location.pathname, aucun rechargement nécessaire) ;
 *  - progression : la balise <video> d'abord (currentTime/duration, cherchée aussi dans les
 *    shadow roots ouverts), sinon <progress-bar> (aria-valuenow / aria-valuemax) ;
 *  - titre : .title-field / .subtitle-field, cherchés aussi dans les shadow roots ; repli sur
 *    navigator.mediaSession.metadata (titre seul : film ou, si un repère S/E s'y trouve, épisode) ;
 *  - écran de fin : bouton « Épisode suivant » / « Passer le générique ».
 *  - diagnostic local : dernier état écrit dans chrome.storage.local (clé cpDiag, rien d'envoyé),
 *    copiable depuis la fenêtre de l'extension ; journal console seulement si cpDebug = true.
 * Mêmes règles que les autres plateformes (lib/watch-rules.js). Aucune requête réseau.
 */
(function () {
  var W = self.CinepisodeWatch;
  if (!W) return;
  var PLAY_RE = /^\/(?:[a-z]{2}(?:-[a-z]{2,4})?\/)?(?:play|video)\/([\w-]+)/i;
  var END_RE = /(skip credits|next episode|passer (?:le )?générique|épisode suivant)/i;
  var tracker = W.createTracker();
  var current = null; /* {key, playId, durationS, meta} */
  var debug = false;
  var store = (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) || null;
  if (store) {
    try { store.get(['cpDebug'], function (r) { debug = !!(r && r.cpDebug); }); } catch (e) { /* ignore */ }
    try { chrome.storage.onChanged.addListener(function (c, a) { if (a === 'local' && c.cpDebug) debug = !!c.cpDebug.newValue; }); } catch (e) { /* ignore */ }
  }
  function log() { if (debug && typeof console !== 'undefined') console.debug.apply(console, ['[Cinepisode Disney+]'].concat([].slice.call(arguments))); }

  /* querySelectorAll qui descend aussi dans les shadow roots ouverts (lecteur en web components) */
  function deepAll(sel, root, out, depth) {
    root = root || document; out = out || []; depth = depth || 0;
    var found = root.querySelectorAll ? root.querySelectorAll(sel) : [];
    for (var i = 0; i < found.length; i++) out.push(found[i]);
    if (depth > 6 || !root.querySelectorAll) return out;
    var all = root.querySelectorAll('*') || [];
    for (var j = 0; j < all.length && j < 5000; j++) if (all[j] && all[j].shadowRoot) deepAll(sel, all[j].shadowRoot, out, depth + 1);
    return out;
  }
  function deepOne(sel) {
    var el = document.querySelector(sel);
    if (el) return el;
    var l = deepAll(sel);
    return l.length ? l[0] : null;
  }
  function text(sel) {
    var el = deepOne(sel);
    return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }
  /* Position et durée en ms. Vidéo d'abord, sinon barre de progression (secondes ; ms si > 6 h). */
  function position(diag) {
    var vids = deepAll('video');
    diag.videos = vids.length;
    var best = null;
    for (var j = 0; j < vids.length; j++) {
      var v = vids[j];
      if (!(v.duration > 0) || !isFinite(v.duration) || v.duration >= 6 * 3600) continue;
      if (!best || v.duration > best.duration) best = v; /* la plus longue : pas une bande-annonce */
    }
    if (best) {
      diag.source = 'video'; diag.paused = !!best.paused;
      if (best.paused) return null;
      return { curMs: best.currentTime * 1000, durMs: best.duration * 1000 };
    }
    var bars = deepAll('progress-bar');
    diag.bars = bars.length;
    for (var i = 0; i < bars.length; i++) {
      var sr = bars[i].shadowRoot;
      var thumb = (sr && sr.querySelector('.progress-bar__thumb')) || (bars[i].querySelector && bars[i].querySelector('[aria-valuenow]'));
      if (!thumb) continue;
      var now = parseFloat(thumb.getAttribute('aria-valuenow'));
      var max = parseFloat(thumb.getAttribute('aria-valuemax'));
      if (!(max > 0) || !isFinite(max) || !(now >= 0) || !isFinite(now)) continue;
      var k = max > 6 * 3600 ? 1 : 1000;
      diag.source = 'progress-bar';
      return { curMs: now * k, durMs: max * k };
    }
    diag.source = 'none';
    return null;
  }
  function sessionTitle() {
    try {
      var md = navigator.mediaSession && navigator.mediaSession.metadata;
      return md && md.title ? String(md.title).replace(/\s+/g, ' ').trim() : '';
    } catch (e) { return ''; }
  }
  function readMeta(diag) {
    var title = text('.title-field');
    var sub = text('.subtitle-field');
    diag.title = title; diag.sub = sub;
    if (!title) {
      var ms = typeof navigator !== 'undefined' ? sessionTitle() : '';
      diag.mediaSession = ms;
      return null; /* titre de mediaSession = souvent celui de l'épisode : seulement pour le diagnostic */
    }
    var ep = sub ? W.parseEpisodeLabel(sub) : null;
    if (ep) return { kind: 'episode', title: title, season: ep.season, episode: ep.episode };
    if (sub) return null; /* sous-titre présent mais illisible : pas un film à coup sûr */
    return { kind: 'movie', title: title };
  }
  function endUi() {
    var els = deepAll('button, [role="button"]');
    for (var j = 0; j < els.length && j < 300; j++) {
      var label = (els[j].getAttribute('aria-label') || '') + ' ' + (els[j].textContent || '');
      if (label.length < 80 && END_RE.test(label)) return true;
    }
    return false;
  }
  var lastDiagAt = 0;
  function saveDiag(diag) {
    if (!store) return;
    var t = Date.now();
    if (t - lastDiagAt < 15000 && !diag.sent) return;
    lastDiagAt = t;
    diag.at = t; diag.v = '0.7.1';
    try { store.set({ cpDiag: diag }); } catch (e) { /* ignore */ }
  }

  function check() {
    var path = location.pathname || '';
    var diag = { platform: 'disneyplus', host: location.hostname || '', path: path.replace(/[\w-]{12,}/g, '…'), frame: (typeof window !== 'undefined' && window.top !== window) ? 'iframe' : 'top' };
    var m = PLAY_RE.exec(path);
    if (!m) { current = null; return; }
    var playId = m[1];
    var pos = position(diag);
    if (!pos) { log('pas de position', diag); saveDiag(diag); return; }
    diag.pct = Math.round(pos.curMs / pos.durMs * 100);
    var durationS = Math.round(pos.durMs / 1000);
    var meta = readMeta(diag);
    if (meta) {
      var key = playId + '|' + meta.kind + '|' + meta.title + '|' + (meta.season || '') + '|' + (meta.episode || '');
      if (!current || current.key !== key) current = { key: key, playId: playId, durationS: durationS, meta: meta };
      else current.durationS = durationS;
    } else if (!current || current.playId !== playId || Math.abs(current.durationS - durationS) > 2) {
      current = null; /* autre vidéo (épisode suivant), titre pas encore lisible */
      diag.state = 'no-meta'; log('titre illisible', diag); saveDiag(diag);
      return;
    }
    var s = tracker.track(current.key, pos.curMs);
    diag.meta = current.meta; diag.watchedS = Math.round(s.watchedMs / 1000); diag.sentAlready = !!s.sent;
    if (s.sent) return;
    var end = endUi();
    if (!W.isDone(current.meta.kind, pos.curMs, pos.durMs, s, end)) { diag.state = 'tracking'; log('suivi', diag); saveDiag(diag); return; }
    var det = W.detection(current.meta.kind, current.meta.title, current.meta.season, current.meta.episode);
    if (!det) { diag.state = 'invalid'; saveDiag(diag); return; }
    s.sent = true;
    diag.state = 'sent'; diag.sent = true; log('envoyé', det); saveDiag(diag);
    chrome.runtime.sendMessage(det, function (r) { void chrome.runtime.lastError; log('réponse', r); });
  }
  setInterval(check, W.RULES.CHECK_EVERY_MS);
})();
