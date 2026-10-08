'use strict';
/*
 * Extension navigateur : messages postMessage stricts (origine, fenêtre, forme), aucun '*',
 * aucune trace console, aucun fichier de diagnostic resté dans le dossier.
 * Lancer : node --test tests/
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const EXT_JS = ['extension/background.js', 'extension/options.js',
  ...fs.readdirSync(path.join(ROOT, 'extension/content')).map(f => 'extension/content/' + f)];

test('extension : chaque script du dossier content/ est déclaré dans le manifeste (pas de fichier de diagnostic orphelin)', () => {
  const manifest = JSON.parse(read('extension/manifest.json'));
  const declared = new Set(manifest.content_scripts.flatMap(c => c.js));
  for (const f of declared) assert.ok(fs.existsSync(path.join(ROOT, 'extension', f)), 'absent : ' + f);
  for (const f of fs.readdirSync(path.join(ROOT, 'extension/content'))) assert.ok(declared.has('content/' + f), 'non déclaré : ' + f);
  assert.ok(!fs.readdirSync(path.join(ROOT, 'extension/content')).some(f => /diag/i.test(f)));
  for (const c of manifest.content_scripts) for (const m of c.matches) assert.match(m, /^https:\/\/www\.netflix\.com\//);
});

test('extension : ni postMessage vers \'*\', ni trace dans la console', () => {
  for (const f of EXT_JS) {
    const src = read(f).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(src, /postMessage\([^;]*['"]\*['"]\s*\)/, f);
    assert.doesNotMatch(src, /console\.(log|debug|info|warn|error)/, f);
  }
  assert.match(read('extension/content/netflix-main.js'), /postMessage\([^;]*window\.location\.origin\)/);
});

function bridge() {
  const listeners = [];
  const sent = [];
  const win = { location: { origin: 'https://www.netflix.com' }, addEventListener: (t, fn) => { if (t === 'message') listeners.push(fn); } };
  const ctx = { window: win, chrome: { runtime: { sendMessage: (m, cb) => { sent.push(m); if (cb) cb(); }, lastError: undefined } }, Number };
  vm.createContext(ctx);
  vm.runInContext(read('extension/content/netflix-bridge.js'), ctx);
  const post = (data, extra = {}) => listeners.forEach(fn => fn(Object.assign({ source: win, origin: 'https://www.netflix.com', data }, extra)));
  return { post, sent, win };
}

test('relai Netflix : seuls les messages de la même fenêtre, de netflix.com et de la bonne forme passent', () => {
  const { post, sent } = bridge();
  const ok = { __wl: true, type: 'wl_watched', title: ' Dahmer ', season: 1, episode: 3 };
  post(ok);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(sent)), [{ type: 'wl_watched', title: 'Dahmer', season: 1, episode: 3 }]);
  post({ __wl: true, type: 'wl_watched', title: 'Film', season: null, episode: null });
  assert.strictEqual(sent.length, 2);
  /* rejetés */
  post(ok, { source: {} });                               /* autre fenêtre (iframe, popup) */
  post(ok, { origin: 'https://evil.example' });           /* autre origine */
  post(ok, { origin: 'null' });
  post({ __wl: true, title: 'x', season: 1, episode: 1 }); /* type manquant */
  post({ ...ok, title: '' });
  post({ ...ok, title: 'x'.repeat(301) });
  post({ ...ok, title: { toString: () => 'x' } });
  post({ ...ok, season: '1' });
  post({ ...ok, episode: -1 });
  post({ ...ok, episode: 1.5 });
  post('wl_watched');
  post(null);
  assert.strictEqual(sent.length, 2);
});

test('service worker : expéditeur vérifié (cette extension, onglet netflix.com) et message revalidé', async () => {
  let onMessage;
  const fetches = [];
  const ctx = {
    chrome: {
      runtime: { id: 'ext-id', onMessage: { addListener: fn => { onMessage = fn; } } },
      storage: { local: { get: (k, cb) => cb({ wlToken: 'tok' }) } },
    },
    fetch: (url, opts) => { fetches.push(JSON.parse(opts.body)); return Promise.resolve({ ok: true, json: () => Promise.resolve(true) }); },
    URL, Date, Number, JSON, Promise,
  };
  vm.createContext(ctx);
  vm.runInContext(read('extension/background.js'), ctx);
  const call = (msg, sender) => new Promise(res => { const r = onMessage(msg, sender, res); if (r !== true) setTimeout(() => res(undefined), 5); });
  const msg = { type: 'wl_watched', title: 'Dahmer', season: 1, episode: 3 };
  const tab = { id: 1 };
  assert.strictEqual((await call(msg, { id: 'autre', tab, origin: 'https://www.netflix.com' })).reason, 'sender');
  assert.strictEqual((await call(msg, { id: 'ext-id', origin: 'https://www.netflix.com' })).reason, 'sender'); /* pas d'onglet */
  assert.strictEqual((await call(msg, { id: 'ext-id', tab, origin: 'https://evil.example' })).reason, 'sender');
  assert.strictEqual((await call(msg, { id: 'ext-id', tab, url: 'https://evil.example/watch/1' })).reason, 'sender');
  assert.strictEqual((await call({ ...msg, season: '1' }, { id: 'ext-id', tab, origin: 'https://www.netflix.com' })).reason, 'invalid');
  assert.strictEqual(fetches.length, 0);
  const r = await call(msg, { id: 'ext-id', tab, url: 'https://www.netflix.com/watch/123' });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(fetches, [{ p_token: 'tok', p_title: 'Dahmer', p_season: 1, p_episode: 3 }]);
});
