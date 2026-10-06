/* Diagnostic round 2 — a coller dans la console pendant une lecture. */
(function () {
  function safe(fn, label) {
    try { var v = fn(); console.log('[DIAG2]', label, '=>', JSON.stringify(v, null, 2)); return v; }
    catch (e) { console.log('[DIAG2]', label, 'ECHEC:', e.message); return undefined; }
  }

  var vp = window.netflix.appContext.state.playerApp.getAPI().videoPlayer;
  var sid = vp.getAllPlayerSessionIds()[0];
  var player = vp.getVideoPlayerBySessionId(sid);
  var movieId = player.getMovieId();
  console.log('[DIAG2] sessionId =', sid, '| movieId =', movieId);

  safe(function () { return vp.getActiveVideoMetadata(sid); }, 'videoPlayer.getActiveVideoMetadata(sid)');
  safe(function () { return vp.getActiveVideoMetadata(); }, 'videoPlayer.getActiveVideoMetadata() sans argument');

  safe(function () { return Object.keys(window.netflix.falcorCache || {}); }, 'Object.keys(falcorCache)');
  safe(function () { return window.netflix.falcorCache.videos && Object.keys(window.netflix.falcorCache.videos); }, 'Object.keys(falcorCache.videos)');
  safe(function () { return window.netflix.falcorCache.videos[movieId]; }, 'falcorCache.videos[movieId]');

  console.log('[DIAG2] ===== fin =====');
})();
