'use strict';
/*
 * Garde-fous issus de l'audit visuel de la landing (12/11) : accueil toujours sombre, titre calé sur la hauteur
 * d'écran, typographie française. Rendu réel : e2e/landing-audit.test.mjs. Lancer : node --test tests/
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('accueil toujours sombre : le thème clair de l\'OS ne s\'applique pas à html.lp-guest', () => {
  const js = read('js/00-theme.js'), css = read('landing/landing.css');
  assert.ok(/function guest\(\)\{return document\.documentElement\.classList\.contains\('lp-guest'\);\}/.test(js));
  assert.ok(/if\(guest\(\)\)return 'dark';/.test(js));
  assert.ok(/MutationObserver/.test(js), 'le thème se recale à la connexion / déconnexion');
  assert.ok(/html\.lp-guest\{color-scheme:dark\}/.test(css));
  assert.ok(/\.lp-foot \.lang-pick\{color:#e6e7ec;background-color:#0d0e12\}/.test(css), 'liste de langues lisible');
});

test('écrans peu hauts : le titre d\'accueil se cale sur la hauteur (bouton principal visible)', () => {
  const css = read('landing/landing.css');
  assert.ok(/@media \(min-width:861px\) and \(max-height:880px\)\{[^@]*\.lp-j-h1\{font-size:min\(clamp\([^)]*\),7\.9vh\)/.test(css));
  assert.ok(/sTop=S\.getBoundingClientRect\(\)\.top\+y/.test(read('js/23-landing.js')), 'la scène tient compte de son décalage en haut de page');
});

test('typographie française de la landing : apostrophes courbes, espaces insécables avant ? ! ; : »', () => {
  const fr = read('js/i18n/fr.js');
  const vals = [...fr.matchAll(/^\s*"(lp\.[^"]+)":\s*"((?:[^"\\]|\\.)*)",?\s*$/gm)];
  assert.ok(vals.length > 100, 'chaînes lp.* trouvées : ' + vals.length);
  for (const [, k, v] of vals) {
    assert.ok(!/[A-Za-zÀ-ÿ]'[A-Za-zÀ-ÿ«]/.test(v), k + ' : apostrophe droite');
    assert.ok(!/ [?!;:»]/.test(v), k + ' : espace sécable avant ponctuation haute');
    assert.ok(!/« /.test(v), k + ' : espace sécable après «');
  }
});

test('compteurs animés : chiffres à largeur fixe', () => {
  assert.ok(/#landing \[data-to\],\.lp-j-step-count,\.lp-pl-time\{font-variant-numeric:tabular-nums\}/.test(read('landing/landing.css')));
});
