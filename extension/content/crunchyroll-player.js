'use strict';
/*
 * Crunchyroll — lecteur (iframe static.crunchyroll.com, enregistré seulement après « Activer
 * Crunchyroll »). La vidéo est dans cette iframe ; la page www.crunchyroll.com qui la contient
 * connaît le titre et l'épisode (content/crunchyroll.js). Toutes les 2 s, on envoie à la page
 * parente la position, la durée et l'affichage d'un écran de fin — rien d'autre.
 * Message adressé à l'origine exacte https://www.crunchyroll.com (jamais '*') ; la page vérifie
 * l'origine de l'iframe et la forme du message.
 */
(function () {
  if (window.top === window) return; /* seulement dans l'iframe du lecteur */
  var PARENT_ORIGIN = 'https://www.crunchyroll.com';
  var END_RE = /(skip credits|skip outro|next episode|passer (?:le )?générique de fin|passer l'outro|épisode suivant)/i;

  function video() {
    var list = document.querySelectorAll('video');
    for (var i = 0; i < list.length; i++) if (list[i].duration > 0 && isFinite(list[i].duration)) return list[i];
    return null;
  }
  function endUi(v) {
    if (v.ended) return true;
    var els = document.querySelectorAll('button, [role="button"]');
    for (var i = 0; i < els.length && i < 200; i++) {
      var label = (els[i].getAttribute('aria-label') || '') + ' ' + (els[i].textContent || '');
      if (label.length < 80 && END_RE.test(label) && els[i].offsetParent !== null) return true;
    }
    return false;
  }
  function tick() {
    var v = video();
    if (!v) return;
    try {
      window.parent.postMessage({ __wlcr: true, t: Math.round(v.currentTime * 1000), d: Math.round(v.duration * 1000),
        paused: !!v.paused, end: endUi(v) }, PARENT_ORIGIN);
    } catch (e) { /* page parente d'une autre origine : rien n'est envoyé */ }
  }
  setInterval(tick, 2000);
})();
