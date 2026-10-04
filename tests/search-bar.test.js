'use strict';
/*
 * Régression mobile : sous ~480 px le champ #tmdbSearchInput du header est écrasé à 0 px,
 * seule la loupe reste visible et elle est en pointer-events:none. La barre entière doit
 * donc ouvrir la recherche, sinon le tap sur la loupe ne fait rien.
 * Lancer : node --test tests/
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function fnBody(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' introuvable');
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error('fin de ' + name + ' introuvable');
}

test('la loupe du header est bien non cliquable en elle-même (le clic tombe sur la barre)', () => {
  assert.match(html, /\.search-bar>svg\{[^}]*pointer-events:none/);
  assert.match(html, /<div class="search-bar[^"]*"[^>]*>\s*<svg[\s\S]*?<input[^>]*id="tmdbSearchInput"/);
});

test('un tap sur la barre de recherche (loupe comprise) ouvre la modale', () => {
  const body = fnBody(app, 'bindSearchModalEvents');
  assert.match(body, /closest\('\.search-bar'\)/);
  assert.match(body, /hBar\.addEventListener\('click',[\s\S]*?openSearchModal\(/);
});

test('openSearchModal donne le focus au champ pendant le geste (clavier iOS)', () => {
  const body = fnBody(app, 'openSearchModal');
  const sync = body.replace(/setTimeout\([\s\S]*?\},\d+\);/g, '');
  assert.match(sync, /\.focus\(/);
});
