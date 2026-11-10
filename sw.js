/*
 * Service worker : ouverture hors connexion, sans risque de version figée.
 * - Fichiers à empreinte (?v=…, ajoutée à chaque déploiement par scripts/build-static.mjs) : leur
 *   contenu ne change jamais pour une URL donnée → servis depuis le cache, sinon réseau puis cache.
 *   Les anciennes empreintes d'un même fichier sont supprimées dès qu'une nouvelle est mise en cache.
 * - Tout le reste du site (pages, scripts sans empreinte, images, sons, polices) : réseau d'abord,
 *   exactement comme sans service worker ; la copie gardée en cache ne sert QUE si le réseau échoue
 *   (hors connexion). Une page en ligne est donc toujours la dernière version déployée.
 * - Jamais interceptés : /api/*, sw.js, autres domaines (Supabase, TMDB, Turnstile), requêtes non GET.
 * La liste elle-même reste dans IndexedDB (js/03-dom-utils.js) et se resynchronise au retour du réseau.
 */
var CACHE = 'cinepisode-v1';

self.addEventListener('install', function () {
  self.skipWaiting();
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function storable(r) { return r && r.status === 200 && r.type === 'basic'; }

/* Fichier à empreinte : cache d'abord ; en le mettant en cache, retire ses empreintes précédentes */
function versioned(req, url) {
  return caches.open(CACHE).then(function (c) {
    return c.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (r) {
        if (storable(r)) {
          var copy = r.clone();
          c.put(req, copy).then(function () {
            return c.keys().then(function (ks) {
              ks.forEach(function (k) {
                var u = new URL(k.url);
                if (u.pathname === url.pathname && u.search !== url.search) c.delete(k);
              });
            });
          });
        }
        return r;
      });
    });
  });
}

/* Le reste : réseau d'abord, copie de secours pour le hors connexion. Les pages sont rangées sans
   leur ?… (codes de connexion, ?lang=…) ; une page jamais visitée retombe sur l'accueil. */
function networkFirst(req, url) {
  var nav = req.mode === 'navigate';
  var key = nav ? url.origin + url.pathname : req;
  return fetch(req).then(function (r) {
    if (storable(r)) {
      var copy = r.clone();
      caches.open(CACHE).then(function (c) { return c.put(key, copy); });
    }
    return r;
  }).catch(function (err) {
    return caches.open(CACHE).then(function (c) {
      return c.match(key).then(function (hit) {
        if (hit || !nav) return hit;
        return c.match(url.origin + '/');
      });
    }).then(function (hit) {
      if (hit) return hit;
      throw err;
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf('/api/') === 0 || url.pathname === '/sw.js') return;
  e.respondWith(url.searchParams.has('v') ? versioned(req, url) : networkFirst(req, url));
});
