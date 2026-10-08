'use strict';
/*
 * Lisibilité des onglets (index.html) : l'onglet actif de la barre flottante gardait un texte noir
 * sur fond transparent, car « .nav.floating .ntab{background:transparent} » écrasait « .ntab.on ».
 * Vérifie que le fond d'accent est rétabli, que le focus clavier se voit, et les contrastes (WCAG AA).
 * Contrôle visuel complet : captures Playwright (voir la PR).
 * Lancer : node --test tests/
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const css = html.slice(html.indexOf('<style'), html.indexOf('</style>'));
const full = h => (h && h.length === 4 ? '#' + h.slice(1).split('').map(c => c + c).join('') : h);
const v = name => full((css.match(new RegExp('--' + name + ':(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})\\b')) || [])[1]);
function lum(h) {
  return [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0);
}
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

test('onglet actif de la barre flottante : fond d\'accent rétabli après la règle qui le rendait transparent', () => {
  const transparent = css.indexOf('.nav.floating .ntab{background:transparent}');
  const fix = css.indexOf('.nav.floating .ntab.on{background:var(--accent);color:var(--on-accent)}');
  assert.ok(transparent >= 0 && fix > transparent, 'la règle de l\'onglet actif doit suivre (et battre) celle du fond transparent');
  assert.match(css, /\.ntab\.on\{color:var\(--on-accent\);background:var\(--accent\)/);
  assert.match(css, /\.nav\.floating \.ntab\.on:hover\{background:var\(--accent-hover\)\}/, 'le survol ne doit pas effacer le fond de l\'onglet actif');
  assert.doesNotMatch(css, /\n\.nav\.floating \.ntab:hover\{/, 'survol des onglets réservé aux appareils à souris (@media (hover:hover))');
});

test('mobile : les onglets inactifs gardent leur fond de carte dans la barre flottante', () => {
  assert.match(css, /\.nav\.floating \.ntab:not\(\.on\)\{background:rgba\(255,255,255,\.055\)\}/);
});

test('focus clavier visible sur tous les onglets', () => {
  assert.match(css, /\.ntab:focus-visible,\.stab:focus-visible,\.auth-tab:focus-visible[^{]*\{outline:2px solid var\(--accent\)/);
});

test('contrastes WCAG AA : onglet actif, sous-onglet actif, pastille', () => {
  assert.ok(ratio(v('on-accent'), v('accent')) >= 4.5, 'texte de l\'onglet actif');
  assert.ok(ratio(v('on-accent'), v('accent-hover')) >= 4.5, 'texte de l\'onglet actif survolé');
  assert.ok(ratio(v('text'), v('bg3')) >= 4.5, 'onglet inactif');
  assert.ok(ratio(v('text2'), v('bg3')) >= 4.5, 'sous-onglet inactif');
  assert.match(css, /\.stab\.on,\.stab\.on:hover\{background:rgba\(var\(--accent-rgb\),\.16\);color:var\(--accent-hover\)/);
  assert.ok(ratio(v('accent-hover'), v('bg3')) >= 4.5, 'sous-onglet actif');
  const badge = (css.match(/\.det-badge\{[^}]*background:(#[0-9a-fA-F]{6})[^}]*color:(#fff)/) || []);
  assert.ok(badge[1], 'pastille : couleur de fond explicite');
  assert.ok(ratio('#ffffff', badge[1]) >= 4.5, 'chiffre blanc de la pastille');
  assert.doesNotMatch(css, /\.det-n\{opacity/, 'le compteur des filtres n\'est plus estompé');
});

test('contrastes WCAG AA : pastilles de source de l\'onglet « Détectés » (Netflix, Crunchyroll, Prime Video, direct)', () => {
  const base = css.match(/\.det-src\{[^}]*\}/);
  assert.ok(base && /background:var\(--bg2\)/.test(base[0]), 'fond explicite (celui des lignes)');
  for (const k of ['netflix', 'crunchyroll', 'prime', 'live', 'other']) {
    const m = css.match(new RegExp('\\.det-src-' + k + '\\b[^{]*\\{color:(#[0-9a-fA-F]{6})\\}'));
    assert.ok(m, 'couleur explicite : ' + k);
    assert.ok(ratio(m[1], v('bg2')) >= 4.5, k + ' sur le fond des lignes');
    assert.ok(ratio(m[1], v('bg3')) >= 4.5, k + ' sur le fond des cartes');
  }
});

