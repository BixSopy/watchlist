'use strict';
/*
 * sw.js : réseau d'abord (copie de secours hors connexion) pour tout ce qui peut changer, cache d'abord
 * pour les fichiers à empreinte (?v=), et rien d'intercepté pour /api, sw.js, les autres domaines.
 * Lancer : node --test tests/
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const ORIGIN = 'https://cinepisode.com';

function worker({ online = true } = {}) {
  const store = new Map(); /* clé = URL complète */
  const fetched = [];
  const handlers = {};
  const keyOf = k => (typeof k === 'string' ? k : k.url);
  const cache = {
    match: k => Promise.resolve(store.get(keyOf(k))),
    put: (k, r) => { store.set(keyOf(k), r); return Promise.resolve(); },
    keys: () => Promise.resolve([...store.keys()].map(url => ({ url }))),
    delete: k => { store.delete(keyOf(k)); return Promise.resolve(true); },
  };
  const net = { online };
  const resp = (url, status = 200) => ({ url, status, type: 'basic', clone() { return resp(url, status); } });
  const ctx = {
    URL, Promise,
    self: { location: { origin: ORIGIN }, addEventListener: (ev, fn) => { handlers[ev] = fn; }, skipWaiting() {}, clients: { claim: () => Promise.resolve() } },
    caches: { open: () => Promise.resolve(cache), keys: () => Promise.resolve(['cinepisode-v1', 'ancien']), delete: () => Promise.resolve(true) },
    fetch: req => { fetched.push(req.url); return net.online ? Promise.resolve(resp(req.url)) : Promise.reject(new TypeError('Failed to fetch')); },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8'), ctx);
  /* Simule un événement fetch : renvoie la réponse, ou null si le service worker laisse passer */
  function request(url, { method = 'GET', mode = 'cors' } = {}) {
    let p = null;
    handlers.fetch({ request: { url, method, mode }, respondWith: x => { p = x; } });
    return p ? p.then(r => r) : Promise.resolve(null);
  }
  const flush = () => new Promise(r => setTimeout(r, 5));
  return { request, store, fetched, net, flush };
}

test('non interceptés : /api, sw.js, autres domaines, requêtes non GET', async () => {
  const w = worker();
  for (const u of [ORIGIN + '/api/tmdb?path=/tv/1', ORIGIN + '/sw.js', 'https://xyz.supabase.co/rest/v1/x', 'https://image.tmdb.org/t/p/w342/a.jpg'])
    assert.strictEqual(await w.request(u), null, u);
  assert.strictEqual(await w.request(ORIGIN + '/js/05-render.js', { method: 'POST' }), null);
  assert.deepStrictEqual(w.fetched, []);
});

test('réseau d\'abord : toujours le réseau en ligne, la copie ne sert que hors connexion', async () => {
  const w = worker();
  await w.request(ORIGIN + '/js/05-render.js'); await w.flush();
  await w.request(ORIGIN + '/js/05-render.js'); await w.flush();
  assert.strictEqual(w.fetched.length, 2, 'en ligne : réseau à chaque fois');
  w.net.online = false;
  const r = await w.request(ORIGIN + '/js/05-render.js');
  assert.strictEqual(r.url, ORIGIN + '/js/05-render.js', 'hors connexion : copie de secours');
  await assert.rejects(w.request(ORIGIN + '/js/jamais-vu.js'), 'rien en cache : échec réseau normal');
});

test('pages : rangées sans leur ?…, une page jamais visitée retombe sur l\'accueil hors connexion', async () => {
  const w = worker();
  await w.request(ORIGIN + '/?code=abc&lang=fr', { mode: 'navigate' }); await w.flush();
  assert.ok(w.store.has(ORIGIN + '/'));
  assert.ok(![...w.store.keys()].some(k => k.includes('code=')), 'pas de code de connexion en cache');
  w.net.online = false;
  assert.ok(await w.request(ORIGIN + '/?lang=en', { mode: 'navigate' }));
  const other = await w.request(ORIGIN + '/u/pierre', { mode: 'navigate' });
  assert.strictEqual(other.url, ORIGIN + '/?code=abc&lang=fr', 'repli sur l\'accueil');
});

test('empreintes (?v=) : cache d\'abord, et l\'ancienne empreinte du même fichier est retirée', async () => {
  const w = worker();
  await w.request(ORIGIN + '/js/05-render.js?v=aaaaaaaaaa'); await w.flush();
  await w.request(ORIGIN + '/js/05-render.js?v=aaaaaaaaaa'); await w.flush();
  assert.strictEqual(w.fetched.length, 1, 'deuxième demande servie par le cache');
  await w.request(ORIGIN + '/js/05-render.js?v=bbbbbbbbbb'); await w.flush(); await w.flush();
  assert.ok(w.store.has(ORIGIN + '/js/05-render.js?v=bbbbbbbbbb'));
  assert.ok(!w.store.has(ORIGIN + '/js/05-render.js?v=aaaaaaaaaa'), 'ancienne empreinte supprimée');
});
