'use strict';
/*
 * CSP sans script-src-attr 'unsafe-inline' : plus aucun gestionnaire d'événement écrit dans le HTML
 * (onclick=, onchange=…), ni dans les fichiers .html ni dans le HTML produit par js/*.js.
 * Les boutons passent par data-click / data-change / data-input et la liste fermée de js/00-actions.js.
 * Lancer : node --test tests/
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const SKIP = new Set(['node_modules', 'vendor', '.git', 'target']);
function walk(dir, ext, out = []) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) walk(rel, ext, out);
    else if (e.name.endsWith(ext)) out.push(rel);
  }
  return out;
}
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
const INLINE = /\son[a-z]+\s*=\s*(?:["'`]|\\["'])/i;
const APP_JS = fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js')).map(f => 'js/' + f);

test('CSP : pas de script-src-attr ni de \'unsafe-inline\' / \'unsafe-eval\' pour les scripts', () => {
  const vercel = JSON.parse(read('vercel.json'));
  const csp = vercel.headers[0].headers.find(h => h.key === 'Content-Security-Policy').value;
  const dirs = Object.fromEntries(csp.split(';').map(d => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
  assert.strictEqual(dirs['script-src-attr'], undefined, 'script-src-attr retiré');
  assert.strictEqual(dirs['script-src-elem'], undefined);
  assert.deepStrictEqual(dirs['script-src'], ["'self'", 'https://challenges.cloudflare.com']);
  assert.ok(!/unsafe-eval|unsafe-hashes/.test(csp));
});

test('aucun attribut on*= dans les pages HTML (site, pages légales, extension, app de bureau)', () => {
  const files = walk('.', '.html').filter(f => !f.startsWith('e2e'));
  assert.ok(files.includes('index.html') && files.length >= 5, files.join(','));
  for (const f of files) {
    const m = stripComments(read(f)).match(INLINE);
    assert.strictEqual(m, null, f + ' : ' + (m && m[0]));
  }
});

test('aucun attribut on*= dans le HTML produit par js/*.js', () => {
  for (const f of APP_JS) {
    const m = stripComments(read(f)).match(INLINE);
    assert.strictEqual(m, null, f + ' : ' + (m && m[0]));
  }
});

test('chaque action utilisée dans le HTML existe dans la liste fermée de js/00-actions.js', () => {
  const src = read('js/00-actions.js');
  const known = new Set([...src.matchAll(/uiOn\('([\w]+)'/g)].map(m => m[1]));
  assert.ok(known.size >= 40, 'actions déclarées : ' + known.size);
  const used = new Set();
  for (const f of ['index.html', ...APP_JS.filter(f => f !== 'js/00-actions.js')]) {
    const s = stripComments(read(f));
    for (const m of s.matchAll(/data-(?:click|change|input)="(\w+)"/g)) used.add(m[1]);
    for (const m of s.matchAll(/uiAct\('(\w+)'/g)) used.add(m[1]);
    for (const m of s.matchAll(/_accBtn\(\[?'(\w+)'/g)) used.add(m[1]);
  }
  assert.ok(used.size >= 40, 'actions utilisées : ' + used.size);
  for (const a of used) assert.ok(known.has(a), 'action inconnue : ' + a);
  /* js/00-actions.js est chargé avant tous les autres modules de l'app */
  const html = read('index.html');
  assert.ok(html.indexOf('<script src="js/00-actions.js">') < html.indexOf('<script src="js/00-i18n.js">'));
  assert.ok(html.indexOf('<script src="js/00-actions.js">') > 0);
});

test('uiAct : nom et arguments échappés, relus à l\'identique', () => {
  const listeners = {};
  const ctx = { window: { addEventListener: (t, fn) => { listeners[t] = fn; } }, document: { addEventListener() {} }, setTimeout, JSON, String, Array, Object };
  vm.createContext(ctx);
  vm.runInContext(read('js/00-actions.js') + '\nthis.uiAct=uiAct;this.UI_ACTIONS=UI_ACTIONS;this.uiOn=uiOn;', ctx);
  const attr = ctx.uiAct('openPlex', ['a"b\'<c>&d']);
  assert.strictEqual(attr, ' data-click="openPlex" data-args="[&quot;a\\&quot;b&#39;&lt;c&gt;&amp;d&quot;]"');
  assert.strictEqual(ctx.uiAct('settingSelect', ['k'], 'change'), ' data-change="settingSelect" data-args="[&quot;k&quot;]"');
  assert.strictEqual(ctx.uiAct('toggleMenu'), ' data-click="toggleMenu"');
  /* Délégation : appel avec (élément, événement, ...arguments), arrêt si stopPropagation() */
  const calls = [];
  ctx.uiOn('t1', function (el, e, x) { calls.push(['t1', this === el, x]); });
  ctx.uiOn('t2', function (el, e) { calls.push(['t2']); e.stopPropagation(); });
  const mk = (attrs, parent) => ({
    parentElement: parent || null,
    getAttribute: k => (k in attrs ? attrs[k] : null),
    matches: () => false,
    closest(sel) { const k = sel.slice(1, -1); let n = this; while (n) { if (n.getAttribute(k) != null) return n; n = n.parentElement; } return null; },
  });
  const outer = mk({ 'data-click': 't1', 'data-args': '[42]' });
  const inner = mk({ 'data-click': 't1', 'data-args': '["in"]' }, outer);
  const ev = { target: inner, cancelBubble: false, stopPropagation() { this.cancelBubble = true; } };
  listeners.click(ev);
  assert.deepStrictEqual(calls, [['t1', true, 'in'], ['t1', true, 42]]);
  calls.length = 0;
  const stopper = mk({ 'data-click': 't2' }, outer);
  listeners.click({ target: stopper, cancelBubble: false, stopPropagation() { this.cancelBubble = true; } });
  assert.deepStrictEqual(calls, [['t2']], 'stopPropagation arrête les actions des parents');
  /* Une action inconnue (attribut injecté) n'appelle rien */
  calls.length = 0;
  listeners.click({ target: mk({ 'data-click': 'eval', 'data-args': '["alert(1)"]' }), cancelBubble: false, stopPropagation() {} });
  listeners.click({ target: mk({ 'data-click': 'constructor' }), cancelBubble: false, stopPropagation() {} });
  assert.deepStrictEqual(calls, []);
});
