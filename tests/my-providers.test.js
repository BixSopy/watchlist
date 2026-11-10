'use strict';
/* Mes plateformes (js/42-my-providers.js) : correspondance titre ↔ abonnements cochés, filtre de Ma liste,
   rafraîchissement hebdomadaire par lots, route du catalogue autorisée par le proxy TMDB.
   Lancer : node --test tests/ */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');

function fresh(store = {}) {
  global.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  global.TB = '/api/tmdb'; global.IB = 'https://image.tmdb.org/t/p/'; global.TMDB_LANG = 'fr-FR'; global.TMDB_REGION = 'FR';
  global.textCompare = (a, b) => String(a).localeCompare(String(b));
  global.render = () => { global.__rendered = (global.__rendered || 0) + 1; };
  global.document = { getElementById: () => null, querySelector: () => null };
  delete require.cache[require.resolve(path.join(ROOT, 'js', '42-my-providers.js'))];
  return require(path.join(ROOT, 'js', '42-my-providers.js'));
}
const NETFLIX = 8, DISNEY = 337;

test('correspondance par id, et par nom pour les anciens enregistrements sans id', () => {
  const M = fresh();
  assert.strictEqual(M.itemOnMyProviders({ streamingProviders: [{ id: 8, name: 'Netflix' }] }, [8]), true);
  assert.strictEqual(M.itemOnMyProviders({ streamingProviders: [{ id: 337, name: 'Disney Plus' }] }, [8]), false);
  assert.strictEqual(M.itemOnMyProviders({ streamingProviders: [{ name: 'Netflix' }] }, [8], { netflix: 1 }), true);
  assert.strictEqual(M.itemOnMyProviders({ streamingProviders: null }, [8]), false);
  assert.strictEqual(M.itemOnMyProviders({ streamingProviders: [] }, [8]), false);
});

test('plateformes d\'un titre : offres incluses (flatrate) du pays seulement, avec leur id', () => {
  const M = fresh();
  const d = { results: { FR: { link: 'https://x', flatrate: [{ provider_id: 8, provider_name: 'Netflix', logo_path: '/n.jpg' }], rent: [{ provider_id: 2, provider_name: 'Apple TV' }] }, US: { flatrate: [{ provider_id: 15 }] } } };
  assert.deepStrictEqual(M.mpProvidersOf(d), [{ id: 8, name: 'Netflix', logo: 'https://image.tmdb.org/t/p/w45/n.jpg', url: 'https://x' }]);
  assert.deepStrictEqual(M.mpProvidersOf({ results: {} }), []);
});

test('filtre de Ma liste : seulement si activé ET au moins une plateforme cochée', () => {
  const items = [{ id: 'a', streamingProviders: [{ id: NETFLIX }] }, { id: 'b', streamingProviders: [{ id: DISNEY }] }, { id: 'c', streamingProviders: null }];
  let M = fresh({ wl_my_providers: JSON.stringify([NETFLIX]) });
  assert.strictEqual(M.mpFilterItems(items).length, 3, 'filtre non activé');
  M = fresh({ wl_my_providers: JSON.stringify([NETFLIX]), wl_my_prov_filter: '1' });
  assert.deepStrictEqual(M.mpFilterItems(items).map(i => i.id), ['a']);
  M = fresh({ wl_my_providers: '[]', wl_my_prov_filter: '1' });
  assert.strictEqual(M.mpFilterOn(), false, 'aucune plateforme cochée : filtre sans effet');
  assert.strictEqual(M.mpFilterItems(items).length, 3);
});

test('rafraîchissement : titres « À voir » / « En cours » sans données récentes, au plus une fois par semaine', async () => {
  const M = fresh({ wl_my_providers: JSON.stringify([NETFLIX]) });
  const now = Date.now();
  const fetched = [];
  global.tf = url => { fetched.push(url); return Promise.resolve({ results: { FR: { flatrate: [{ provider_id: 8, provider_name: 'Netflix' }] } } }); };
  global.dbPut = (i, cb) => cb && cb();
  global.memDB = [
    { id: 1, tmdbId: 11, type: 'film', status: 'avoir' },
    { id: 2, tmdbId: 22, type: 'serie', tmdbType: 'tv', status: 'encours' },
    { id: 3, tmdbId: 33, type: 'serie', status: 'termine' },
    { id: 4, tmdbId: 44, type: 'film', status: 'avoir', providersAt: now - 3600000 },
    { id: 5, tmdbId: 55, type: 'film', status: 'avoir', deleted: true },
    { id: 6, tmdbId: 66, type: 'film', status: 'avoir', providersAt: now - 8 * 86400000 },
  ];
  assert.strictEqual(await M.mpRefresh(), 3);
  assert.deepStrictEqual(fetched.sort(), ['/api/tmdb/movie/11/watch/providers', '/api/tmdb/movie/66/watch/providers', '/api/tmdb/tv/22/watch/providers']);
  assert.deepStrictEqual(global.memDB[0].streamingProviders.map(p => p.id), [8]);
  assert.ok(global.memDB[0].providersAt > 0);
  assert.strictEqual(await M.mpRefresh(), 0, 'tout vient d\'être rafraîchi');
  const none = fresh({});
  fetched.length = 0;
  global.memDB[0].providersAt = 0;
  assert.strictEqual(await none.mpRefresh(), 0, 'aucune plateforme cochée : aucun appel');
  assert.deepStrictEqual(fetched, []);
});

test('catalogue : films et séries fusionnés, sans doublon, dans l\'ordre de mise en avant du pays', async () => {
  const M = fresh();
  global.tf = url => Promise.resolve(/movie/.test(url)
    ? { results: [{ provider_id: 8, provider_name: 'Netflix', display_priorities: { FR: 2 } }, { provider_id: 119, provider_name: 'Prime Video', display_priorities: { FR: 1 } }] }
    : { results: [{ provider_id: 8, provider_name: 'Netflix', display_priorities: { FR: 0 } }, { provider_id: 337, provider_name: 'Disney Plus', display_priorities: { FR: 3 } }] });
  const list = await M.mpCatalog();
  assert.deepStrictEqual(list.map(p => p.id), [8, 119, 337]);
});

test('proxy TMDB : la route du catalogue des plateformes est autorisée (avec le pays)', () => {
  delete require.cache[require.resolve(path.join(ROOT, 'api', 'tmdb.js'))];
  const tmdb = require(path.join(ROOT, 'api', 'tmdb.js'));
  for (const kind of ['movie', 'tv']) {
    const up = tmdb._buildUpstream(new URLSearchParams('path=/watch/providers/' + kind + '&language=fr-FR&watch_region=FR'));
    assert.ok(!up.error, kind + ' : ' + up.error);
  }
  assert.ok(tmdb._buildUpstream(new URLSearchParams('path=/watch/providers/person')).error);
});
