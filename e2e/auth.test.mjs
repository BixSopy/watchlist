/* Tests de bout en bout des écrans de compte, dans un vrai Chrome, avec la CSP de production.
   Lancer : cd e2e && npm install && npm test   (CHROME_PATH pour un autre navigateur ;
   SCREENSHOTS=dossier pour enregistrer des captures des écrans). */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { startServer } from './server.mjs';
import { installFakeSupabase, installFakeTurnstile } from './fake-supabase.mjs';

const CHROME = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
const SHOTS = process.env.SCREENSHOTS || '';
let browser, server;

before(async () => {
  if (!CHROME) throw new Error('Chrome introuvable : définis CHROME_PATH');
  browser = await chromium.launch({ executablePath: CHROME, headless: true });
  server = await startServer();
});
after(async () => { await browser?.close(); await server?.close(); });

async function newPage(t, { turnstile = false, mobile = false } = {}) {
  server.config = { turnstileSiteKey: turnstile ? '0x4AAAAAAAtestsitekey00' : '', signupsOpen: true };
  const ctx = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', m => { const x = m.text(); if (m.type() === 'error' && !/^Failed to load resource: the server responded with a status of (4\d\d)/.test(x)) problems.push(x); if (/Content Security Policy/i.test(x)) problems.push(x); });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  const db = await installFakeSupabase(page);
  if (turnstile) await installFakeTurnstile(page);
  t.after(() => ctx.close());
  return { page, db, problems };
}
async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.locator('#authMbk .auth-modal').screenshot({ path: path.join(SHOTS, name + '.png') });
}
const title = page => page.locator('#authViewTitle');
const msg = page => page.locator('#authMsg');

test('inscription : validation du mot de passe, consentement, puis écran « vérifie ta boîte mail »', async t => {
  const { page, db, problems } = await newPage(t, { turnstile: true });
  await page.goto(server.url + '/');
  await page.click('#syncStatusPill');
  await assert.doesNotReject(title(page).filter({ hasText: 'Connexion' }).waitFor());
  await shot(page, '01-connexion');
  await page.click('#authTabSignup');
  await title(page).filter({ hasText: 'Créer un compte' }).waitFor();
  await page.fill('#authEmail', 'nouveau@exemple.fr');
  await page.fill('#authPassword', 'court');
  await page.fill('#authPasswordConfirm', 'court');
  await page.click('.auth-submit');
  assert.match(await msg(page).textContent(), /au moins 12 caractères/);
  await page.fill('#authPassword', 'Une-phrase-de-passe-42');
  await page.fill('#authPasswordConfirm', 'Une-phrase-de-passe-42');
  assert.match(await page.locator('.pw-meter-lbl').textContent(), /Solide|Excellent/);
  await page.click('.auth-submit');
  assert.match(await msg(page).textContent(), /Accepte les conditions/);
  await page.check('#authConsent');
  await page.locator('.fake-turnstile').waitFor({ state: 'attached' });
  await shot(page, '02-inscription');
  await page.click('.auth-submit');
  await title(page).filter({ hasText: 'Vérifie ta boîte mail' }).waitFor();
  const signup = db.calls.find(c => c.path === '/auth/v1/signup');
  assert.equal(signup.body.email, 'nouveau@exemple.fr');
  assert.match(signup.body.gotrue_meta_security.captcha_token, /^fake-captcha-token-/, 'le jeton Turnstile est transmis à Supabase');
  assert.equal(new URL(signup.search, 'http://x').searchParams.get('redirect_to'), server.url + '/');
  assert.equal(await page.locator('#authResendBtn').isDisabled(), true, 'renvoi bloqué pendant 60 s');
  await shot(page, '03-verifie-ta-boite');
  // Code à 6 chiffres reçu par email
  await page.fill('#authCode', '123456');
  await page.click('.auth-submit');
  await title(page).filter({ hasText: 'Mon compte' }).waitFor();
  const verify = db.calls.find(c => c.path === '/auth/v1/verify');
  assert.deepEqual({ email: verify.body.email, token: verify.body.token, type: verify.body.type }, { email: 'nouveau@exemple.fr', token: '123456', type: 'email' });
  assert.deepEqual(problems, []);
});

