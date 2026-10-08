'use strict';
/*
 * Page d'accueil publique (#landing, js/00-landing-gate.js, js/23-landing.js, landing/landing.css) :
 * décision avant le premier rendu, un seul h1, pas de second système de compte, pas de tiers,
 * aucune promesse de fonctionnalité qui n'existe pas. Parcours complets : e2e/landing.test.mjs.
 * Lancer : node --test tests/
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const HTML = read('index.html');
const HEAD = HTML.slice(0, HTML.indexOf('</head>'));
const LANDING = HTML.slice(HTML.indexOf('<div class="lp" id="landing">'), HTML.indexOf('<!--/landing-->') > 0 ? HTML.indexOf('<!--/landing-->') : HTML.indexOf('<footer class="app-foot">'));
const DICTS = (() => {
  const ctx = { window: {} };
  vm.createContext(ctx);
  for (const l of ['fr', 'en']) vm.runInContext(read('js/i18n/' + l + '.js'), ctx);
  return ctx.window.I18N_DICTS;
})();
const lpKeys = l => Object.keys(DICTS[l]).filter(k => k.startsWith('lp.'));

test('portier : script externe chargé dans <head>, avant le corps et sans attribut async/defer', () => {
  const m = HEAD.match(/<script src="\/js\/00-landing-gate\.js"([^>]*)><\/script>/);
  assert.ok(m, 'js/00-landing-gate.js dans <head>');
  assert.doesNotMatch(m[1], /async|defer/, 'synchrone : décision avant le premier rendu');
  assert.ok(fs.existsSync(path.join(ROOT, 'js/00-landing-gate.js')));
  const gate = read('js/00-landing-gate.js');
  for (const s of ['lp-member', 'lp-guest', 'wl_app_guest', 'auth-token', 'access_token']) assert.ok(gate.includes(s), s);
  assert.doesNotMatch(gate, /fetch\(|XMLHttpRequest|supabase\.co/, 'aucun réseau : lecture locale seulement');
});

test('CSS critique : application masquée tant que le visiteur n’est pas membre, accueil masqué pour les membres', () => {
  assert.match(HEAD, /html:not\(\.lp-member\) \.hdr/);
  assert.match(HEAD, /html:not\(\.lp-member\) \.layout/);
  assert.match(HEAD, /html\.lp-member #landing\{display:none!important\}/);
  assert.match(HEAD, /<link rel="stylesheet" href="\/landing\/landing\.css">/);
});

test('landing/ publié (.vercelignore) et feuille de style sans ressource tierce', () => {
  assert.match(read('.vercelignore'), /^!landing$/m);
  const css = read('landing/landing.css');
  assert.doesNotMatch(css, /@import|url\(\s*['"]?https?:/i, 'pas de police ni d’image distante');
  assert.match(css, /prefers-reduced-motion:\s*reduce/, 'animations coupées si l’utilisateur le demande');
});

test('un seul h1 dans index.html, dans la page d’accueil', () => {
  const h1 = HTML.match(/<h1[\s>]/g) || [];
  assert.strictEqual(h1.length, 1);
  assert.ok(LANDING.includes('<h1'), 'le h1 est celui de l’accueil');
});

test('accueil : aucune ressource tierce, aucun <form> ni champ de mot de passe en double (le panneau reçoit #authView)', () => {
  const urls = [...LANDING.matchAll(/\s(?:src|href)="(https?:[^"]+)"/g)].map(m => m[1]);
  assert.deepStrictEqual(urls, [], 'liens et ressources relatifs uniquement');
  assert.doesNotMatch(LANDING, /<form[\s>]|type="password"|<iframe/i);
  assert.match(LANDING, /id="lpAuthHost"/);
  const js = read('js/23-landing.js');
  assert.match(js, /appendChild\(v\)/, '#authView est déplacé, pas copié');
  assert.match(js, /authGo\(/, 'vues de compte existantes (js/20-account.js)');
  assert.doesNotMatch(js, /signUp|signInWithPassword|resetPasswordForEmail/, 'aucun appel Supabase Auth en propre');
  assert.match(read('js/20-account.js'), /function _authViewHome\(\)/);
});

test('actions de l’accueil déclarées dans js/00-actions.js et sans gestionnaire en ligne', () => {
  const acts = read('js/00-actions.js');
  for (const a of ['lpAuth', 'lpOpenApp']) assert.match(acts, new RegExp("uiOn\\('" + a + "'"), a);
  assert.doesNotMatch(LANDING, /\son[a-z]+\s*=/i);
  assert.match(HTML, /<script src="js\/23-landing\.js"><\/script>/);
});

test('textes de l’accueil en français et en anglais, sans adresse codée en dur', () => {
  const fr = lpKeys('fr'), en = lpKeys('en');
  assert.ok(fr.length > 80, 'textes de l’accueil traduits');
  assert.deepStrictEqual(en.sort(), fr.sort());
  for (const l of ['fr', 'en']) for (const k of lpKeys(l)) assert.doesNotMatch(DICTS[l][k], /cinepisode\.com|https?:\/\//i, l + ':' + k);
  const used = [...LANDING.matchAll(/data-i18n="(lp\.[^"]+)"/g)].map(m => m[1]);
  for (const k of used) assert.ok(k in DICTS.fr, 'clé manquante : ' + k);
});

test('pas de promesse qui n’existe pas : import TV Time/Trakt, calendrier, notifications ; extension « bientôt »', () => {
  for (const l of ['fr', 'en']) {
    const all = lpKeys(l).map(k => DICTS[l][k]).join('\n');
    assert.doesNotMatch(all, /TV ?Time|Trakt|Letterboxd|calendrier|calendar|notification push|push notification/i, l);
    assert.doesNotMatch(all, /\b\d[\d  .,]*\s*(utilisateurs|users|membres|members)\b/i, l + ' : aucun chiffre d’utilisateurs inventé');
  }
  assert.match(DICTS.fr['lp.f2.soon'] || '', /Bientôt sur le Chrome Web Store/);
  assert.match(DICTS.en['lp.f2.soon'] || '', /Coming soon to the Chrome Web Store/);
  assert.doesNotMatch(LANDING, /chromewebstore\.google\.com|chrome\.google\.com\/webstore/, 'pas de lien vers une fiche non publiée');
});

test('référencement : titre et description par langue, hreflang fr/en et sitemap inchangés', () => {
  for (const l of ['fr', 'en']) {
    assert.match(DICTS[l]['lp.meta.title'], /^\{name\} · /);
    assert.ok(DICTS[l].$meta.description.length >= 110 && DICTS[l].$meta.description.length <= 170, l + ' : description de 110 à 170 caractères');
  }
  assert.match(HEAD, /<link rel="alternate" hreflang="fr" href="https:\/\/cinepisode\.com\/fr">/);
  assert.match(HEAD, /<link rel="alternate" hreflang="en" href="https:\/\/cinepisode\.com\/en">/);
  const sm = read('sitemap.xml');
  for (const p of ['/fr', '/en']) assert.ok(sm.includes('https://cinepisode.com' + p + '<'), p);
});
