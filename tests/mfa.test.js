'use strict';
/*
 * Double authentification (js/37-mfa.js) : génération/normalisation/empreinte des codes de
 * secours, sans navigateur. Les écrans eux-mêmes dépendent de supabase.auth.mfa.* et sont
 * vérifiés visuellement (Playwright) et par la suite e2e/auth.test.mjs pour la non-régression
 * des parcours de connexion qu'ils modifient.
 * Lancer : node --test tests/
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

function slice(src, from, to) {
  const a = src.indexOf(from), b = src.indexOf(to, a);
  assert.ok(a >= 0 && b > a, 'extrait introuvable : ' + from);
  return src.slice(a, b);
}
function loadMfaHelpers() {
  const src = read('js/37-mfa.js');
  const ctx = { crypto: webcrypto, TextEncoder, Uint8Array };
  vm.createContext(ctx);
  vm.runInContext(slice(src, 'var MFA_RECOVERY_ALPHABET', 'function _mfaGenerateAndStoreRecoveryCodes'), ctx);
  return ctx;
}

test('code de secours : alphabet de 32 caractères exactement (indispensable, bytes[i]%32)', () => {
  const { MFA_RECOVERY_ALPHABET } = loadMfaHelpers();
  assert.strictEqual(MFA_RECOVERY_ALPHABET.length, 32, 'un alphabet plus court laisserait %32 renvoyer un index hors limites (undefined)');
  assert.strictEqual(new Set(MFA_RECOVERY_ALPHABET.split('')).size, 32, 'aucun caractère en double');
});

test('code de secours : alphabet sans caractères ambigus, 10 caractères', () => {
  const { _mfaRandomCode } = loadMfaHelpers();
  for (let i = 0; i < 200; i++) {
    const c = _mfaRandomCode();
    assert.strictEqual(c.length, 10);
    assert.match(c, /^[abcdefghijkmnpqrstuvwxyz23456789]{10}$/, c);
    assert.doesNotMatch(c, /[01lo]/, 'pas de 0/1/l/o : ' + c);
  }
});

test('code de secours : formatage en deux groupes de 5, lisibles', () => {
  const { _mfaFormatCode } = loadMfaHelpers();
  assert.strictEqual(_mfaFormatCode('abcdefghjk'), 'abcde-fghjk');
});

test('code de secours : normalisation insensible aux tirets/espaces/majuscules', () => {
  const { _mfaNormalizeCode } = loadMfaHelpers();
  assert.strictEqual(_mfaNormalizeCode('abcde-fghjk'), 'abcdefghjk');
  assert.strictEqual(_mfaNormalizeCode('ABCDE FGHJK'), 'abcdefghjk');
  assert.strictEqual(_mfaNormalizeCode('  abcde-fghjk  '), 'abcdefghjk');
  assert.strictEqual(_mfaNormalizeCode(''), '');
  assert.strictEqual(_mfaNormalizeCode(null), '');
});

test('empreinte SHA-256 : déterministe, sensible à la casse normalisée, vecteur connu', async () => {
  const { _sha256Hex } = loadMfaHelpers();
  // SHA-256('') est un vecteur de test standard.
  assert.strictEqual(await _sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  const h1 = await _sha256Hex('abcdefghjk');
  const h2 = await _sha256Hex('abcdefghjk');
  const h3 = await _sha256Hex('abcdefghjl');
  assert.strictEqual(h1, h2, 'même code -> même empreinte');
  assert.notStrictEqual(h1, h3, 'un seul caractère différent -> empreinte différente');
  assert.match(h1, /^[0-9a-f]{64}$/, 'hexadécimal 64 caractères (sha256), compatible avec la colonne bytea côté migration');
});

test('code de secours : 10 codes générés sont distincts (entropie suffisante)', () => {
  const { _mfaRandomCode } = loadMfaHelpers();
  const seen = new Set();
  for (let i = 0; i < 10; i++) seen.add(_mfaRandomCode());
  assert.strictEqual(seen.size, 10);
});
