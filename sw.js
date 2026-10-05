/*
 * Service worker volontairement minimal : aucune mise en cache. Son seul rôle est de
 * satisfaire le critère d'installabilité PWA de Chrome/Android (présence d'un écouteur
 * "fetch" actif) sans jamais servir une réponse mise en cache — chaque requête part donc
 * toujours au réseau comme si ce fichier n'existait pas. C'est voulu : l'app n'a pas de
 * build local (index.html/app.js sont servis tels quels par Vercel), donc tout cache
 * introduirait un risque de version figée après un déploiement.
 */
self.addEventListener('install', function (e) {
  self.skipWaiting();
});
self.addEventListener('activate', function (e) {
  e.waitUntil(self.clients.claim());
});
self.addEventListener('fetch', function () {
  /* pas de respondWith() : la requête suit son cours réseau normal */
});
