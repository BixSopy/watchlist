'use strict';
/*
 * Appareils 3D de la landing (landing/3d/lp3d.js + hook dans js/23-landing.js) : modèles et Three.js servis
 * localement (CSP script-src 'self'), repli sur l'appareil CSS, aucune classe qui en masque une autre.
 * Rendu réel : e2e/landing3d.test.mjs. Lancer : node --test tests/
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('landing 3D : Three.js, chargeurs et modèles sont locaux et complets', () => {
  for (const f of ['landing/3d/lp3d.js', 'landing/3d/three/three.module.min.js', 'landing/3d/three/GLTFLoader.js',
    'landing/3d/three/BufferGeometryUtils.js', 'landing/3d/three/RoomEnvironment.js', 'landing/3d/three/LICENSE'])
    assert.ok(fs.existsSync(path.join(ROOT, f)), f + ' manquant');
  for (const f of ['studio-display', 'ipad-pro', 'telephone']) {
    const b = fs.readFileSync(path.join(ROOT, 'landing/3d/models/' + f + '.glb'));
    assert.strictEqual(b.toString('latin1', 0, 4), 'glTF', f + ' : pas un GLB');
    assert.ok(b.length > 50e3 && b.length < 800e3, f + ' : taille inattendue (' + b.length + ')');
  }
});

test('landing 3D : aucun import externe (CSP script-src self), chemins relatifs seulement', () => {
  for (const f of ['landing/3d/lp3d.js', 'landing/3d/three/GLTFLoader.js', 'landing/3d/three/BufferGeometryUtils.js', 'landing/3d/three/RoomEnvironment.js']) {
    const src = read(f).split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    for (const m of src.matchAll(/^\s*(?:import\b[^;]*?|\})\s*from\s*['"]([^'"]+)['"]/gm)) assert.ok(/^\.\//.test(m[1]), f + ' importe ' + m[1]);
  }
  assert.ok(!/https?:\/\//.test(read('landing/3d/lp3d.js').split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')), 'lp3d.js : URL externe');
  assert.ok(/new URL\(d\.url, import\.meta\.url\)/.test(read('landing/3d/lp3d.js')), 'les GLB doivent se résoudre depuis le module');
});

test('landing 3D : canvas décoratif, classe de <html> distincte de celle du canvas', () => {
  const html = read('index.html'), css = read('landing/landing.css');
  assert.ok(/<canvas class="lp-3d" id="lpDv3d" aria-hidden="true"><\/canvas><div class="lp-dv"/.test(html), 'canvas #lpDv3d juste avant .lp-dv');
  /* régression : html.lp-3d recevait la règle .lp-3d{display:none} du canvas et blanchissait toute la page */
  assert.ok(!/classList\.(add|remove)\('lp-3d'\)/.test(read('js/23-landing.js')), 'la classe de <html> doit être lp-3don');
  assert.ok(/html\.lp-3don \.lp-3d\{display:block\}/.test(css));
  assert.ok(/^\.lp-3d\{display:none;/m.test(css), 'le canvas reste masqué tant que le 3D n\'est pas prêt');
});

test('landing 3D : repli sur l\'appareil CSS (mobile, ?lp3d=off, économie de données, erreur, lenteur)', () => {
  const js = read('js/23-landing.js');
  assert.ok(/lp3d=\(off\|force\)/.test(js) && /L3q==='off'/.test(js));
  assert.ok(/innerWidth<=860/.test(js), 'pas de 3D sur mobile');
  assert.ok(/saveData/.test(js));
  assert.ok(/import\('\/landing\/3d\/lp3d\.js'\)[\s\S]*\.catch\(function\(\)\{L3=null;\}\)/.test(js), 'échec de chargement : on garde le CSS');
  assert.ok(/soft-gpu/.test(read('landing/3d/lp3d.js')), 'GPU logiciel refusé sauf ?lp3d=force');
  assert.ok(/L3slow>50&&L3q!=='force'\)lp3dOff\(\)/.test(js), 'filet de lenteur');
  assert.ok(/webglcontextlost/.test(read('landing/3d/lp3d.js')));
});

test('landing 3D : la caméra reproduit la transformation CSS (perspective 1800, rotateX inversé)', () => {
  const lp = read('landing/3d/lp3d.js'), js = read('js/23-landing.js');
  assert.ok(/DIST = 1800/.test(lp) && /perspective\(1800px\)/.test(js));
  assert.ok(/root\.rotation\.set\(-st\.rx \* D, st\.ry \* D, 0, 'XYZ'\)/.test(lp));
  assert.ok(/setViewOffset\(cw, ch, cw \/ 2 - st\.cx, ch \/ 2 - st\.cy, cw, ch\)/.test(lp));
});