test('connexion : erreurs en français, puis compte et déconnexion', async t => {
  const { page, problems } = await newPage(t);
  await page.goto(server.url + '/');
  await page.click('#syncStatusPill');
  await page.fill('#authEmail', 'pierre@exemple.fr');
  await page.fill('#authPassword', 'mauvais-mot-de-passe');
  await page.click('.auth-submit');
  await msg(page).filter({ hasText: 'Email ou mot de passe incorrect.' }).waitFor({ timeout: 8000 }).catch(async e => {
    throw new Error(e.message + ' | message affiché : ' + await msg(page).textContent() + ' | vue : ' + await title(page).textContent());
  });
  assert.equal(await page.locator('.auth-captcha').isVisible(), false, 'pas de CAPTCHA sans clé configurée');
  await page.fill('#authPassword', 'Correct-Horse-42');
  await page.click('.auth-submit');
  await title(page).filter({ hasText: 'Mon compte' }).waitFor();
  assert.equal(await page.locator('#authAccountEmail').textContent(), 'pierre@exemple.fr');
  await page.locator('#syncStatusText').filter({ hasText: /Synchronis/ }).waitFor();
  await shot(page, '04-mon-compte');
  await page.click('text=Se déconnecter');
  await page.locator('#syncStatusText').filter({ hasText: 'Se connecter' }).waitFor();
  assert.deepEqual(problems, []);
});

test('mot de passe oublié → lien reçu (token_hash) → nouveau mot de passe', async t => {
  const { page, db, problems } = await newPage(t);
  await page.goto(server.url + '/');
  await page.click('#syncStatusPill');
  await page.click('text=Mot de passe oublié');
  await page.fill('#authEmail', 'pierre@exemple.fr');
  await page.click('.auth-submit');
  await title(page).filter({ hasText: 'Email envoyé' }).waitFor();
  assert.ok(db.calls.some(c => c.path === '/auth/v1/recover' && c.body.email === 'pierre@exemple.fr'));
  // Clic sur le lien de l'email (format des gabarits supabase/templates/recovery.html)
  await page.goto(server.url + '/?action=recovery&type=recovery&token_hash=pkce_0123456789abcdef0123456789abcdef');
  await title(page).filter({ hasText: 'Nouveau mot de passe' }).waitFor();
  assert.equal(new URL(page.url()).search, '', 'le jeton est retiré de l’adresse');
  assert.equal(db.calls.filter(c => c.path === '/auth/v1/verify').length, 0, 'rien n’est consommé avant le clic');
  await shot(page, '05-lien-recu');
  await page.click('.auth-submit');
  await title(page).filter({ hasText: 'Choisis un nouveau mot de passe' }).waitFor();
  const v = db.calls.find(c => c.path === '/auth/v1/verify');
  assert.deepEqual({ token_hash: v.body.token_hash, type: v.body.type }, { token_hash: 'pkce_0123456789abcdef0123456789abcdef', type: 'recovery' });
  await page.fill('#authPassword', 'Nouveau-Secret-2026!');
  await page.fill('#authPasswordConfirm', 'Nouveau-Secret-2026!');
  await shot(page, '06-nouveau-mot-de-passe');
  await page.click('.auth-submit');
  await title(page).filter({ hasText: 'Mon compte' }).waitFor();
  assert.equal(db.users[0].password, 'Nouveau-Secret-2026!');
  assert.deepEqual(problems, []);
});

