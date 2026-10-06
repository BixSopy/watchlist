'use strict';
/*
 * Détection best-effort du titre/saison/épisode en cours sur Netflix.
 *
 * INCERTITUDE ASSUMÉE : Netflix n'a pas d'API publique. document.title est le signal
 * le plus stable observé par la communauté (plus robuste que de parcourir les objets JS
 * internes de Netflix, qui changent sans préavis), mais son format exact n'a pas pu être
 * vérifié ici faute d'accès à un vrai compte Netflix depuis cet environnement. Tout est
 * loggé avec le préfixe [WL] pour ajuster les regex ci-dessous au vu de la console réelle.
 *
 * Scope v1 : séries/anime uniquement (saison+épisode détectés). Les films ne sont pas
 * encore gérés ici (seuil "fin de visionnage" trop incertain à deviner sans test réel) —
 * pour les films, la voie Plex/Tautulli reste la référence.
 */

var TITLE_PATTERNS = [
  /^(.*?)\s*:\s*S(\d+)[:\s]+É?E(\d+)/i,
  /^(.*?)\s*:\s*Saison\s*(\d+)[:\s]+[ÉE]pisode\s*(\d+)/i,
  /^(.*?)\s*-\s*Season\s*(\d+)[:\s]+Episode\s*(\d+)/i,
  /^(.*?)\s*-\s*Saison\s*(\d+)[:\s]+[ÉE]pisode\s*(\d+)/i,
];

function parseTitle(raw) {
  var t = (raw || '').replace(/\s*-\s*Netflix\s*$/i, '').trim();
  for (var i = 0; i < TITLE_PATTERNS.length; i++) {
    var m = t.match(TITLE_PATTERNS[i]);
    if (m) return { show: m[1].trim(), season: parseInt(m[2], 10), episode: parseInt(m[3], 10) };
  }
  return null;
}

function report(parsed) {
  console.log('[WL] envoi :', parsed);
  chrome.runtime.sendMessage(
    { type: 'wl_watched', title: parsed.show, season: parsed.season, episode: parsed.episode },
    function (res) { console.log('[WL] reponse background :', res); }
  );
}

function check() {
  var raw = document.title;
  console.log('[WL] document.title brut :', JSON.stringify(raw));
  var parsed = parseTitle(raw);
  if (parsed) {
    console.log('[WL] parse reussi :', parsed);
    report(parsed);
  } else {
    console.log('[WL] format non reconnu — colle cette ligne telle quelle pour ajuster la regex.');
  }
}

/* Vérifie au chargement, puis à chaque changement de titre (changement d'épisode dans
   la SPA Netflix, sans rechargement de page) et en secours toutes les 60s. */
setTimeout(check, 3000);
new MutationObserver(check).observe(
  document.querySelector('title') || document.head,
  { subtree: true, characterData: true, childList: true }
);
setInterval(check, 60000);
