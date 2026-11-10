'use strict';
/*
 * Sons d'interface : 9 fichiers de sounds/ (petits, déclarés, servis avec cache), chargement paresseux,
 * aucune synthèse ni son de survol, bandeaux d'information muets, volume général, mise en veille du contexte audio.
 * Lancer : node --test tests/
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const NAMES = ['click', 'open', 'close', 'next', 'toast', 'add', 'done', 'del', 'err'];

test('sounds/ : les 9 fichiers MP3 existent, petits (< 16 Ko chacun, < 48 Ko au total)', () => {
  const files = fs.readdirSync(path.join(ROOT, 'sounds')).sort();
  assert.deepStrictEqual(files, NAMES.map(n => n + '.mp3').sort());
  let total = 0;
  for (const f of files) {
    const buf = fs.readFileSync(path.join(ROOT, 'sounds', f));
    total += buf.length;
    assert.ok(buf.length > 500 && buf.length < 16 * 1024, f + ' : ' + buf.length + ' octets');
    const id3 = buf.slice(0, 3).toString() === 'ID3';
    const sync = buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0;
    assert.ok(id3 || sync, f + ' : pas un MP3');
  }
  assert.ok(total < 48 * 1024, 'total ' + total);
  /* chaque fichier déclaré dans js/02-audio.js existe */
  const declared = [...read('js/02-audio.js').matchAll(/'\/sounds\/(\w+\.mp3)'/g)].map(m => m[1]).sort();
  assert.deepStrictEqual(declared, files);
});

