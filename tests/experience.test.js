'use strict';
/* Prototype de landing 3D (experience/) : compatible avec la CSP du site (aucun script en ligne, rien hors
   de l'origine), Three.js figé et sous licence, publié par le build, accessible.
   Lancer : node --test tests/ */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('page : aucun script en ligne ni ressource externe, textes réels pour les lecteurs d\'écran', () => {
  const html = read('experience/index.html');
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length >= 1);
  for (const [, attrs, body] of scripts) {
    assert.match(attrs, /src="\/experience\/[\w.-]+\.js"/, 'script local');
    assert.strictEqual(body.trim(), '', 'aucun script en ligne (CSP script-src \'self\')');
  }
  assert.doesNotMatch(html, /(src|href)="https?:\/\//, 'aucune ressource externe');
  assert.match(html, /<h1[^>]*>[^<]+<\/h1>/);
  assert.strictEqual((html.match(/<section class="chap"/g) || []).length, 4, '4 chapitres');
  assert.match(html, /<canvas id="scene" aria-hidden="true">/);
  assert.match(html, /id="soundBtn"[^>]*aria-pressed="false"/);
});

test('scripts : imports relatifs uniquement, Three.js r170 figé avec sa licence', () => {
  const files = ['experience/app.js', ...fs.readdirSync(path.join(ROOT, 'experience/three/addons')).map(f => 'experience/three/addons/' + f)];
  for (const f of files) {
    for (const m of read(f).matchAll(/\bfrom\s+'([^']+)'/g)) assert.match(m[1], /^\.\.?\//, f + ' : import relatif (' + m[1] + ')');
  }
  assert.match(read('experience/three/three.module.min.js').slice(0, 200), /Copyright 2010-20\d\d Three\.js Authors/);
  assert.match(read('experience/three/three.module.min.js'), /REVISION="170"|const \w+="170"/);
  assert.match(read('experience/three/LICENSE'), /MIT License/);
  assert.doesNotMatch(read('experience/app.js'), /https?:\/\/(?!www\.w3\.org)/, 'aucune requête vers un autre domaine');
});

test('build : le dossier est publié ; le brief est gardé hors déploiement', () => {
  assert.match(read('scripts/build-static.mjs'), /const DIRS = \[[^\]]*'experience'/);
  assert.match(read('.vercelignore'), /^branding$/m);
  assert.ok(fs.existsSync(path.join(ROOT, 'branding/landing-3d-brief.md')));
});

test('accessibilité et énergie : animations réduites respectées, rendu suspendu hors écran', () => {
  const js = read('experience/app.js'), css = read('experience/style.css');
  assert.match(js, /prefers-reduced-motion: reduce/);
  assert.match(js, /visibilitychange/);
  assert.match(js, /covered/);
  assert.match(css, /html\.static \.chap\{position:relative/);
  assert.match(css, /prefers-reduced-motion:reduce/);
});
