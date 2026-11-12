'use strict';
/* Landing 3D « voyage » (experience/) : compatible avec la CSP du site (aucun script en ligne, rien hors
   de l'origine sauf les affiches TMDB déjà autorisées), Three.js figé et sous licence, publiée par le build,
   accessible, légère au premier affichage.
   Lancer : node --test tests/ */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const OWN = ['experience/app.js', 'experience/data.js', 'experience/fx.js', 'experience/screens.js'];

test('page : aucun script en ligne ni ressource externe, textes réels pour les lecteurs d\'écran et la FAQ', () => {
  const html = read('experience/index.html');
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length >= 1);
  for (const [, attrs, body] of scripts) {
    assert.match(attrs, /src="\/experience\/[\w.-]+\.js"/, 'script local');
    assert.strictEqual(body.trim(), '', 'aucun script en ligne (CSP script-src \'self\')');
  }
  assert.doesNotMatch(html, /(src|href)="https?:\/\//, 'aucune ressource externe');
  assert.match(html, /<h1[^>]*>[^<]+<\/h1>/);
  assert.match(html, /<noscript>/);
  assert.match(html, /<canvas id="scene" aria-hidden="true">/);
  assert.match(html, /id="soundBtn"[^>]*aria-pressed="false"/);
  assert.strictEqual((html.match(/<details>/g) || []).length, 6, 'FAQ : 6 questions');
  assert.strictEqual((html.match(/data-go="\d"/g) || []).length, 5, '5 ancres d\'étape');
  assert.match(html, /<a class="btn" href="\/#lp-join"/, 'création de compte = vrai lien HTML');
  assert.match(html, /This product uses the TMDB API/);
});

test('étapes : 5 étapes, 9 segments de texte, 3 pastilles de configuration', () => {
  const d = read('experience/data.js');
  assert.strictEqual((d.match(/\bP: [\d.]+, segs:/g) || []).length, 5);
  assert.strictEqual((d.match(/\btitle: '/g) || []).length, 9);
  assert.match(d, /Tout ce que tu regardes, <em>enfin au même endroit\.<\/em>/);
  const setup = d.slice(d.indexOf('export const SETUP'), d.indexOf('export const GRAND'));
  assert.strictEqual((setup.match(/^\s+\['/gm) || []).length, 3);
  assert.match(d, /GRAND = \(from, to\) => \(from === 2 && to === 3\) \|\| \(from === 3 && to === 2\)/, 'grand saut = tablette ↔ téléphone');
});

test('scripts : imports relatifs uniquement, Three.js r170 figé avec sa licence, requêtes limitées à TMDB', () => {
  const files = [...OWN, ...fs.readdirSync(path.join(ROOT, 'experience/three/addons')).map(f => 'experience/three/addons/' + f)];
  for (const f of files) {
    for (const m of read(f).matchAll(/\bfrom\s+'([^']+)'/g)) assert.match(m[1], /^\.\.?\//, f + ' : import relatif (' + m[1] + ')');
  }
  assert.match(read('experience/three/three.module.min.js').slice(0, 200), /Copyright 2010-20\d\d Three\.js Authors/);
  assert.match(read('experience/three/three.module.min.js'), /REVISION="170"|const \w+="170"/);
  assert.match(read('experience/three/LICENSE'), /MIT License/);
  for (const f of OWN) {
    const urls = [...read(f).matchAll(/https?:\/\/[^\s'"`)]+/g)].map(m => m[0]).filter(u => !/^https?:\/\/www\.w3\.org/.test(u));
    for (const u of urls) assert.match(u, /^https:\/\/image\.tmdb\.org\/t\/p\/w342/, f + ' : seul TMDB (img-src de la CSP) est autorisé : ' + u);
  }
  assert.match(read('experience/screens.js'), /crossOrigin = 'anonymous'/);
  assert.match(read('experience/app.js'), /firstGesture/, 'affiches réelles chargées au premier geste seulement');
});

test('poids : fichiers de la page sous le budget (hors modèles 3D à venir)', () => {
  const own = OWN.concat(['experience/index.html', 'experience/style.css']).reduce((s, f) => s + fs.statSync(path.join(ROOT, f)).size, 0);
  assert.ok(own < 150 * 1024, 'code de la page < 150 Ko (' + own + ')');
  const three = fs.statSync(path.join(ROOT, 'experience/three/three.module.min.js')).size;
  assert.ok(own + three < 1.5 * 1024 * 1024, 'premier affichage < 1,5 Mo avant compression');
});

test('build : le dossier est publié ; le brief est gardé hors déploiement', () => {
  assert.match(read('scripts/build-static.mjs'), /const DIRS = \[[^\]]*'experience'/);
  assert.match(read('.vercelignore'), /^branding$/m);
  assert.ok(fs.existsSync(path.join(ROOT, 'branding/landing-3d-brief.md')));
});

test('accessibilité et énergie : animations réduites, repli sans scène, rendu suspendu hors écran, qualité adaptative', () => {
  const js = read('experience/app.js'), css = read('experience/style.css');
  assert.match(js, /prefers-reduced-motion: reduce/);
  assert.match(js, /visibilitychange/);
  assert.match(js, /covered/);
  assert.match(js, /staticMode\('nogl'\)/, 'repli sans WebGL');
  assert.match(js, /tierLocked/, 'niveau de qualité verrouillable (?q=)');
  assert.match(js, /let tier = TIERS\[qs\.get\('q'\)\] \? qs\.get\('q'\) : 'low'/, 'démarrage au niveau le plus léger');
  assert.match(js, /softwareGpu/, 'sonde GPU logiciel : lecture normale plutôt qu\'une attente de 60 s');
  assert.match(js, /fallback\('slow'\)/, 'garde-fou : repli si la scène ne tient pas la cadence');
  assert.match(js, /Promise\.race/, 'les polices ne bloquent jamais le démarrage');
  assert.doesNotMatch(js, /compileAsync/, 'aucune compilation bloquante de tous les shaders au démarrage');
  assert.match(css, /html\.static #scene/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(css, /:focus-visible/);
});
