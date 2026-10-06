/* Diagnostic ponctuel — a coller dans la console (F12) pendant la lecture d'un episode,
 * PAS un fichier charge par l'extension. Sert a decouvrir ce que Netflix expose reellement
 * sur ce compte, pour remplacer la detection par document.title (infructueuse) dans
 * content/netflix.js. Copier-coller tout le resultat logue. */
(function () {
  function safe(fn, label) {
    try { var v = fn(); console.log('[DIAG]', label, '=>', v); return v; }
    catch (e) { console.log('[DIAG]', label, 'ECHEC:', e.message); return undefined; }
  }

  console.log('[DIAG] ===== depart =====');
  safe(function () { return typeof window.netflix; }, 'typeof window.netflix');

  var playerApp = safe(function () { return window.netflix.appContext.state.playerApp; }, 'netflix.appContext.state.playerApp present');

  var videoPlayer = safe(function () { return window.netflix.appContext.state.playerApp.getAPI().videoPlayer; }, 'videoPlayer');
  var sessionIds = safe(function () { return videoPlayer.getAllPlayerSessionIds(); }, 'sessionIds');
  if (sessionIds && sessionIds.length) {
    var player = safe(function () { return videoPlayer.getVideoPlayerBySessionId(sessionIds[0]); }, 'player (1ere session)');
    if (player) {
      safe(function () { return player.getMovieId(); }, 'player.getMovieId()');
      safe(function () { return player.getDuration(); }, 'player.getDuration()');
      safe(function () { return player.getCurrentTime(); }, 'player.getCurrentTime()');
      safe(function () { return Object.keys(player.constructor.prototype); }, 'methodes disponibles sur player');
    }
  }

  safe(function () { return window.netflix.cadmium.metadata.getActiveVideo(); }, 'netflix.cadmium.metadata.getActiveVideo()');
  safe(function () { return Object.keys(window.netflix); }, 'Object.keys(netflix) — vue d ensemble');

  console.log('[DIAG] ===== fin — copie tout ce bloc [DIAG] =====');
})();
