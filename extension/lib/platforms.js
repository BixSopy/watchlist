'use strict';
/*
 * Plateformes activables (extension 0.6.0, Disney+ et Apple TV en 0.7.0). Netflix est accordé à
 * l'installation ; Crunchyroll, Prime Video, Disney+ et Apple TV sont des permissions facultatives (optional_host_permissions) demandées par les
 * boutons « Activer Crunchyroll » / « Activer Prime Video » : l'avertissement à l'installation
 * reste limité à Netflix et Cinepisode. Une fois la permission accordée, le service worker
 * enregistre les scripts de détection en direct ci-dessous (chrome.scripting.registerContentScripts)
 * et les retire si la permission est retirée.
 */
(function (root) {
  var PLATFORMS = {
    crunchyroll: {
      origins: ['https://www.crunchyroll.com/*', 'https://static.crunchyroll.com/*'],
      pageOrigin: 'https://www.crunchyroll.com',
      scripts: [
        { id: 'cp-crunchyroll-page', matches: ['https://www.crunchyroll.com/*'], js: ['lib/watch-rules.js', 'content/crunchyroll.js'], runAt: 'document_idle' },
        { id: 'cp-crunchyroll-player', matches: ['https://static.crunchyroll.com/*'], js: ['content/crunchyroll-player.js'], allFrames: true, runAt: 'document_idle' },
      ],
    },
    prime: {
      origins: ['https://www.primevideo.com/*', 'https://atv-ps.primevideo.com/*', 'https://atv-ps-eu.primevideo.com/*', 'https://atv-ps-fe.primevideo.com/*'],
      pageOrigin: 'https://www.primevideo.com',
      scripts: [
        { id: 'cp-prime-page', matches: ['https://www.primevideo.com/*'], js: ['lib/watch-rules.js', 'content/prime.js'], runAt: 'document_idle' },
      ],
    },
    /* 0.7.0 : détection en direct seulement (ni Disney+ ni Apple TV n'ont d'historique lisible) */
    disneyplus: {
      origins: ['https://www.disneyplus.com/*'],
      pageOrigin: 'https://www.disneyplus.com',
      liveOnly: true,
      scripts: [
        { id: 'cp-disneyplus-page', matches: ['https://www.disneyplus.com/*'], js: ['lib/watch-rules.js', 'content/disneyplus.js'], runAt: 'document_idle' },
      ],
    },
    appletv: {
      origins: ['https://tv.apple.com/*'],
      pageOrigin: 'https://tv.apple.com',
      liveOnly: true,
      scripts: [
        { id: 'cp-appletv-page', matches: ['https://tv.apple.com/*'], js: ['lib/watch-rules.js', 'content/appletv.js'], runAt: 'document_idle' },
      ],
    },
  };
  root.CinepisodePlatforms = PLATFORMS;
  if (typeof module !== 'undefined' && module.exports) module.exports = PLATFORMS;
})(typeof self !== 'undefined' ? self : this);
