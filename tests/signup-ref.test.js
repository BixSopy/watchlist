'use strict';
/*
 * Attribution d'inscription (?r=code) : js/00-signup-ref.js, sans navigateur.
 * Lancer : node --test tests/signup-ref.test.js
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'js/00-signup-ref.js'), 'utf8');

function load(opts) {
  const store = Object.assign({}, (opts && opts.store) || {});
  const loc = {
    pathname: (opts && opts.pathname) || '/',
    search: (opts && opts.search) || '',
    hash: (opts && opts.hash) || '',
  };
  let replaced = null;
  const ctx = {
    console,
    Date,
    JSON,
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; },
    },
    location: loc,
    history: {
      replaceState: (_a, _b, url) => {
        replaced = url;
        const u = new URL(url, 'https://cinepisode.com');
        loc.pathname = u.pathname;
        loc.search = u.search;
        loc.hash = u.hash;
      },
    },
    URLSearchParams,
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { ctx, store, getReplaced: () => replaced };
}

test('normalise et valide le format a-z0-9 {2,12}', () => {
  const { ctx } = load();
  assert.strictEqual(ctx._signupRefNormalize('X12'), 'x12');
  assert.strictEqual(ctx._signupRefNormalize(' rd7 '), 'rd7');
  assert.strictEqual(ctx._signupRefNormalize('AB'), 'ab');
  assert.strictEqual(ctx._signupRefNormalize('a'), null);
  assert.strictEqual(ctx._signupRefNormalize('abcdefghijklm'), null);
  assert.strictEqual(ctx._signupRefNormalize('bad!'), null);
  assert.strictEqual(ctx._signupRefNormalize(''), null);
});

test('capture ?r= depuis l\'URL, le stocke et le retire (garde les autres params)', () => {
  const { ctx, store, getReplaced } = load({ search: '?r=x12&lang=fr', pathname: '/fr' });
  assert.strictEqual(ctx.getSignupRef(), 'x12');
  assert.ok(store.cp_signup_ref);
  assert.match(getReplaced(), /\/fr\?lang=fr$/);
  assert.doesNotMatch(getReplaced(), /[?&]r=/);
});

test('fonctionne aussi sur /u/<pseudo> et /en', () => {
  const a = load({ search: '?i=AbCdEfGhIjKl&r=rd7', pathname: '/u/lea' });
  assert.strictEqual(a.ctx.getSignupRef(), 'rd7');
  assert.match(a.getReplaced(), /\/u\/lea\?i=AbCdEfGhIjKl$/);
  const b = load({ search: '?r=abc', pathname: '/en' });
  assert.strictEqual(b.ctx.getSignupRef(), 'abc');
});

test('ignore un code invalide mais le retire quand même de l\'URL', () => {
  const { ctx, getReplaced } = load({ search: '?r=BAD!' });
  assert.strictEqual(ctx.getSignupRef(), null);
  assert.strictEqual(getReplaced(), '/');
});

test('expire après 30 jours et clearSignupRef efface', () => {
  const old = Date.now() - 31 * 24 * 60 * 60 * 1000;
  const { ctx } = load({
    store: { cp_signup_ref: JSON.stringify({ c: 'x12', t: old }) },
  });
  assert.strictEqual(ctx.getSignupRef(), null);
  const fresh = load({ search: '?r=ok1' });
  assert.strictEqual(fresh.ctx.getSignupRef(), 'ok1');
  fresh.ctx.clearSignupRef();
  assert.strictEqual(fresh.ctx.getSignupRef(), null);
});

test('js/20-account.js passe meta.ref au signUp et nettoie après succès', () => {
  const acct = fs.readFileSync(path.join(ROOT, 'js/20-account.js'), 'utf8');
  assert.match(acct, /getSignupRef/);
  assert.match(acct, /meta\.ref/);
  assert.match(acct, /clearSignupRef/);
  assert.match(acct, /signUp\(\{email:email,password:pass,options:\{[^}]*data:meta/);
});

test('index.html charge 00-signup-ref.js tôt (head)', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const iGate = html.indexOf('00-landing-gate.js');
  const iRef = html.indexOf('00-signup-ref.js');
  assert.ok(iGate >= 0 && iRef > iGate, 'signup-ref juste après landing-gate');
});

test('pages confidentialité FR+EN mentionnent le code d\'attribution', () => {
  const fr = fs.readFileSync(path.join(ROOT, 'confidentialite.html'), 'utf8');
  const en = fs.readFileSync(path.join(ROOT, 'privacy.html'), 'utf8');
  assert.match(fr, /Code court d'attribution/);
  assert.match(fr, /\?r=/);
  assert.match(en, /Short attribution code/);
  assert.match(en, /\?r=/);
});
