'use strict';
/* Fenêtre d'accueil (js/28-pairing.js) : étape extension masquée tant que EXT_STORE_URL est vide. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const src = fs.readFileSync(path.join(__dirname, '..', 'js/28-pairing.js'), 'utf8');
const m = src.match(/function onbHtml\(storeUrl\)\{[\s\S]*?\n\}/);
const ctx = { esc: s => String(s), t: k => '[' + k + ']', uiAct: n => ' data-click="' + n + '"', _pairIcon: () => '' };
vm.createContext(ctx); vm.runInContext(m[0], ctx);
test('sans URL du store : ni étape ni bouton extension', () => {
  const h = ctx.onbHtml('');
  assert.doesNotMatch(h, /onb\.s2|onb\.s3|onb\.install|chromewebstore/);
  assert.match(h, /onb\.textNoExt/); assert.match(h, /onb\.start/);
});
test('avec URL du store : étapes revenues, bouton vers la fiche dans un nouvel onglet', () => {
  const u = 'https://chromewebstore.google.com/detail/cinepisode/abc';
  const h = ctx.onbHtml(u);
  assert.match(h, /onb\.s2/); assert.match(h, /onb\.s3/);
  assert.ok(h.includes('<a class="pair-btn" href="' + u + '" target="_blank" rel="noopener">[onb.install]'));
});
