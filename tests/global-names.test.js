'use strict';
/* Les scripts de js/ sont des scripts classiques qui partagent l'espace global : deux « function x() » au niveau
   supérieur dans deux fichiers = le dernier chargé remplace silencieusement le premier (bug réel : recoCardHtml de
   js/38-recommend.js écrasait celui de js/11-recos.js, et Découvrir « Pour toi » n'affichait plus rien). */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const JS = path.join(__dirname, '..', 'js');
/* Fichiers dont le code est enveloppé dans une fonction (leurs « function » ne sont pas globales) */
const WRAPPED = new Set(['26-calendar.js', '27-gdpr-import.js']);

test('aucune fonction globale n\'est déclarée dans deux fichiers de js/', () => {
  const seen = new Map();
  const dup = [];
  for (const f of fs.readdirSync(JS).filter(n => n.endsWith('.js') && !WRAPPED.has(n)).sort()) {
    const src = fs.readFileSync(path.join(JS, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of src.matchAll(/^function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) {
      if (seen.has(m[1]) && seen.get(m[1]) !== f) dup.push(m[1] + ' : ' + seen.get(m[1]) + ' et ' + f);
      else seen.set(m[1], f);
    }
  }
  assert.deepStrictEqual(dup, []);
});

test('recoCardHtml (cartes « Pour toi ») n\'existe que dans js/11-recos.js', () => {
  const owners = fs.readdirSync(JS).filter(n => n.endsWith('.js') && /^function recoCardHtml\(/m.test(fs.readFileSync(path.join(JS, n), 'utf8')));
  assert.deepStrictEqual(owners, ['11-recos.js']);
});
