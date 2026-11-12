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

test('textes des chapitres : un seul à la fois, échangé au même instant que l\'écran (fenêtre g ∈ [i, i+1) de la scène)', () => {
  const js = read('js/23-landing.js'), css = read('landing/landing.css');
  /* la bascule à mi-chapitre (g = i ± 0,5, puis hand()) affichait le texte suivant sur l'écran du chapitre précédent */
  assert.ok(!/hand\(/.test(js) && !/g>=i-\.5/.test(js));
  assert.ok(/else if\(i===0\)on=g<1;\s*else on=g>=i&&\(last\|\|g<\(mob&&i===7\?7\.5:i\+1\)\)&&\(i!==1\|\|heroGone\);/.test(js));
  assert.ok(/var heroGone=sy>=hb0-sTop;/.test(js), 'le chapitre 1 attend la sortie du texte d\'accueil');
  /* mêmes bornes entières que le fondu des scènes */
  assert.ok(/var RG=\{0:\[-1,2\],2:\[2,3\],3:\[3,4\],4:\[4,5\],5:\[5,6\],6:\[6,7\],7:\[7,8\],8:\[8,10\]\};/.test(js));
  /* ordinateur : textes 1 à 7 épinglés, remplacés sur place (sortie 0,2 s puis entrée) ; rien sans JavaScript */
  assert.ok(/document\.documentElement\.classList\.add\('lp-pin'\);/.test(js));
  assert.ok(/html\.lp-pin \.lp-ch:not\(\[data-ch="0"\]\):not\(\[data-ch="8"\]\) \.lp-ch-t\{position:fixed;left:clamp\(20px,5vw,72px\);width:min\(36vw,520px\)\}/.test(css));
  assert.ok(/html\.lp-pin \.lp-ch:not\(\[data-ch="0"\]\):not\(\.on\) \.lp-ch-t>\*\{opacity:0\}/.test(css), 'un seul texte, même sans animation');
  assert.ok(/html\.lp-pin \.lp-ch:not\(\[data-ch="0"\]\):not\(\.on\) \.lp-ch-t\{pointer-events:none\}/.test(css));
  assert.ok(/html\.lp-pin\.lp-anim \.lp-ch:not\(\[data-ch="0"\]\):not\(\.on\) \.lp-ch-t>\*\{transition:opacity \.2s linear,transform 0s linear \.2s\}/.test(css));
  assert.ok(/html\.lp-pin\.lp-anim \.lp-ch\.on \.lp-ch-t>\*\{transition-delay:\.22s\}/.test(css), 'l\'entrant attend la sortie du précédent');
  assert.ok(/:vw\*\.5,bh=mob\?lerp\(bhM,h8,ch8\):vh\*\.78,/.test(js), 'appareil : 50 vw × 78 vh');
  assert.ok(/cy-=Math\.max\(0,sTop-sy\);/.test(js), 'l\'appareil ne bouge pas pendant les premiers pixels de défilement');
});

test('retour sur l\'accueil après une session (déconnexion, session expirée) : les animations sont remises', () => {
  const js = read('js/23-landing.js');
  /* sans lp-anim : tous les textes de chapitre affichés (par paires, superposés) et vignettes de « Détectés » déjà là */
  assert.ok(/r\.classList\.remove\('lp-member'\);r\.classList\.add\('lp-guest'\);[\s\S]{0,700}if\(!_lpReduced\(\)\)r\.classList\.add\('lp-anim'\);\s*_lpSetup\(view\|\|'login'\);/.test(js));
  assert.ok(/if\(!member&&!\(window\.matchMedia&&window\.matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches\)\)root\.classList\.add\('lp-anim'\)/.test(read('js/00-landing-gate.js')), 'même règle que le chargement initial');
});

test('écran final : dégradés de la marque à la place du bleu uni (variables de marque, aucun hex recopié)', () => {
  const css = read('landing/landing.css');
  assert.ok(/\.lp-s-cta \.lp-cta-w em\{background:var\(--violet-grad\);background-size:200% 100%;-webkit-background-clip:text;background-clip:text;color:transparent/.test(css), '« episode » : dégradé glacé du logo');
  assert.ok(/html\.lp-anim \.lp-s-cta \.lp-cta-w em\{animation:logoGradDrift 14s ease-in-out infinite alternate\}/.test(css) && /@keyframes logoGradDrift/.test(read('css/app.css')));
  assert.ok(/\.lp-s-cta::before\{content:"";position:absolute;inset:0;background:var\(--p3-grad\);/.test(css), 'halo : dégradé dominant, sans filtre de flou');
  assert.ok(!/\.lp-s-cta::before\{[^}]*filter/.test(css));
  assert.ok(/\.lp-j-steps-line i\{[^}]*background:var\(--p3-grad\)/.test(css) && !/#5b4fe0|#1fb8a3/i.test(css), 'plus de hex du dégradé recopié à la main');
  assert.ok(/\.lp-j-step-count\{[^}]*background:var\(--p3-grad\)/.test(css) && /\.lp-j-step-ic::after\{[^}]*background:var\(--p3-grad\)/.test(css));
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

test('fluidité : aucune lecture de mise en page entre deux écritures dans frame(), fond teinté sans repeinture, écrans cachés hors calcul', () => {
  const js = read('js/23-landing.js'), css = read('landing/landing.css');
  const frame = js.slice(js.indexOf('function frame(now){'), js.indexOf('function req(){')).replace(/\/\*[\s\S]*?\*\//g, '');   /* sans les commentaires */
  /* 6 recalculs de style par image pendant la mue PC → tablette (« très laggy », Pierre, 12/11) : lectures en tête d'image */
  assert.ok(/var sy=scrollY\|\|0,sbR=null,flyR=null;/.test(frame));
  assert.strictEqual((frame.match(/scrollY/g) || []).length, 1, 'scrollY lu une seule fois, en tête');
  assert.ok(!/clientWidth|clientHeight|offsetHeight|getComputedStyle/.test(frame), 'pas de lecture de taille dans frame()');
  assert.strictEqual((frame.match(/getBoundingClientRect/g) || []).length, 2, 'les deux lectures du vol des affiches, en tête d\'image');
  assert.ok(frame.indexOf('getBoundingClientRect') < frame.indexOf("set(bgL[0],'--tint'"), 'lectures avant la première écriture');
  assert.ok(/L3\.draw\(\{vw:stW,vh:stH,/.test(js) && /new ResizeObserver\(function\(\)\{stW=stick\.clientWidth;stH=stick\.clientHeight;req\(\);\}\)\.observe\(stick\)/.test(js));
  assert.ok(/if\(pill&&!S\._pl&&scr\[3\]&&scr\[3\]\._v&&tabs\[tb\]&&tabs\[tb\]\.offsetWidth\)/.test(js), 'onglets mesurés seulement quand l\'écran est affiché');
  /* teinte : calques peints une fois, seule l'opacité change (le dégradé plein écran était repeint à chaque image) */
  assert.ok(!/set\(S,'--tint'/.test(js) && !/set\(bgEl,'--tint'/.test(js));
  assert.ok(/set\(bgL\[1\],'opacity',ev\?k:1-k\);/.test(js) && /be\.className='lp-j-bgl'/.test(js));
  assert.ok(/\.lp-j-bg,\.lp-j-bgl\{position:absolute;inset:0;background:radial-gradient\(120% 90% at 66% 45%,rgba\(var\(--tint,10,30,56\),1\) 0%,rgba\(var\(--tint,10,30,56\),\.35\) 45%,var\(--bg\) 80%\),var\(--bg\)\}/.test(css), 'calques opaques, teinte d\'accueil par défaut');
  assert.ok(/\.lp-j-bgl\{will-change:opacity\}/.test(css));
  /* écrans non affichés : ni style ni mise en page sur ordinateur (display:none sur mobile) */
  assert.ok(/@media \(min-width:861px\)\{\s*\.lp-s:not\(\.vis\)\{content-visibility:hidden\}\s*\}/.test(css));
});

