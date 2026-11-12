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

/* ---- Suite de l'audit (12/11, points 1 à 6 et 8 demandés par Pierre) ---- */

test('mobile : accueil en bas du premier écran (sous l\'appareil), vraie marge, pas de bloc noir à bord net', () => {
  const css = read('landing/landing.css');
  /* ancrage en bas par top:100% + translateY(-100%) : avec flex-end, tout le bloc était compté comme décalé (CLS 0,19)
     dès que sa hauteur changeait au chargement (langue du visiteur, polices) */
  assert.ok(/\.lp-ch\[data-ch="0"\]\{position:relative;min-height:calc\(100vh - 65px\)/.test(css));
  assert.ok(!/\.lp-ch\[data-ch="0"\]\{[^}]*align-items:flex-end/.test(css), 'plus de flex-end sur l\'accueil');
  assert.ok(/\.lp-ch\[data-ch="0"\] \.lp-ch-t\{position:absolute;top:100%;inset-inline:0;width:100%;transform:translateY\(-100%\);padding:40px 20px /.test(css), 'ancrage stable + marge latérale de 20 px');
  /* boutons empilés sur téléphone : sur une rangée, le second passait ou non à la ligne selon la langue */
  assert.ok(/@media \(max-width:480px\)\{\s*\.lp-ch\[data-ch="0"\] \.lp-cta-row\{flex-direction:column;flex-wrap:nowrap\}/.test(css));
  assert.ok(!/\.lp-ch\[data-ch="0"\] \.lp-ch-t\{[^}]*padding:0 4px/.test(css));
  assert.ok(/linear-gradient\(180deg,transparent,rgba\(0,0,0,\.7\) 48px,rgba\(0,0,0,\.7\) calc\(100% - 56px\),transparent\)/.test(css), 'voile fondu en haut et en bas');
});

test('mobile : paragraphe entier dans le bandeau de texte, bandeau plafonné pour ne pas recouvrir l\'appareil', () => {
  const css = read('landing/landing.css'), js = read('js/23-landing.js');
  assert.ok(/\.lp-j-mtext \.lp-p\{[^}]*-webkit-line-clamp:6/.test(css));
  assert.ok(!/\.lp-j-mtext \.lp-p\{[^}]*-webkit-line-clamp:1[;}]/.test(css));
  assert.ok(/max-height:min\(calc\(56svh - 86px\),330px\)/.test(css));
  /* le JS réserve à l'appareil le complément de ce plafond : les deux constantes vont ensemble */
  assert.ok(/bhM=Math\.max\(vh\*\.42,vh-111-Math\.min\(\.56\*vh-86,330\)\)/.test(js));
});

test('mobile : PC et tablette mis en page sur une surface logique plus petite (contenu des écrans plus grand)', () => {
  const js = read('js/23-landing.js');
  const m = js.match(/var LP_DEV_M=\[\{w:(\d+),h:(\d+)[^\]]*\{w:(\d+),h:(\d+)[^\]]*\{w:(\d+),h:(\d+)/);
  assert.ok(m, 'LP_DEV_M');
  assert.ok(+m[1] <= 640 && +m[3] <= 480, 'PC ≤ 640 px, tablette ≤ 480 px de large : ' + m.slice(1).join(','));
  assert.ok(/DEVS=mob\?LP_DEV_M:LP_DEV/.test(js));
  assert.ok(/translateX\(calc\(var\(--pg,0\)\*\(var\(--iw,856px\) - 44px\)\)\)/.test(read('landing/landing.css')), 'le curseur du lecteur suit la largeur réelle de l\'écran');
});

test('ordinateur : le texte d\'un chapitre reste jusqu\'à l\'arrivée du suivant (plus de colonne vide), appareil agrandi', () => {
  const js = read('js/23-landing.js');
  assert.ok(/var hand=function\(j\)\{if\(mob\)return \.5;var Y=Math\.max\(\.8\*vh,70\+1\.5\*\(ths\[j\]\|\|0\)\);return Math\.min\(\.5,\(Y-\.38\*vh\)\/\(hs\[j\]\|\|vh\)\);\};/.test(js));
  assert.ok(/g>=\(i===0\?-1:i-hand\(i-1\)\)&&\(last\|\|g<i\+1-hand\(i\)\)/.test(js));
  assert.ok(/:vw\*\.5,bh=mob\?lerp\(bhM,h8,ch8\):vh\*\.78,/.test(js), 'appareil : 50 vw × 78 vh');
  assert.ok(/cy-=Math\.max\(0,sTop-\(scrollY\|\|0\)\);/.test(js), 'l\'appareil ne bouge pas pendant les premiers pixels de défilement');
});

test('poids : la liste des langues n\'utilise plus de police web (noms en arabe, hindi, bengali, ourdou, russe)', () => {
  assert.ok(/\.lang-pick\{font-family:system-ui,/.test(read('css/app.css')));
});

test('nettoyage : plus de classes mortes dans landing.css, !important réservés aux cas nécessaires', () => {
  const css = read('landing/landing.css');
  for (const c of ['lp-ck', 'lp-cta-b', 'lp-glow', 'lp-h3', 'lp-h4', 'lp-ic', 'lp-list', 'lp-spot'])
    assert.ok(!new RegExp('\\.' + c + '(?![a-zA-Z0-9_-])').test(css), c + ' encore présent');
  assert.ok(!/@keyframes lpDrift/.test(css));
  const n = (css.match(/!important/g) || []).length;
  assert.ok(n <= 26, '!important : ' + n);
});
