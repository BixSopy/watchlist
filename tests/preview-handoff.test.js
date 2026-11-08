'use strict';
/*
 * Passerelle de session vers les prévisualisations Vercel (js/00-preview-handoff.js).
 * Vérifie : origines autorisées (et refus de tout le reste), aller-retour production ↔ prévisualisation,
 * pas de boucle, jeton d'accès seul (jamais de jeton de rafraîchissement réel), pas d'effet sur la production.
 * Lancer : node --test tests/
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', '00-preview-handoff.js'), 'utf8');
const brandJs = fs.readFileSync(path.join(__dirname, '..', 'js', '00-brand.js'), 'utf8');
const brand = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'brand.config.json'), 'utf8'));
const PREVIEW = 'https://watchlist-git-claude-sleepy-h-e55f8a-pierre-unbekand-s-projects.vercel.app';
const JWT = 'aaaa.bbbb.cccc';

/* Navigateur factice : location (replace enregistré), history, stockages */
function env(url, { stored = null, tried = null } = {}) {
  const u = new URL(url);
  const calls = { replace: [], state: [] };
  const store = (init) => { const m = new Map(Object.entries(init || {})); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), get length() { return m.size; }, key: i => [...m.keys()][i] }; };
  const w = {
    location: { hostname: u.hostname, origin: u.origin, pathname: u.pathname, search: u.search, hash: u.hash, replace: x => calls.replace.push(x) },
    history: { replaceState: (a, b, x) => calls.state.push(x) },
    localStorage: store(stored ? { 'sb-abc-auth-token': JSON.stringify(stored) } : {}),
    sessionStorage: store(tried ? { wl_handoff_try: String(tried) } : {}),
  };
  const sandbox = Object.assign({ URL, btoa, atob, Date, JSON, encodeURIComponent, decodeURIComponent }, w);
  vm.createContext(sandbox);
  vm.runInContext(brandJs, sandbox, { filename: '00-brand.js' });/* comme le navigateur : BRAND d'abord */
  vm.runInContext(src, sandbox, { filename: '00-preview-handoff.js' });
  return { w: sandbox, calls };
}
const fakeSupa = (session) => ({ auth: { getSession: () => Promise.resolve({ data: { session } }), setSession: function (x) { this.set = x; return Promise.resolve({}); } } });
const tick = () => new Promise(r => setImmediate(r));

test('PROD = brand.config.json › baseUrl ; production et ancien domaine ne sont jamais des prévisualisations', () => {
  const { w } = env(brand.baseUrl + '/');
  assert.strictEqual(w.PreviewHandoff.PROD, brand.baseUrl);
  const P = w.PreviewHandoff;
  assert.ok(!P.isPreviewHost(new URL(brand.baseUrl).hostname));
  for (const h of brand.domains.legacyHosts) assert.ok(!P.isPreviewHost(h), h);
  assert.ok(P.isPreviewHost('watchlist-git-main-pierre-unbekand-s-projects.vercel.app'));
  assert.ok(P.isPreviewHost('watchlist-7k2h9x3-pierre-unbekand-s-projects.vercel.app'));
});

test('origines refusées : autre équipe, autre domaine, http, port, chemin, sous-domaine piégé', () => {
  const P = env(brand.baseUrl + '/').w.PreviewHandoff;
  assert.ok(P.okOrigin(PREVIEW));
  for (const o of [
    'http://watchlist-git-x-pierre-unbekand-s-projects.vercel.app',
    PREVIEW + ':8443', PREVIEW + '/', PREVIEW + '/chemin',
    'https://watchlist-git-x-autre-equipe.vercel.app',
    'https://evil.com', brand.baseUrl, ...brand.domains.legacyHosts.map(h => 'https://' + h),
    PREVIEW + '.evil.com', 'https://evil.com/?' + PREVIEW, 'javascript:alert(1)', '', 'pas une url',
    'https://x.watchlist-git-x-pierre-unbekand-s-projects.vercel.app',
  ]) assert.ok(!P.okOrigin(o), 'refusée : ' + o);
});

test('prévisualisation sans session : redirige une fois vers la production, avec son origine', () => {
  const { calls, w } = env(PREVIEW + '/');
  assert.deepStrictEqual(calls.replace, [brand.baseUrl + '/#wl_preview=' + encodeURIComponent(PREVIEW)]);
  assert.ok(w.sessionStorage.getItem('wl_handoff_try'));
});

test('prévisualisation : pas de boucle (nouvel essai au plus une fois par minute) et rien si une session existe', () => {
  assert.deepStrictEqual(env(PREVIEW + '/', { tried: Date.now() - 5000 }).calls.replace, []);
  assert.strictEqual(env(PREVIEW + '/', { tried: Date.now() - 120000 }).calls.replace.length, 1);
  assert.deepStrictEqual(env(PREVIEW + '/', { stored: { refresh_token: 'r' } }).calls.replace, []);
});

