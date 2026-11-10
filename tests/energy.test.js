'use strict';
/*
 * Sobriété énergétique de l'affichage : pas de flou recalculé là où il ne se voit pas, animations
 * décoratives figées au repos (html.calm), déclarations d'animation valides.
 * Lancer : node --test tests/
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const css = read('css/app.css').replace(/\/\*[\s\S]*?\*\//g, '');
const rule = sel => { const m = css.match(new RegExp('(^|[}\\s])' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{([^}]*)\\}')); return m ? m[2] : null; };

test('aurora : aucun filter:blur (fondu porté par le dégradé), petits boutons des cartes sans backdrop-filter', () => {
  assert.doesNotMatch(rule('.aurora-blob'), /filter\s*:/);
  for (const b of ['.aurora-blob.b1', '.aurora-blob.b2', '.aurora-blob.b3']) assert.doesNotMatch(rule(b), /filter\s*:\s*blur/, b);
  assert.doesNotMatch(rule('.ibtn'), /backdrop-filter/);
  assert.doesNotMatch(rule('.ec-next'), /backdrop-filter/);
});

test('déclarations d\'animation valides : une seule direction par animation (« alternate reverse » est invalide)', () => {
  assert.doesNotMatch(css, /infinite\s+alternate\s+reverse/);
  assert.doesNotMatch(css, /\balternate\s+reverse\b/);
});

test('repos : chaque animation infinie décorative est figée sous html.calm', () => {
  const calm = css.match(/((?:html\.calm [^{,]+,?\s*)+)\{animation-play-state:paused\}/);
  assert.ok(calm, 'règle html.calm');
  const paused = calm[1].split(',').map(s => s.trim().replace(/^html\.calm /, ''));
  for (const sel of ['.logo em', '.aurora-blob', '.card-newep', '.det-empty-ic', '.fr-ghosts i', '.qr-h2 .qr-halo']) {
    assert.ok(paused.includes(sel), sel + ' figé au repos');
  }
});

function calmContext() {
  let now = 0; const timers = [];
  const listeners = {};
  const classes = new Set();
  const root = { classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c), toggle() {} }, style: { setProperty() {} }, getAttribute: () => null };
  const ctx = {
    document: { addEventListener() {}, documentElement: root, body: { classList: { toggle() {} } } },
    window: { addEventListener: (ev, fn) => { (listeners[ev] ||= []).push(fn); } },
    localStorage: { getItem: () => null, setItem() {} },
    setTimeout: (fn, ms) => { timers.push({ fn, at: now + ms }); return timers.length; },
    Date: { now: () => now }, Math, parseInt, Object, JSON, String, Number,
  };
  vm.createContext(ctx);
  vm.runInContext(read('js/10-settings-core.js'), ctx);
  const tick = ms => { now += ms; let again = true; while (again) { again = false; for (const t of timers) if (t.fn && t.at <= now) { const f = t.fn; t.fn = null; f(); again = true; } } };
  const fire = ev => (listeners[ev] || []).forEach(f => f());
  return { classes, tick, fire };
}

test('repos : html.calm après 8 s sans geste, retiré au premier geste, posé dès que la fenêtre passe en arrière-plan', () => {
  const { classes, tick, fire } = calmContext();
  tick(7000);
  assert.strictEqual(classes.has('calm'), false);
  fire('pointermove'); tick(7000);
  assert.strictEqual(classes.has('calm'), false, 'un geste repousse le repos');
  tick(1001);
  assert.strictEqual(classes.has('calm'), true);
  fire('keydown');
  assert.strictEqual(classes.has('calm'), false);
  fire('blur');
  assert.strictEqual(classes.has('calm'), true, 'fenêtre en arrière-plan');
  fire('focus');
  assert.strictEqual(classes.has('calm'), false);
});
