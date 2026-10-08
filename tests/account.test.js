'use strict';
/*
 * Écrans de compte (js/20-account.js) : règles de mot de passe, messages d'erreur en
 * français et lecture des liens d'emails (js/01-config.js), sans navigateur.
 * Les parcours complets sont testés dans un vrai Chrome : voir e2e/.
 * Lancer : node --test tests/
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

function slice(src, from, to) {
  const a = src.indexOf(from), b = src.indexOf(to, a);
  assert.ok(a >= 0 && b > a, 'extrait introuvable : ' + from);
  return src.slice(a, b);
}
function loadAccountHelpers() {
  const src = read('js/20-account.js');
  const ctx = { BRAND: { name: 'Cinepisode' }, TextEncoder };
  vm.createContext(ctx);
  vm.runInContext(read('js/00-brand.js').replace('var BRAND', 'var _B') + '\n' +
    slice(src, 'var AUTH_PW_MIN', '/* ---------- Configuration publique') +
    slice(src, 'var AUTH_ERRORS', '/* ---------- Utilitaires d\'interface'), ctx);
  return ctx;
}

test('mot de passe : 12 caractères minimum, 72 octets maximum, pas l\'email ni un mot courant', () => {
  const { passwordProblem } = loadAccountHelpers();
  assert.match(passwordProblem('court', 'a@b.fr'), /au moins 12/);
  assert.match(passwordProblem('aaaaaaaaaaaaaa', 'a@b.fr'), /caractère répété/);
  assert.match(passwordProblem('pierre.dupont-2026', 'pierre.dupont@exemple.fr'), /adresse email/);
  assert.match(passwordProblem('motdepassemotdepasse', 'x@y.fr'), /trop courant/);
  assert.match(passwordProblem('Cinepisode!!', 'x@y.fr'), /trop courant/);
  assert.match(passwordProblem('é'.repeat(40), 'x@y.fr'), /trop long/);
  assert.strictEqual(passwordProblem('Une-phrase-de-passe-42', 'x@y.fr'), '');
});

test('indicateur de solidité croissant', () => {
  const { passwordScore } = loadAccountHelpers();
  assert.ok(passwordScore('abc') <= 1);
  assert.ok(passwordScore('abcdefghijkl') >= 1);
  assert.ok(passwordScore('Abcdefgh-1234') >= 2);
  assert.strictEqual(passwordScore('Une-Longue-Phrase-De-Passe-2026'), 4);
});

test('erreurs Supabase traduites en français', () => {
  const { authErrorMessage } = loadAccountHelpers();
  assert.strictEqual(authErrorMessage({ code: 'invalid_credentials' }), 'Email ou mot de passe incorrect.');
  assert.match(authErrorMessage({ code: 'weak_password', reasons: ['pwned'] }), /fuites de données/);
  assert.match(authErrorMessage({ code: 'weak_password', reasons: ['characters'] }), /minuscules, majuscules/);
  assert.match(authErrorMessage({ code: 'over_email_send_rate_limit' }), /Patiente/);
  assert.match(authErrorMessage({ code: 'captcha_failed' }), /anti-robot/);
  assert.match(authErrorMessage({ message: 'Token has expired or is invalid' }), /expiré/);
  assert.match(authErrorMessage({ status: 429, message: 'x' }), /Trop de tentatives/);
  assert.match(authErrorMessage({ name: 'AuthRetryableFetchError', message: 'Failed to fetch' }), /connexion internet/);
  assert.match(authErrorMessage({ message: 'quelque chose d\'inattendu' }), /Une erreur est survenue/);
});

function landing(url) {
  const src = read('js/01-config.js');
  const code = slice(src, 'var AUTH_LANDING=', 'var supa=');
  const u = new URL(url);
  const calls = [];
  const ctx = { URLSearchParams, location: { search: u.search, hash: u.hash, pathname: u.pathname },
    history: { replaceState: (a, b, c) => calls.push(c) } };
  vm.createContext(ctx);
  vm.runInContext(code + ';this.AUTH_LANDING=AUTH_LANDING;', ctx);
  return { landing: ctx.AUTH_LANDING, replaced: calls };
}

test('lien d\'email (token_hash) : lu puis retiré de l\'adresse avant toute vérification', () => {
  const r = landing('https://cinepisode.com/?action=recovery&type=recovery&token_hash=pkce_abcdef0123456789&utm=x');
  assert.deepStrictEqual({ ...r.landing }, { kind: 'token_hash', tokenHash: 'pkce_abcdef0123456789', type: 'recovery', action: 'recovery' });
  assert.deepStrictEqual(r.replaced, ['/?utm=x']);
  const s = landing('https://cinepisode.com/?type=email&token_hash=abcdef0123456789');
  assert.strictEqual(s.landing.action, 'signup');
});

test('lien d\'email : types inconnus et jetons malformés ignorés', () => {
  assert.strictEqual(landing('https://cinepisode.com/?type=admin&token_hash=abcdef0123456789').landing, null);
  assert.strictEqual(landing('https://cinepisode.com/?type=email&token_hash=<script>').landing, null);
  assert.strictEqual(landing('https://cinepisode.com/').landing, null);
});

test('erreur renvoyée par Supabase dans le fragment (#error_code=otp_expired)', () => {
  const r = landing('https://cinepisode.com/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid');
  assert.strictEqual(r.landing.kind, 'error');
  assert.strictEqual(r.landing.code, 'otp_expired');
  assert.deepStrictEqual(r.replaced, ['/']);
});

test('ancien format (#access_token…&type=recovery) laissé à supabase-js', () => {
  const r = landing('https://cinepisode.com/#access_token=x.y.z&refresh_token=r&type=recovery');
  assert.deepStrictEqual({ ...r.landing }, { kind: 'session', type: 'recovery' });
  assert.deepStrictEqual(r.replaced, [], 'le fragment reste pour supabase-js');
});

test('l\'ancienne interface de connexion a disparu de js/15-sync.js', () => {
  const sync = read('js/15-sync.js');
  for (const fn of ['function openAuthModal', 'function submitAuth', 'function switchAuthTab', 'function showAuthMsg']) {
    assert.ok(!sync.includes(fn), fn);
  }
  const html = read('index.html');
  const at = f => html.indexOf('<script src="' + f + '"></script>');
  assert.ok(at('js/00-brand.js') >= 0 && at('js/00-brand.js') < at('js/01-config.js'));
  assert.ok(at('js/19-search-modal.js') >= 0 && at('js/19-search-modal.js') < at('js/20-account.js'));
  assert.match(html, /<div id="authView"><\/div>/);
});
