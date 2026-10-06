'use strict';
/* PHASE DIAGNOSTIC — rien n'est envoye a la watchlist pour l'instant. Des outils dedies
 * existent (TraktRoller, MALSync) mais leur mecanisme exact n'a pas pu etre lu depuis cet
 * environnement (acces GitHub limite). On scanne le DOM en attendant une vraie
 * verification (voir extension/README.md). */
setTimeout(function () { window.__wl.scanTitleLike('WL:crunchyroll'); }, 4000);
setInterval(function () { window.__wl.scanTitleLike('WL:crunchyroll'); }, 20000);
