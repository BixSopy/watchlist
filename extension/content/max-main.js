'use strict';
/* PHASE DIAGNOSTIC — rien n'est envoye a la watchlist pour l'instant. Peu de signal
 * public fiable trouve pour Max/HBO Max (support meme pas garanti dans les scrobblers
 * etablis). On scanne le DOM en attendant une vraie verification (voir extension/README.md). */
setTimeout(function () { window.__wl.scanTitleLike('WL:max'); }, 4000);
setInterval(function () { window.__wl.scanTitleLike('WL:max'); }, 20000);
