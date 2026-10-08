'use strict';
/*
 * Sons d'interface : fichiers de sounds/ (petits, déclarés, servis avec cache), chargement
 * paresseux avec repli sur la synthèse, volume général, survol limité, pas de sons empilés.
 * Lancer : node --test tests/
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const NAMES = ['open', 'close', 'add', 'done', 'del', 'err'];

test('sounds/ : les 6 fichiers MP3 existent, petits (< 16 Ko chacun, < 40 Ko au total)', () => {
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
  assert.ok(total < 40 * 1024, 'total ' + total);
  /* chaque fichier déclaré dans js/02-audio.js existe */
  const declared = [...read('js/02-audio.js').matchAll(/'\/sounds\/(\w+\.mp3)'/g)].map(m => m[1]).sort();
  assert.deepStrictEqual(declared, files);
});

test('sounds/ publié, mis en cache, et autorisé par la CSP (fetch en connect-src \'self\', pas de <audio>)', () => {
  assert.match(read('.vercelignore'), /^!sounds$/m);
  const vercel = JSON.parse(read('vercel.json'));
  const rule = vercel.headers.find(h => h.source === '/sounds/(.*)');
  assert.ok(rule, 'règle /sounds/');
  assert.match(rule.headers.find(h => h.key === 'Cache-Control').value, /max-age=\d{6,}/);
  const csp = vercel.headers[0].headers.find(h => h.key === 'Content-Security-Policy').value;
  assert.match(csp, /connect-src 'self'/);
  assert.match(csp, /media-src 'none'/);
  assert.doesNotMatch(read('js/02-audio.js'), /new Audio\(|createElement\(['"]audio/);
});

/* Contexte Web Audio simulé : compte les oscillateurs (synthèse) et les lectures de fichiers */
function audioContext({ fetchOk = true, decodeFails = [], hover = true, store = {} } = {}) {
  const log = { osc: 0, files: [], fetched: [] };
  class Node { constructor() { this.gain = { value: 1, setValueAtTime(v) { this.value = v; }, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }; this.frequency = { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }; this.Q = { value: 0 }; } connect(n) { this.out = n; return n; } start() {} stop() {} }
  class AC {
    constructor() { this.state = 'suspended'; this.currentTime = 0; this.sampleRate = 8000; this.destination = new Node(); }
    resume() { this.state = 'running'; return Promise.resolve(); }
    createGain() { return new Node(); }
    createBiquadFilter() { return new Node(); }
    createConvolver() { return new Node(); }
    createOscillator() { log.osc++; return new Node(); }
    createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
    createBufferSource() { const n = new Node(); n.start = () => { if (n.buffer && n.buffer.name) log.files.push(n.buffer.name); }; return n; }
    decodeAudioData(ab, ok, err) { const name = ab.name; if (decodeFails.includes(name)) { err(new Error('decode')); return Promise.reject(new Error('decode')).catch(() => {}); } ok({ name }); return Promise.resolve({ name }); }
  }
  let now = 1000000;
  const DateMock = { now: () => now };
  const ctx = {
    window: { AudioContext: AC, matchMedia: () => ({ matches: hover }) },
    document: { addEventListener() {}, removeEventListener() {} },
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    fetch: url => { log.fetched.push(url); const name = url.match(/(\w+)\.mp3/)[1]; return fetchOk ? Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve({ name }) }) : Promise.reject(new Error('offline')); },
    Promise, Math, Number, isFinite, parseInt, Object, Date: DateMock,
  };
  ctx.window.document = ctx.document;
  vm.createContext(ctx);
  vm.runInContext('var soundOn=true;\n' + read('js/02-audio.js') +
    '\nthis.sfx=sfx;this.loadSfxFiles=loadSfxFiles;this.loadSfxVolume=loadSfxVolume;this.setSfxVolume=setSfxVolume;this.sfxRecent=sfxRecent;this.state=function(){return _sfxState;};this.master=function(){return _master;};', ctx);
  return { ctx, log, tick: ms => { now += ms; } };
}

test('fichiers indisponibles : chaque son retombe sur sa synthèse (open → clic)', async () => {
  const { ctx, log } = audioContext({ fetchOk: false });
  await ctx.loadSfxFiles();
  assert.deepStrictEqual(Object.values(ctx.state()), NAMES.map(() => 'failed'));
  for (const n of NAMES) {
    const before = log.osc;
    ctx.sfx(n);
    assert.ok(log.osc > before, n + ' : synthèse jouée');
  }
  assert.deepStrictEqual(log.files, []);
});

test('fichiers chargés : joués depuis la mémoire ; un fichier non décodable retombe sur la synthèse', async () => {
  const { ctx, log } = audioContext({ decodeFails: ['err'] });
  /* avant chargement : synthèse, et le premier son lance le chargement */
  ctx.sfx('add');
  assert.ok(log.osc > 0);
  await ctx.loadSfxFiles();
  assert.strictEqual(log.fetched.length, 6, 'chaque fichier téléchargé une seule fois');
  log.osc = 0;
  for (const n of ['open', 'close', 'add', 'done', 'del']) ctx.sfx(n);
  assert.deepStrictEqual(log.files, ['open', 'close', 'add', 'done', 'del']);
  assert.strictEqual(log.osc, 0);
  ctx.sfx('err');
  assert.ok(log.osc > 0, 'err : décodage raté → synthèse');
  /* clic, épisode suivant, alerte : toujours synthétisés */
  log.osc = 0; ctx.sfx('click'); ctx.sfx('next'); ctx.sfx('toast');
  assert.ok(log.osc >= 3);
  assert.strictEqual(log.files.length, 5);
  await ctx.loadSfxFiles();
  assert.strictEqual(log.fetched.length, 6);
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

test('survol : seulement avec une souris, au plus une fois toutes les 80 ms', () => {
  let { ctx, log, tick } = audioContext({ hover: false });
  ctx.sfx('hover');
  assert.strictEqual(log.osc, 0, 'écran tactile : pas de son de survol');
  ({ ctx, log, tick } = audioContext({ hover: true }));
  ctx.sfx('hover'); ctx.sfx('hover');
  assert.strictEqual(log.osc, 1);
  tick(81); ctx.sfx('hover');
  assert.strictEqual(log.osc, 2);
});

test('pas de sons empilés : le carillon du toast est sauté juste après un son d\'action', () => {
  const { ctx, tick } = audioContext();
  assert.strictEqual(ctx.sfxRecent(300), false);
  ctx.sfx('hover');
  assert.strictEqual(ctx.sfxRecent(300), false, 'le survol ne compte pas');
  ctx.sfx('add');
  assert.strictEqual(ctx.sfxRecent(300), true);
  tick(301);
  assert.strictEqual(ctx.sfxRecent(300), false);
  assert.match(read('js/03-dom-utils.js'), /function toast\(msg,kind\)\{\s*if\(!\(typeof sfxRecent==='function'&&sfxRecent\(300\)\)\)sfx\('toast'\)/);
  /* l'alerte « nouveaux épisodes » garde son carillon synthétisé */
  assert.match(read('js/14-suivi.js'), /sfx\('toast'\)/);
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