test('sounds/ publié, mis en cache, et autorisé par la CSP (fetch en connect-src \'self\', pas de <audio>)', () => {
  assert.doesNotMatch(read('.vercelignore'), /^sounds$/m);
  const vercel = JSON.parse(read('vercel.json'));
  const rule = vercel.headers.find(h => h.source === '/sounds/(.*)');
  assert.ok(rule, 'règle /sounds/');
  assert.match(rule.headers.find(h => h.key === 'Cache-Control').value, /max-age=\d{6,}/);
  const csp = vercel.headers[0].headers.find(h => h.key === 'Content-Security-Policy').value;
  assert.match(csp, /connect-src 'self'/);
  assert.match(csp, /media-src 'none'/);
  assert.doesNotMatch(read('js/02-audio.js'), /new Audio\(|createElement\(['"]audio/);
});

test('plus de synthèse ni de son de survol dans le code', () => {
  const audio = read('js/02-audio.js');
  assert.doesNotMatch(audio, /createOscillator|createConvolver|function tone\(/);
  const all = fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js')).map(f => read('js/' + f)).join('\n') + read('index.html');
  assert.doesNotMatch(all, /data-sfx-hover|sfx\('hover'\)/);
  /* tout nom de son utilisé dans le code a son fichier */
  const used = new Set([...all.matchAll(/sfx\('(\w+)'\)/g)].map(m => m[1]));
  for (const n of used) assert.ok(NAMES.includes(n), 'sfx(\'' + n + '\') sans fichier');
});

/* Contexte Web Audio simulé : compte les lectures de fichiers et les mises en veille */
function audioContext({ fetchOk = true, decodeFails = [], store = {} } = {}) {
  const log = { osc: 0, files: [], fetched: [], suspended: 0 };
  const timers = [];
  class Node { constructor() { this.gain = { value: 1, setValueAtTime(v) { this.value = v; } }; } connect(n) { this.out = n; return n; } start() {} stop() {} }
  class AC {
    constructor() { this.state = 'suspended'; this.currentTime = 0; this.destination = new Node(); }
    resume() { this.state = 'running'; return Promise.resolve(); }
    suspend() { this.state = 'suspended'; log.suspended++; return Promise.resolve(); }
    createGain() { return new Node(); }
    createOscillator() { log.osc++; return new Node(); }
    createBufferSource() { const n = new Node(); n.start = () => { if (n.buffer && n.buffer.name) log.files.push(n.buffer.name); }; return n; }
    decodeAudioData(ab, ok, err) { const name = ab.name; if (decodeFails.includes(name)) { err(new Error('decode')); return Promise.reject(new Error('decode')).catch(() => {}); } ok({ name }); return Promise.resolve({ name }); }
  }
  let now = 1000000;
  const ctx = {
    window: { AudioContext: AC },
    document: { addEventListener() {}, removeEventListener() {} },
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    fetch: url => { log.fetched.push(url); const name = url.match(/(\w+)\.mp3/)[1]; return fetchOk ? Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve({ name }) }) : Promise.reject(new Error('offline')); },
    setTimeout: (fn, ms) => { timers.push({ fn, at: now + ms }); return timers.length; },
    clearTimeout: id => { if (timers[id - 1]) timers[id - 1].fn = null; },
    Promise, Math, Number, isFinite, parseInt, Object, Date: { now: () => now },
  };
  ctx.window.document = ctx.document;
  vm.createContext(ctx);
  vm.runInContext('var soundOn=true;\n' + read('js/02-audio.js') +
    '\nthis.sfx=sfx;this.loadSfxFiles=loadSfxFiles;this.loadSfxVolume=loadSfxVolume;this.setSfxVolume=setSfxVolume;this.state=function(){return _sfxState;};this.master=function(){return _master;};this.ac=function(){return actx;};', ctx);
  const tick = ms => { now += ms; for (const t of timers) if (t.fn && t.at <= now) { const f = t.fn; t.fn = null; f(); } };
  return { ctx, log, tick };
}

test('fichiers indisponibles : silence, aucune synthèse de remplacement, aucune erreur', async () => {
  const { ctx, log } = audioContext({ fetchOk: false });
  await ctx.loadSfxFiles();
  assert.deepStrictEqual(Object.values(ctx.state()), NAMES.map(() => 'failed'));
  for (const n of NAMES) ctx.sfx(n);
  assert.strictEqual(log.osc, 0);
  assert.deepStrictEqual(log.files, []);
});

test('fichiers chargés : joués depuis la mémoire, chacun téléchargé une seule fois ; un fichier non décodable reste muet', async () => {
  const { ctx, log } = audioContext({ decodeFails: ['err'] });
  await ctx.loadSfxFiles();
  assert.strictEqual(log.fetched.length, 9);
  for (const n of NAMES) ctx.sfx(n);
  assert.deepStrictEqual(log.files, NAMES.filter(n => n !== 'err'));
  assert.strictEqual(log.osc, 0);
  ctx.sfx('hover');
  assert.strictEqual(log.files.length, 8, 'survol : aucun son');
  await ctx.loadSfxFiles();
  assert.strictEqual(log.fetched.length, 9);
});

test('premier geste : un son demandé pendant le chargement est joué s\'il arrive à temps', async () => {
  const { ctx, log } = audioContext();
  ctx.sfx('click'); /* lance le chargement */
  await ctx.loadSfxFiles();
  await new Promise(r => setImmediate(r));
  assert.deepStrictEqual(log.files, ['click']);
});

test('énergie : le contexte audio se met en veille après 15 s sans son, et se réveille au son suivant', async () => {
  const { ctx, log, tick } = audioContext();
  await ctx.loadSfxFiles();
  ctx.sfx('open');
  assert.strictEqual(ctx.ac().state, 'running');
  tick(10000); ctx.sfx('close'); tick(10000);
  assert.strictEqual(log.suspended, 0, 'un son récent repousse la veille');
  tick(5001);
  assert.strictEqual(log.suspended, 1);
  assert.strictEqual(ctx.ac().state, 'suspended');
  ctx.sfx('click');
  assert.strictEqual(ctx.ac().state, 'running');
  assert.deepStrictEqual(log.files, ['open', 'close', 'click']);
});

test('volume : wl_snd_vol (0-100, 50 par défaut) appliqué au volume général', () => {
  let { ctx } = audioContext();
  assert.strictEqual(ctx.loadSfxVolume(), 50);
  ({ ctx } = audioContext({ store: { wl_snd_vol: '20' } }));
  assert.strictEqual(ctx.loadSfxVolume(), 20);
  ctx.sfx('click'); /* crée le contexte et le volume général */
  assert.strictEqual(ctx.master().gain.value, 0.2);
  ctx.setSfxVolume(0.8);
  assert.strictEqual(ctx.master().gain.value, 0.8);
  ctx.setSfxVolume(7);
  assert.strictEqual(ctx.master().gain.value, 1);
  ({ ctx } = audioContext({ store: { wl_snd_vol: 'n/a' } }));
  assert.strictEqual(ctx.loadSfxVolume(), 50);
});

test('bandeaux d\'information muets : seul le module des sorties joue le son « toast »', () => {
  const code = read('js/03-dom-utils.js').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(code, /sfx\(/);
  assert.match(read('js/14-suivi.js'), /sfx\('toast'\)/);
  const users = fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js') && /sfx\('toast'\)/.test(read('js/' + f).replace(/\/\*[\s\S]*?\*\//g, '')));
  assert.deepStrictEqual(users, ['14-suivi.js']);
});

test('ouverture des fenêtres : son « open » au lieu de « click » (fiche, ajout, édition, compte, stats, dossiers, recherche)', () => {
  const actions = read('js/00-actions.js');
  for (const a of ['openPlex', 'editEntry', 'openPlexRecoCard', 'openAdd', 'openFolder', 'folderItem']) {
    assert.match(actions, new RegExp("uiOn\\('" + a + "',[^\\n]*sfx\\('open'\\)"), a);
  }
  assert.match(read('js/20-account.js'), /function openAuthModal\(view,ctx\)\{\s*if\(typeof sfx==='function'\)sfx\('open'\)/);
  assert.match(read('js/16-stats.js'), /sfx\('open'\)/);
  assert.strictEqual((read('js/19-search-modal.js').match(/sfx\('open'\);openSearchModal/g) || []).length, 2);
});
