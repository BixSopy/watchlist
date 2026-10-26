'use strict';
/* Extension 0.8.1 : demande d'avis Chrome Web Store, jamais à l'installation, seulement après 10 épisodes
 * marqués automatiquement ; « Plus tard » (14 jours) / « Ne plus demander », état local. */
const test = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const { loadPopup, read } = require('./fixtures/popup-harness');

const TOK = { wlToken: 'jeton-secret-42' };

test('avis : caché à l\'installation et sous 10 épisodes', () => {
  assert.strictEqual(loadPopup({ store: { ...TOK } }).$('reviewAsk').hidden, true);
  assert.strictEqual(loadPopup({ store: { ...TOK, wlAutoEp: 9 } }).$('reviewAsk').hidden, true);
  assert.strictEqual(loadPopup({ store: { wlAutoEp: 50 } }).$('reviewAsk').hidden, true, 'pas sans jeton');
});

test('avis : affiché à 10 épisodes, « Laisser un avis » ouvre la page des avis et ne redemande plus', () => {
  const p = loadPopup({ store: { ...TOK, wlAutoEp: 10 } });
  assert.strictEqual(p.$('reviewAsk').hidden, false);
  assert.match(p.$('reviewSub').textContent, /^10 épisodes marqués automatiquement/);
  p.$('reviewYes').click();
  assert.deepStrictEqual(p.tabs, ['https://chromewebstore.google.com/detail/hmoafofdaajkenkodmgbdjejbmkdjicc/reviews']);
  assert.strictEqual(p.data.wlReview.state, 'done');
  assert.strictEqual(p.$('reviewAsk').hidden, true);
  assert.strictEqual(loadPopup({ store: { ...TOK, wlAutoEp: 99, wlReview: p.data.wlReview } }).$('reviewAsk').hidden, true);
});

test('avis : « Plus tard » = 14 jours, « Ne plus demander » = jamais', () => {
  const p = loadPopup({ store: { ...TOK, wlAutoEp: 12 } });
  const before = Date.now();
  p.$('reviewLater').click();
  assert.strictEqual(p.data.wlReview.state, 'later');
  assert.ok(p.data.wlReview.until >= before + 14 * 864e5 - 1000);
  assert.strictEqual(loadPopup({ store: { ...TOK, wlAutoEp: 12, wlReview: p.data.wlReview } }).$('reviewAsk').hidden, true);
  assert.strictEqual(loadPopup({ store: { ...TOK, wlAutoEp: 12, wlReview: { state: 'later', until: Date.now() - 1 } } }).$('reviewAsk').hidden, false);
  const q = loadPopup({ store: { ...TOK, wlAutoEp: 12 } });
  q.$('reviewNever').click();
  assert.strictEqual(q.data.wlReview.state, 'never');
  assert.strictEqual(loadPopup({ store: { ...TOK, wlAutoEp: 500, wlReview: q.data.wlReview } }).$('reviewAsk').hidden, true);
});

test('avis : textes en anglais', () => {
  const p = loadPopup({ lang: 'en', store: { ...TOK, wlAutoEp: 11 } });
  assert.strictEqual(p.$('reviewYes').textContent, 'Leave a review');
  assert.match(p.$('reviewSub').textContent, /^11 episodes marked/);
});

test('service worker : seuls les épisodes réellement marqués incrémentent wlAutoEp', async () => {
  let onMessage; const store = { wlToken: 'tok' };
  const responses = [{ status: 'updated' }, { status: 'not_found' }, { status: 'already_up_to_date' }, true];
  const ctx = {
    chrome: {
      runtime: { id: 'ext-id', getURL: p => p, onMessage: { addListener: fn => { onMessage = fn; } } },
      tabs: { create: () => {} },
      storage: { local: {
        get: (k, cb) => cb(Object.fromEntries([].concat(k).filter(x => x in store).map(x => [x, store[x]]))),
        set: (o, cb) => { Object.assign(store, JSON.parse(JSON.stringify(o))); if (cb) cb(); },
      } },
    },
    fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(responses.shift()) }),
    URL, Date, Number, JSON, Promise, Object, Math, isFinite,
    importScripts: (...files) => files.forEach(f => vm.runInContext(read('extension/' + f), ctx)),
  };
  ctx.self = ctx; vm.createContext(ctx);
  vm.runInContext(read('extension/background.js'), ctx);
  const call = msg => new Promise(res => { const r = onMessage(msg, { id: 'ext-id', tab: { id: 1 }, url: 'https://www.netflix.com/watch/1' }, res); if (r !== true) setTimeout(() => res(undefined), 5); });
  for (let e = 1; e <= 4; e++) { await call({ type: 'wl_watched', kind: 'episode', title: 'Dark', season: 1, episode: e }); await new Promise(r => setTimeout(r, 5)); }
  assert.strictEqual(store.wlAutoEp, 2, 'updated + legacy_updated');
});
