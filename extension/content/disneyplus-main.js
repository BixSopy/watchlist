'use strict';
/* PHASE DIAGNOSTIC — rien n'est envoye a la watchlist pour l'instant. Disney+ utilise
 * Redux cote client, mais sans chemin window.X public verifie ici (meme le scrobbler
 * Trakt le plus etabli a eu des bugs de detection sur ce site). On scanne le DOM en
 * attendant une vraie verification (voir extension/README.md). */
setTimeout(function () { window.__wl.scanTitleLike('WL:disneyplus'); }, 4000);
setInterval(function () { window.__wl.scanTitleLike('WL:disneyplus'); }, 20000);
