'use strict';
/* PHASE DIAGNOSTIC — rien n'est envoye a la watchlist pour l'instant. Signal de depart :
 * un article public (Amazon Prime Video Player Investigation) decrit un state machine
 * interne (this.stateMachine) et une structure tvAncestors pour serie/saison/episode,
 * mais sans chemin window.X simple et stable a reproduire ici sans acces reel au site.
 * On scanne le DOM en attendant une vraie verification (voir extension/README.md). */
setTimeout(function () { window.__wl.scanTitleLike('WL:primevideo'); }, 4000);
setInterval(function () { window.__wl.scanTitleLike('WL:primevideo'); }, 20000);
