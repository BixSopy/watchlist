'use strict';
/*
 * Mode clair (demande explicite de Pierre le 06/11) : vrai sélecteur Système/Sombre/Clair,
 * pas une simple recoloration. js/00-theme.js décide avant le premier rendu (même principe
 * que js/00-landing-gate.js) ; css/app.css porte les tokens clairs sous :root[data-theme="light"].
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('index.html charge js/00-theme.js de façon synchrone, tôt, avant 00-landing-gate.js', () => {
  const html = read('index.html');
  const m = html.match(/<script src="\/js\/00-theme\.js"([^>]*)><\/script>/);
  assert.ok(m, 'js/00-theme.js dans <head>');
  assert.doesNotMatch(m[1], /async|defer/, 'synchrone : décision avant le premier rendu, comme 00-landing-gate.js');
  const iTheme = html.indexOf('00-theme.js'), iGate = html.indexOf('00-landing-gate.js');
  assert.ok(iTheme >= 0 && iGate > iTheme, '00-theme.js chargé avant 00-landing-gate.js');
});

test('js/00-theme.js pose data-theme avant le premier rendu, lit wl_theme, écoute le changement système', () => {
  const s = read('js/00-theme.js');
  assert.match(s, /localStorage\.getItem\('wl_theme'\)/);
  assert.match(s, /document\.documentElement\.setAttribute\('data-theme'/);
  assert.match(s, /matchMedia\('\(prefers-color-scheme: light\)'\)/);
  assert.match(s, /window\.applyThemePref=function/, 'fonction exposée pour le menu Réglages');
  assert.match(s, /MQ\.addEventListener\('change'/, 'suit un changement de thème OS en direct quand la préférence est "système"');
});

test('css/app.css : tokens clairs complets sous :root[data-theme="light"], valeurs sombres inchangées par défaut', () => {
  const css = read('css/app.css');
  const lightBlock = css.match(/:root\[data-theme="light"\]\{([^}]*)\}/);
  assert.ok(lightBlock, 'bloc :root[data-theme="light"] présent');
  for (const tok of ['--bg:', '--bg2:', '--text:', '--text2:', '--text3:', '--ink-rgb:', '--accent:', '--accent-rgb:', '--accent-hover:', '--on-accent:', '--red:', '--green:', '--glass-panel-bg:', '--glass-backdrop-bg:', '--p3-glass:', '--accent-flat:']) {
    assert.ok(lightBlock[1].includes(tok), 'token clair manquant : ' + tok);
  }
  /* Le mode sombre reste la valeur par défaut de :root (OLED pur, décision du 06/11, PR #110) */
  assert.match(css, /:root\{[\s\S]*?--bg:#000000/);
  /* --ink-rgb permet à tout rgba(var(--ink-rgb),X) hors du bloc clair de se réaccorder sans
     override individuel ; seuls les 3 fonds de verre du bloc clair gardent un blanc littéral
     (valeur absolue du verre en mode clair, pas une surimpression sur le fond de la page). */
  const outsideLight = css.replace(/:root\[data-theme="light"\]\{[^}]*\}/, '');
  assert.doesNotMatch(outsideLight, /rgba\(255,255,255,/, 'plus aucun blanc translucide en dur hors du bloc clair');
});

test('applyGlass() (js/10-settings-core.js) choisit sa base RGB selon le thème, pas un dégradé sombre figé', () => {
  const s = read('js/10-settings-core.js');
  assert.match(s, /document\.documentElement\.getAttribute\('data-theme'\)==='light'/);
  assert.match(s, /wl_theme:'system'/, 'réglage par défaut : suit le système');
});

test('menu Réglages : sélecteur de thème appelle applyThemePref au changement', () => {
  const s = read('js/17-settings-menu.js');
  assert.match(s, /_selectRow\(esc\(t\('set\.theme'\)\),'wl_theme'/);
  assert.match(s, /key==='wl_theme'&&typeof applyThemePref==='function'/);
});

test('i18n FR/EN : clés du sélecteur de thème présentes', () => {
  for (const f of ['js/i18n/fr.js', 'js/i18n/en.js']) {
    const s = read(f);
    for (const k of ['set.theme', 'set.themeSystem', 'set.themeDark', 'set.themeLight']) {
      assert.match(s, new RegExp('"' + k.replace('.', '\\.') + '":'), k + ' manquant dans ' + f);
    }
  }
});