test('prévisualisation : ?wl_nohandoff=1 désactive l\'aller-retour', () => {
  assert.deepStrictEqual(env(PREVIEW + '/?wl_nohandoff=1').calls.replace, []);
  assert.deepStrictEqual(env(PREVIEW + '/?x=1&wl_nohandoff').calls.replace, []);
  assert.strictEqual(env(PREVIEW + '/?wl_nohandoffx=1').calls.replace.length, 1, 'seul le paramètre exact compte');
});

test('production : aucun effet sans paramètre ; origine non autorisée ignorée, adresse nettoyée', async () => {
  const a = env(brand.baseUrl + '/');
  assert.deepStrictEqual(a.calls.replace, []); assert.strictEqual(a.w.__wlPreviewReq, undefined);
  const b = env(brand.baseUrl + '/#wl_preview=' + encodeURIComponent('https://evil.com'));
  assert.strictEqual(b.w.__wlPreviewReq, null); assert.strictEqual(b.calls.state.length, 1);
  const supa = fakeSupa({ access_token: JWT });
  b.w.PreviewHandoff.apply(supa); await tick();
  assert.deepStrictEqual(b.calls.replace, [], 'aucun jeton envoyé hors liste');
});

test('production connectée : renvoie le jeton d\'accès seul vers l\'origine demandée', async () => {
  const { w, calls } = env(brand.baseUrl + '/#wl_preview=' + encodeURIComponent(PREVIEW));
  assert.strictEqual(w.__wlPreviewReq, PREVIEW);
  w.PreviewHandoff.apply(fakeSupa({ access_token: JWT, refresh_token: 'SECRET-REFRESH' })); await tick();
  assert.strictEqual(calls.replace.length, 1);
  const to = calls.replace[0];
  assert.ok(to.startsWith(PREVIEW + '/#wl_handoff='));
  const payload = JSON.parse(w.PreviewHandoff._b64d(to.split('#wl_handoff=')[1]));
  assert.deepStrictEqual(payload, { at: JWT });
  assert.ok(!to.includes('SECRET-REFRESH') && !/refresh/i.test(JSON.stringify(payload)), 'jamais de jeton de rafraîchissement');
});

test('production non connectée : renvoie « none » (la prévisualisation ne boucle pas)', async () => {
  const { w, calls } = env(brand.baseUrl + '/#wl_preview=' + encodeURIComponent(PREVIEW));
  w.PreviewHandoff.apply(fakeSupa(null)); await tick();
  assert.deepStrictEqual(calls.replace, [PREVIEW + '/#wl_handoff=none']);
});

test('prévisualisation : ouvre la session avec le jeton d\'accès et un jeton de rafraîchissement factice, adresse nettoyée', () => {
  const tok = env(PREVIEW + '/').w.PreviewHandoff._b64e(JSON.stringify({ at: JWT }));
  const { w, calls } = env(PREVIEW + '/#wl_handoff=' + tok);
  assert.deepStrictEqual(calls.replace, [], 'pas de nouvelle redirection');
  assert.strictEqual(calls.state.length, 1, 'fragment retiré de l\'adresse');
  assert.deepStrictEqual({ ...w.__wlHandoff }, { at: JWT });
  const supa = fakeSupa(null);
  w.PreviewHandoff.apply(supa);
  assert.deepStrictEqual({ ...supa.auth.set }, { access_token: JWT, refresh_token: 'handoff' });
  assert.strictEqual(w.__wlHandoff, null);
});

test('prévisualisation : jeton malformé ou « none » → aucune session, aucune boucle', () => {
  for (const frag of ['none', 'pas-du-base64!!', env(PREVIEW + '/').w.PreviewHandoff._b64e(JSON.stringify({ at: 'x' })), env(PREVIEW + '/').w.PreviewHandoff._b64e('{"at":42}')]) {
    const { w, calls } = env(PREVIEW + '/#wl_handoff=' + frag);
    assert.strictEqual(w.__wlHandoff, undefined, frag);
    assert.deepStrictEqual(calls.replace, [], frag);
  }
});

test('intégration : script chargé avant la page d\'accueil, hooks en place, aucun jeton réel dans le code', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(html.indexOf('/js/00-preview-handoff.js') > 0 && html.indexOf('/js/00-preview-handoff.js') < html.indexOf('/js/00-landing-gate.js'));
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'js', '01-config.js'), 'utf8'), /PreviewHandoff\.apply\(supa\)/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'js', '00-landing-gate.js'), 'utf8'), /__wlHandoff\)member=true/);
  assert.ok(!/eyJ[A-Za-z0-9_-]{20,}/.test(src), 'aucun jeton dans le code');
});
