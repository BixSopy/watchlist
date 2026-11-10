'use strict';
/*
 * Sobriété réseau : une fiche TMDB demandée en même temps par plusieurs modules ne part qu'une fois,
 * les alertes « nouvel épisode » ne revérifient pas une série avant 6 h, la synchro s'arrête onglet caché.
 * Lancer : node --test tests/
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
/* Une fonction (et ce qui la suit jusqu'à la prochaine déclaration de haut niveau) extraite du module */
function slice(file, from, to) {
  const s = read(file); const a = s.indexOf(from); const b = to ? s.indexOf(to, a + 1) : s.length;
  assert.ok(a >= 0 && b > a, from + ' introuvable dans ' + file);
  return s.slice(a, b);
}

test('tf : deux demandes simultanées de la même URL partagent un seul appel ; une erreur libère l\'URL', async () => {
  const calls = [];
  let fail = false;
  const ctx = { cache: {}, Date, Promise, Error,
    apiFetch: url => { calls.push(url); return Promise.resolve(fail ? { ok: false, status: 500 } : { ok: true, json: () => Promise.resolve({ id: url }) }); },
    _isApiErrorBody: () => false };
  vm.createContext(ctx);
  vm.runInContext(slice('js/04-tmdb-api.js', 'var TF_CACHE_TTL', '/* Corps d\'erreur') + '\nthis.tf=tf;', ctx);
  const [a, b] = await Promise.all([ctx.tf('/api/tmdb/tv/1'), ctx.tf('/api/tmdb/tv/1')]);
  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(a, b);
  await ctx.tf('/api/tmdb/tv/1');
  assert.strictEqual(calls.length, 1, 'ensuite servi par le cache');
  fail = true;
  await assert.rejects(ctx.tf('/api/tmdb/tv/2'));
  fail = false;
  await ctx.tf('/api/tmdb/tv/2');
  assert.strictEqual(calls.length, 3, 'après une erreur, l\'URL est redemandée');
});

function airContext(items, store = {}) {
  let now = 1e12;
  const fetched = [];
  const ctx = {
    memDB: items, TB: '/api/tmdb', TMDB_LANG: 'fr-FR', Date: { now: () => now }, JSON, Object, Promise, Math,
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    tf: url => { fetched.push(url); return Promise.resolve({ last_episode_to_air: null }); },
    dbPut: (i, cb) => cb && cb(), document: { getElementById: () => null }, renderSuivi: () => {}, render: () => {}, sfx: () => {},
  };
  vm.createContext(ctx);
  vm.runInContext(slice('js/14-suivi.js', 'function checkAir(item)', '/* ===== MODULE SUIVI') + '\nthis.checkAllAir=checkAllAir;', ctx);
  return { ctx, fetched, store, tick: ms => { now += ms; } };
}

test('alertes nouvel épisode : une série vérifiée il y a moins de 6 h n\'est pas redemandée', async () => {
  const items = [1, 2, 3, 4, 5, 6, 7, 8].map(n => ({ id: 'i' + n, tmdbId: n, type: 'serie', status: 'encours' }))
    .concat([{ id: 'f', tmdbId: 99, type: 'film', status: 'encours' }, { id: 'x', tmdbId: 50, type: 'serie', status: 'encours', deleted: true }]);
  const { ctx, fetched, tick } = airContext(items);
  ctx.checkAllAir();
  await new Promise(r => setTimeout(r, 20));
  assert.strictEqual(fetched.length, 8, 'séries en cours seulement (pas les films ni les supprimées)');
  tick(3600000); ctx.checkAllAir(); await new Promise(r => setTimeout(r, 20));
  assert.strictEqual(fetched.length, 8, '1 h après : rien');
  tick(5 * 3600000 + 1); ctx.checkAllAir(); await new Promise(r => setTimeout(r, 20));
  assert.strictEqual(fetched.length, 16, '6 h après : revérifiées');
});

test('synchro : arrêtée onglet caché, rattrapée et relancée au retour', () => {
  const src = read('js/15-sync.js');
  assert.match(src, /!document\.hidden\)\{_lastSyncAt=Date\.now\(\);syncNow\(\);\}/);
  assert.match(src, /document\.addEventListener\('visibilitychange'/);
  const listeners = {}; let now = 0; let synced = 0; const intervals = new Set(); let nextId = 1;
  const ctx = {
    document: { hidden: false, addEventListener: (ev, fn) => { listeners[ev] = fn; } },
    navigator: { onLine: true }, authProfileId: 'p', syncLoopTimer: null, Date: { now: () => now },
    setInterval: () => { const id = nextId++; intervals.add(id); return id; }, clearInterval: id => intervals.delete(id),
    syncNow: () => { synced++; },
  };
  vm.createContext(ctx);
  vm.runInContext(slice('js/15-sync.js', '/* Synchro périodique', '/* --- Jeton de suivi auto'), ctx);
  vm.runInContext('startSyncLoop();', ctx);
  assert.strictEqual(intervals.size, 1);
  ctx.document.hidden = true; listeners.visibilitychange();
  assert.strictEqual(intervals.size, 0, 'onglet caché : plus de minuteur');
  now += 60000; ctx.document.hidden = false; listeners.visibilitychange();
  assert.strictEqual(synced, 1, 'rattrapage immédiat au retour');
  assert.strictEqual(intervals.size, 1);
  now += 5000; ctx.document.hidden = true; listeners.visibilitychange(); ctx.document.hidden = false; listeners.visibilitychange();
  assert.strictEqual(synced, 1, 'pas de rattrapage si la dernière synchro a moins de 30 s');
  vm.runInContext('stopSyncLoop();', ctx);
  ctx.document.hidden = false; listeners.visibilitychange();
  assert.strictEqual(intervals.size, 0, 'déconnecté : le retour au premier plan ne relance rien');
});
