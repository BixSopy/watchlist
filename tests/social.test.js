'use strict';
/* Social étape 1 : pseudo, amis, invitations. Base : supabase/tests/80_social.test.sql. Lancer : node --test tests/ */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
global.window = global; global.document = global.document || { addEventListener() {}, documentElement: { className: '' } };
if (!global.document.addEventListener) global.document.addEventListener = () => {};
const H = require(path.join(ROOT, 'js', '32-handle.js'));

test('pseudo : normalisation (minuscules, sans @, accents, espaces)', () => {
  assert.strictEqual(H.handleNormalize('  @Pierre Émile '), 'pierre_emile');
  assert.strictEqual(H.handleNormalize('Zoé-Lou!!'), 'zoe_lou');
  assert.strictEqual(H.handleNormalize('a'.repeat(30)).length, 20);
});
test('pseudo : format identique à la contrainte SQL', () => {
  for (const ok of ['abc', 'pierre.u', 'p_1', 'a'.repeat(20)]) assert.ok(H.handleValid(ok), ok);
  for (const ko of ['ab', '.abc', 'abc.', 'a..b', 'ABC', 'a-b', 'a'.repeat(21), 'é_ab']) assert.ok(!H.handleValid(ko), ko);
  assert.strictEqual(H.handleFormatError('ab'), 'handle.err.short');
  assert.strictEqual(H.handleFormatError('.abc'), 'handle.err.dot');
  assert.strictEqual(H.handleFormatError('abc'), null);
  const sql = read('supabase/migrations/20261026120000_social_pseudo_amis.sql');
  assert.match(sql, /\[a-z0-9\._\]\{3,20\}|\[a-z0-9._\]\{3,20\}/);
});
test('pseudo : proposition tirée de l\'email, toujours valide', () => {
  assert.strictEqual(H.handleSuggestFrom('Pierre.Unbekand@gmail.com'), 'pierre.unbekand');
  for (const e of ['a@b.c', '.x.@y', '', 'jo..e@x']) assert.ok(H.handleValid(H.handleSuggestFrom(e)), e);
});
test('migration absente : l\'interface sociale reste masquée', () => {
  assert.ok(H.socialUnavailable({ code: 'PGRST202' }));
  assert.ok(!H.socialUnavailable({ code: '42501' }));
  assert.ok(!H.socialUnavailable(null));
});
test('pseudo demandé avant la fenêtre d\'accueil', () => {
  assert.match(read('js/28-pairing.js'), /handleOnboardFirst\(showOnboarding\)/);
});
