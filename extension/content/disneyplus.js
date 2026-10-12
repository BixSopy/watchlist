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
  /* 0.7.2.1 : injecté aussi dans les onglets déjà ouverts (background) : une seule instance */
  if (self.__cpDisneyInit) return;
  self.__cpDisneyInit = true;
  var store0 = (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) || null;
  function early(extra) {
    if (!store0) return;
    try { store0.set({ cpDiag: Object.assign({ platform: 'disneyplus', host: location.hostname || '', frame: window.top !== window ? 'iframe' : 'top', at: Date.now(), v: '0.7.2.1', state: 'loaded' }, extra || {}) }); } catch (e) { /* ignore */ }
  }
  if (window.top === window) early();
  try {
  var W = self.CinepisodeWatch;
  if (!W) { early({ state: 'error', error: 'watch-rules absent' }); return; }
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
  /* 0.7.2 : diagnostic réel (Chrome, /fr-fr/play/…) : 2 <video>, aucune retenue, aucune barre.
   * Le lecteur Disney+ (MSE) peut annoncer une durée NaN / Infinity / énorme : on prend donc la
   * vidéo EN LECTURE (non en pause, currentTime > 0, de préférence celle qui avance), quelle que
   * soit sa durée, puis la durée la plus fiable : video.duration, sinon la fin de la plage
   * « seekable », sinon une barre de progression / [role=slider] (aria-valuemax), sinon
   * l'affichage du temps restant. Durée inconnue : seul l'écran de fin compte (voir check). */
  var lastT = [];
  function validDur(d) { return typeof d === 'number' && d > 0 && isFinite(d) && d < 6 * 3600; }
  function srcType(v) {
    var src = String(v.currentSrc || v.src || '');
    return !src ? 'none' : src.indexOf('blob:') === 0 ? 'blob' : src.indexOf('http') === 0 ? 'http' : 'other';
  }
  function sliderPos(diag) {
    var cands = deepAll('progress-bar').concat(deepAll('[role="slider"]'), deepAll('[aria-valuemax]'));
    diag.bars = cands.length;
    for (var i = 0; i < cands.length; i++) {
      var el = cands[i], sr = el.shadowRoot;
      var thumb = (sr && (sr.querySelector('.progress-bar__thumb') || sr.querySelector('[aria-valuenow]'))) ||
        (el.getAttribute && el.getAttribute('aria-valuenow') !== null ? el : null) ||
        (el.querySelector && el.querySelector('[aria-valuenow]'));
      if (!thumb || !thumb.getAttribute) continue;
      var now = parseFloat(thumb.getAttribute('aria-valuenow'));
      var max = parseFloat(thumb.getAttribute('aria-valuemax'));
      if (!(max > 0) || !isFinite(max) || !(now >= 0) || !isFinite(now) || now > max) continue;
      if (max === 100 && !/progress/i.test(String(el.tagName || '') + ' ' + String(el.className || ''))) continue; /* volume */
      var k = max > 6 * 3600 ? 1 : 1000;
      return { curMs: now * k, durMs: max * k };
    }
    return null;
  }
  function parseClock(t) {
    var m = /^(-)?\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/.exec(t);
    if (!m) return null;
    return { neg: !!m[1], ms: ((parseInt(m[2] || '0', 10) * 60 + parseInt(m[3], 10)) * 60 + parseInt(m[4], 10)) * 1000 };
  }
  /* Temps restant affiché (« -12:34 », classe *remaining*) : durée = position + restant */
  function remainingMs(diag) {
    var els = deepAll('[class*="remaining"], [class*="time-display"], [class*="time"]');
    for (var i = 0; i < els.length && i < 200; i++) {
      var t = (els[i].textContent || '').replace(/\s+/g, ' ').trim();
      if (t.length > 12) continue;
      var c = parseClock(t);
      if (c && (c.neg || /remaining/i.test(String(els[i].className || '')))) { diag.remaining = t; return c.ms; }
    }
    return null;
  }
  function position(diag) {
    var vids = deepAll('video');
    diag.videos = vids.length;
    diag.vids = [];
    var best = null, bestScore = -1;
    for (var j = 0; j < vids.length; j++) {
      var v = vids[j];
      var t = Number(v.currentTime) || 0;
      var advancing = typeof lastT[j] === 'number' && t > lastT[j];
      lastT[j] = t;
      diag.vids.push({ d: typeof v.duration === 'number' ? (isFinite(v.duration) ? Math.round(v.duration) : String(v.duration)) : null,
        t: Math.round(t), p: !!v.paused, rs: v.readyState, src: srcType(v), w: v.videoWidth | 0, h: v.videoHeight | 0 });
      if (v.paused || !(t > 0)) continue;
      var score = (advancing ? 4 : 0) + (validDur(v.duration) ? 2 : 0) + ((v.videoWidth | 0) > 0 ? 1 : 0);
      if (score > bestScore) { best = v; bestScore = score; }
    }
    if (!best) {
      var anyPaused = vids.some(function (v) { return v.paused && v.currentTime > 0; });
      if (anyPaused) { diag.source = 'video'; diag.paused = true; return null; }
      var bar = sliderPos(diag);
      if (bar) { diag.source = 'progress-bar'; return bar; }
      diag.source = 'none';
      return null;
    }
    diag.source = 'video'; diag.paused = false;
    var curMs = best.currentTime * 1000;
    if (validDur(best.duration)) return { curMs: curMs, durMs: best.duration * 1000 };
    try {
      var sk = best.seekable;
      if (sk && sk.length) { var end = sk.end(sk.length - 1); if (validDur(end) && end * 1000 >= curMs) { diag.durFrom = 'seekable'; return { curMs: curMs, durMs: end * 1000 }; } }
    } catch (e) { /* ignore */ }
    var b2 = sliderPos(diag);
    if (b2) { diag.durFrom = 'bar'; return { curMs: b2.curMs, durMs: b2.durMs }; }
    var rem = remainingMs(diag);
    if (rem !== null) { diag.durFrom = 'remaining'; return { curMs: curMs, durMs: curMs + rem }; }
    diag.durFrom = 'none';
    return { curMs: curMs, durMs: null }; /* durée inconnue : écran de fin seulement */
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
    try { diag.hits = { title: deepAll('.title-field').length, sub: deepAll('.subtitle-field').length }; } catch (e) { /* ignore */ }
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
    /* Panneau « à suivre » (up-next) affiché pendant le générique */
    try {
      var up = deepAll('[data-testid*="up-next" i], [class*="up-next" i], [class*="upnext" i], [data-testid*="upnext" i]');
      for (var u = 0; u < up.length; u++) if (!up[u].hidden && (up[u].textContent || '').trim()) return true;
    } catch (e) { /* sélecteur non pris en charge */ }
    return false;
  }
  var lastDiagAt = 0;
  function saveDiag(diag) {
    if (!store) return;
    var t = Date.now();
    if (t - lastDiagAt < 15000 && !diag.sent) return;
    lastDiagAt = t;
    diag.at = t; diag.v = '0.7.2.1';
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
    diag.pct = pos.durMs ? Math.round(pos.curMs / pos.durMs * 100) : null;
    var durationS = pos.durMs ? Math.round(pos.durMs / 1000) : 0;
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
    var prog = W.progress(current.meta.kind, current.meta.title, current.meta.season, current.meta.episode, pos.curMs, pos.durMs, s.sent);
    if (prog) chrome.runtime.sendMessage(prog, function () { void chrome.runtime.lastError; });
    if (s.sent) return;
    var end = endUi();
    diag.end = end;
    /* Durée inconnue (MSE) : l'écran de fin (« Épisode suivant », générique) suffit, titre lu et
     * au moins 20 s de lecture observée */
    var done = pos.durMs ? W.isDone(current.meta.kind, pos.curMs, pos.durMs, s, end) : (end && s.watchedMs >= W.RULES.MIN_WATCHED_MS);
    if (!done) { diag.state = 'tracking'; log('suivi', diag); saveDiag(diag); return; }
    var det = W.detection(current.meta.kind, current.meta.title, current.meta.season, current.meta.episode);
    if (!det) { diag.state = 'invalid'; saveDiag(diag); return; }
    s.sent = true;
    diag.state = 'sent'; diag.sent = true; log('envoyé', det); saveDiag(diag);
    chrome.runtime.sendMessage(det, function (r) { void chrome.runtime.lastError; log('réponse', r); });
  }
  setInterval(function () {
    try { check(); } catch (e) { early({ state: 'error', error: String(e && e.message || e).slice(0, 200) }); }
  }, W.RULES.CHECK_EVERY_MS);
  } catch (e) { early({ state: 'error', error: 'init: ' + String(e && e.message || e).slice(0, 200) }); }
})();