test('lien expiré : message clair et proposition d’un nouveau lien', async t => {
  const { page, problems } = await newPage(t);
  await page.goto(server.url + '/?action=signup&type=email&token_hash=expired-token-hash');
  await title(page).filter({ hasText: 'Confirme ton adresse' }).waitFor();
  await page.click('.auth-submit');
  await title(page).filter({ hasText: 'Lien invalide' }).waitFor();
  assert.match(await page.locator('#authView').textContent(), /expiré ou a déjà été utilisé/);
  // Ancien format d'erreur renvoyé par Supabase dans le fragment
  await page.goto('about:blank');
  await page.goto(server.url + '/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
  await title(page).filter({ hasText: 'Lien invalide' }).waitFor();
  assert.equal(new URL(page.url()).hash, '');
  await shot(page, '07-lien-expire');
  assert.deepEqual(problems, []);
});

test('« J’ai un code » : code saisi sur un autre appareil, sans demande préalable', async t => {
  const { page, db, problems } = await newPage(t);
  await page.goto(server.url + '/');
  await page.click('#syncStatusPill');
  await page.click('text=J\'ai un code');
  await title(page).filter({ hasText: 'J\'ai un code' }).waitFor();
  await page.fill('#authEmail', 'pierre@exemple.fr');
  await page.fill('#authCode', '12 34 5');
  await page.click('.auth-submit');
  assert.match(await msg(page).textContent(), /6 chiffres/);
  await page.fill('#authCode', '123456');
  await shot(page, '10-j-ai-un-code');
  await page.click('.auth-submit');
  await title(page).filter({ hasText: 'Mon compte' }).waitFor();
  assert.equal(db.calls.find(c => c.path === '/auth/v1/verify').body.type, 'email');
  assert.deepEqual(problems, []);
});

test('suppression de compte : confirmation SUPPRIMER + mot de passe, puis RPC delete_my_account', async t => {
  const { page, db, problems } = await newPage(t, { turnstile: true });
  await page.goto(server.url + '/');
  await page.click('#syncStatusPill');
  await page.fill('#authEmail', 'pierre@exemple.fr');
  await page.fill('#authPassword', 'Correct-Horse-42');
  await page.click('.auth-submit');
  await title(page).filter({ hasText: 'Mon compte' }).waitFor();
  await page.click('text=Supprimer mon compte');
  await title(page).filter({ hasText: 'Supprimer mon compte' }).waitFor();
  assert.equal(await page.locator('#authDeleteBtn').isDisabled(), true);
  await page.fill('#authPassword', 'Correct-Horse-42');
  await page.fill('#authDeleteConfirm', 'supprimer');
  await shot(page, '08-suppression');
  await page.click('#authDeleteBtn');
  await title(page).filter({ hasText: 'Connexion' }).waitFor();
  assert.equal(db.deleted, true);
  const logins = db.calls.filter(c => c.path === '/auth/v1/token');
  assert.equal(logins.length, 2, 'reconnexion juste avant la suppression');
  assert.match(logins[1].body.gotrue_meta_security.captcha_token, /^fake-captcha-token-/);
  assert.deepEqual(problems, []);
});

test('mobile : modal lisible et catalogue verrouillé sans compte', async t => {
  const { page, problems } = await newPage(t, { mobile: true });
  await page.goto(server.url + '/');
  await page.click('#syncStatusPill');
  await title(page).filter({ hasText: 'Connexion' }).waitFor();
  const box = await page.locator('#authMbk .auth-modal').boundingBox();
  const vw = await page.evaluate(() => [window.innerWidth, document.documentElement.scrollWidth]);
  assert.ok(box.width <= vw[0] + 0.5, 'le modal tient dans l’écran : ' + JSON.stringify({ box, vw }));
  await shot(page, '09-mobile-connexion');
  assert.deepEqual(problems, []);
});

test('indexation : noindex hors du domaine de production, robots.txt et sitemap.xml servis', async t => {
  const { page } = await newPage(t);
  const r = await page.goto(server.url + '/');
  assert.match(r.headers()['x-robots-tag'] || '', /noindex/, 'preview / autre hôte : noindex');
  const robots = await page.request.get(server.url + '/robots.txt');
  assert.equal(robots.status(), 200);
  assert.match(await robots.text(), /Sitemap: https:\/\/cinepisode\.com\/sitemap\.xml/);
  const sm = await page.request.get(server.url + '/sitemap.xml');
  assert.equal(sm.status(), 200);
  assert.match(await sm.text(), /<loc>https:\/\/cinepisode\.com\/confidentialite<\/loc>/);
});

test('pages légales servies avec l’attribution TMDB', async t => {
  const { page, problems } = await newPage(t);
  for (const p of ['/confidentialite', '/conditions']) {
    const r = await page.goto(server.url + p);
    assert.equal(r.status(), 200, p);
    assert.match(await page.textContent('body'), /TMDB/);
  }
  assert.match(await page.textContent('body'), /This product uses the TMDB API but is not endorsed or certified by TMDB/);
  assert.equal(await page.locator('img[src*="tmdb-logo"]').evaluate(i => i.naturalWidth > 0), true);
  assert.deepEqual(problems, []);
});
