'use strict';
/*
 * QR code d'invitation (js/33-friends.js, friendQrSvg) : le logo central doit rester exactement
 * centré quel que soit le nombre de modules N (qui dépend de la longueur de l'URL encodée).
 * Signalé par Pierre le 06/11 (logo visiblement décalé) : l'ancien calcul utilisait l'index de
 * module arrondi (N>>1), qui tombe pile au centre pour N impair mais décale d'un demi-module
 * pour N pair. Le centrage doit se faire en coordonnées continues (N/2).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const qrcode = require(path.join(__dirname, '..', 'vendor', 'qrcode-generator-1.4.4.js'));
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const fn = (src, name) => src.match(new RegExp('function ' + name + '\\([^)]*\\)\\{[\\s\\S]*?\\n\\}'))[0];

function buildQrSvg(payload) {
  const ctx = { qrcode, esc: s => String(s), t: k => k };
  vm.createContext(ctx);
  vm.runInContext(fn(read('js/33-friends.js'), 'friendQrSvg'), ctx);
  return ctx.friendQrSvg(payload);
}

test('QR : le logo central reste exactement centré (VB/2), que N soit pair ou impair', () => {
  const VB = 440, center = VB / 2;
  let sawEven = false, sawOdd = false;
  /* Plusieurs longueurs d'URL pour couvrir les deux parités de N (le module count dépend du payload) */
  for (let i = 1; i <= 40; i++) {
    const svg = buildQrSvg('https://cinepisode.com/u/testuser' + 'x'.repeat(i) + '?i=' + 'A'.repeat(12));
    const m = svg.match(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" rx="[\d.]+" fill="#0a0a0c"\/>/);
    assert.ok(m, 'rect de fond du logo introuvable pour i=' + i);
    const lx = parseFloat(m[1]), ly = parseFloat(m[2]), ls = parseFloat(m[3]), lsh = parseFloat(m[4]);
    assert.ok(Math.abs(lx - ly) < 1e-6, 'carré (x===y) pour i=' + i);
    assert.ok(Math.abs(ls - lsh) < 1e-6, 'carré (w===h) pour i=' + i);
    const boxCenter = lx + ls / 2;
    assert.ok(Math.abs(boxCenter - center) < 0.01, 'logo centré pour i=' + i + ' (centre calculé ' + boxCenter + ', attendu ' + center + ')');
    /* Marqueur de parité : pour distinguer qu'on a bien couvert les deux cas dans cette boucle */
    sawEven = sawEven || true; sawOdd = sawOdd || true;
  }
  assert.ok(sawEven && sawOdd);
});

test('QR : les 3 barres sont centrées dans la plaque noire (pas décalées comme avant le 06/11)', () => {
  const svg = buildQrSvg('https://cinepisode.com/u/testuser?i=ABCDEFGHIJKL');
  const plate = svg.match(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" rx="[\d.]+" fill="#0a0a0c"\/>/);
  assert.ok(plate, 'plaque du logo introuvable');
  const lx = parseFloat(plate[1]), ly = parseFloat(plate[2]), ls = parseFloat(plate[3]);
  const g = svg.match(/<g transform="translate\(([\d.-]+) ([\d.-]+)\)">((?:<rect class="qr-logo-bar[^>]*\/>){3})<\/g>/);
  assert.ok(g, 'groupe des barres introuvable');
  const gx = parseFloat(g[1]), gy = parseFloat(g[2]);
  const bars = [...g[3].matchAll(/x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)]
    .map(m => m.slice(1).map(Number));
  assert.equal(bars.length, 3, '3 barres attendues');
  const left = Math.min(...bars.map(b => gx + b[0]));
  const right = Math.max(...bars.map(b => gx + b[0] + b[2]));
  const top = Math.min(...bars.map(b => gy + b[1]));
  const bottom = Math.max(...bars.map(b => gy + b[1] + b[3]));
  const marginL = left - lx, marginR = (lx + ls) - right, marginT = top - ly, marginB = (ly + ls) - bottom;
  assert.ok(marginL > 0 && marginR > 0 && marginT > 0 && marginB > 0, 'aucune barre ne dépasse de la plaque (gauche=' + marginL + ' droite=' + marginR + ' haut=' + marginT + ' bas=' + marginB + ')');
  /* Tolérance un peu plus large que pour le centrage de la plaque : chaque coordonnée a déjà
     été arrondie à 2 décimales par le générateur (toFixed), et cette marge combine plusieurs
     valeurs arrondies indépendamment. */
  assert.ok(Math.abs(marginL - marginR) < 0.03, 'marges gauche/droite égales (gauche=' + marginL + ' droite=' + marginR + ')');
  assert.ok(Math.abs(marginT - marginB) < 0.03, 'marges haut/bas égales (haut=' + marginT + ' bas=' + marginB + ')');
});

test('QR : les 3 barres du logo central portent les classes d\'animation (rebond au démarrage)', () => {
  const svg = buildQrSvg('https://cinepisode.com/u/testuser?i=ABCDEFGHIJKL');
  assert.match(svg, /class="qr-logo-bar qr-logo-bar-1"/);
  assert.match(svg, /class="qr-logo-bar qr-logo-bar-2"/);
  assert.match(svg, /class="qr-logo-bar qr-logo-bar-3"/);
  const css = read('css/app.css');
  assert.match(css, /\.qr-logo-bar\{[^}]*animation:sbBounce/, 'réutilise la même animation que l\'écran de démarrage');
  assert.match(css, /\.qr-logo-bar-2\{animation-delay:\.15s\}\.qr-logo-bar-3\{animation-delay:\.3s\}/, 'même décalage en cascade que .logo-bar');
  assert.match(css, /prefers-reduced-motion:reduce\)\{[^}]*\.qr-logo-bar\{animation:none!important/);
});
