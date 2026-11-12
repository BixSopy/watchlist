'use strict';
/*
 * Appareils de la landing rendus par Blender (landing/3d/ : lp3d.js, img/*.webp, manifest.json + hook dans js/23-landing.js) :
 * images locales (CSP), grille de poses complète, repli sur l'appareil CSS, aucune classe qui en masque une autre.
 * Rendu réel : e2e/landing3d.test.mjs. Lancer : node --test tests/
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const IMG = path.join(ROOT, 'landing/3d/img');

test('landing 3D : manifeste complet, une image WebP de face par appareil, poids raisonnable', () => {
  const man = JSON.parse(fs.readFileSync(path.join(IMG, 'manifest.json'), 'utf8'));
  let total = 0;
  for (const k of ['pc', 'tab', 'ph']) {
    const m = man[k];
    assert.ok(m, k + ' absent du manifeste');
    assert.strictEqual(m.front.length, 4, k + ' : 4 coins de la dalle');
    assert.ok(m.front.every(c => c.length === 2 && c.every(Number.isFinite)), k + ' : coins');
    assert.ok(m.W > 500 && m.H > 500 && m.rad >= 0 && m.down > 0.4 && m.up > 0.4, k + ' : métadonnées');
    /* traçabilité : le fichier .blend de Pierre dont l'image est le rendu (écran v2, iPad v2, téléphone v4 au 12/11) */
    assert.ok(/^[\w.-]+\.blend$/.test(m.src), k + ' : fichier source');
    /* dalle rectangulaire de face : coins alignés (translation + échelle suffisent pour y poser le HTML) */
    const f = m.front;
    assert.ok(Math.abs(f[0][1] - f[1][1]) < 1 && Math.abs(f[0][0] - f[3][0]) < 1 && f[1][0] > f[0][0] && f[3][1] > f[0][1], k + ' : dalle de face');
    const b = fs.readFileSync(path.join(IMG, m.file));
    assert.strictEqual(b.toString('latin1', 0, 4) + b.toString('latin1', 8, 12), 'RIFFWEBP', m.file);
    total += b.length;
  }
  assert.ok(total < 3e6, 'images trop lourdes : ' + total);
});

test('landing 3D : lp3d.js sans import ni URL externe (CSP), images résolues depuis le module', () => {
  const src = read('landing/3d/lp3d.js').split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.ok(!/^\s*import\b/m.test(src), 'aucun import');
  assert.ok(!/https?:\/\//.test(src), 'URL externe');
  assert.ok(/new URL\('\.\/img\/', import\.meta\.url\)/.test(src));
  assert.ok(!fs.existsSync(path.join(ROOT, 'landing/3d/three')) && !fs.existsSync(path.join(ROOT, 'landing/3d/models')), 'plus de Three.js ni de GLB');
});

test('landing 3D : deux canvas décoratifs, classe de <html> distincte de celle des canvas', () => {
  const html = read('index.html'), css = read('landing/landing.css'), js = read('js/23-landing.js');
  assert.ok(/<canvas class="lp-3d" id="lpDv3d" aria-hidden="true"><\/canvas><canvas class="lp-3d lp-3d-fx" id="lpDv3dFx" aria-hidden="true"><\/canvas><div class="lp-dv"/.test(html));
  /* régression : html.lp-3d recevait la règle .lp-3d{display:none} du canvas et blanchissait toute la page */
  assert.ok(!/classList\.(add|remove)\('lp-3d'\)/.test(js) && /toggle\('lp-3don'/.test(js));
  assert.ok(/html\.lp-3don \.lp-3d\{display:block\}/.test(css) && /^\.lp-3d\{display:none;/m.test(css));
  assert.ok(/\.lp-3d-fx\{z-index:4;mix-blend-mode:screen\}/.test(css));
});

test('landing 3D : repli sur l\'appareil CSS (mobile, ?lp3d=off, économie de données, erreur de chargement)', () => {
  const js = read('js/23-landing.js');
  assert.ok(/lp3d=\(off\|force\)/.test(js) && /L3q==='off'/.test(js));
  assert.ok(/innerWidth<=860/.test(js), 'pas de 3D sur mobile');
  assert.ok(/saveData/.test(js));
  assert.ok(/import\('\/landing\/3d\/lp3d\.js'\)[\s\S]*\.catch\(function\(\)\{L3=null;\}\)/.test(js), 'échec de chargement : on garde le CSS');
  assert.ok(/if\(!L3\.ready\(w3\)\)L3on=false;/.test(js), 'images pas prêtes : appareil CSS');
  /* pas de repli « lenteur » : il remplaçait l'appareil Blender par l'appareil CSS en cours de page (audit du 12/11) */
  assert.ok(!/L3slow|lp3dOff/.test(js));
  assert.ok(/if \(key === last\) return;/.test(read('landing/3d/lp3d.js')), 'pas de redessin quand rien ne change');
});

test('landing 3D : l\'appareil est fixe (ni curseur, ni inclinaison, ni flottement) et l\'écran HTML se pose par translation + échelle', () => {
  const js = read('js/23-landing.js');
  assert.ok(/fine=false;/.test(js), 'pas de suivi du curseur (demande de Pierre)');
  assert.ok(/var tilt=0,spin=0,float=0;/.test(js), 'ni inclinaison d\'intro, ni rotation de mue, ni flottement');
  assert.ok(/var rx=0,ry=0;/.test(js), 'ni dérive au défilement');
  assert.ok(!/lerp\(1\.06,1,seg\(g,\.3,1\.2\)\)/.test(js), 'pas de zoom d\'intro');
  assert.ok(/dv\.style\.transformOrigin='0 0';dv\.style\.transform=tr/.test(js) && /'px\) scale\('/.test(js));
});
