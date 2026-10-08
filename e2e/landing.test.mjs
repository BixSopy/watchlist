/* Page d'accueil publique (#landing) : nouveaux visiteurs sans compte.
   Vrai Chrome, CSP de production, Supabase simulé ({ landing: true } : aucun drapeau « déjà venu »). */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { startServer } from './server.mjs';
import { installFakeSupabase, installFakeTurnstile } from './fake-supabase.mjs';

const CHROME = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
let browser, server;
before(async () => {
  if (!CHROME) throw new Error('Chrome introuvable : définis CHROME_PATH');
  browser = await chromium.launch({ executablePath: CHROME, headless: true });
  server = await startServer();
});
after(async () => { await browser?.close(); await server?.close(); });

async function newPage(t, { turnstile = false, width = 1440, height = 900, mobile = false, locale = 'fr-FR' } = {}) {
  server.config = { turnstileSiteKey: turnstile ? '0x4AAAAAAAtestsitekey00' : '', signupsOpen: true };
  const ctx = await browser.newContext({ locale, viewport: { width, height }, ...(mobile ? { deviceScaleFactor: 2, isMobile: true, hasTouch: true } : {}) });
  const page = await ctx.newPage();
  const problems = [], external = [];
  page.on('console', m => { const x = m.text(); if (m.type() === 'error' && !/^Failed to load resource: the server responded with a status of (4\d\d)/.test(x)) problems.push(x); if (/Content Security Policy/i.test(x)) problems.push(x); });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  page.on('request', r => { const u = new URL(r.url()); if (!/^(127\.0\.0\.1|localhost)$/.test(u.hostname) && !/^(data|blob):/.test(r.url())) external.push(u.hostname + u.pathname); });
  const db = await installFakeSupabase(page, { landing: true });
  if (turnstile) await installFakeTurnstile(page);
  t.after(() => ctx.close());
  return { page, db, problems, external };
}
const visible = (page, sel) => page.locator(sel).isVisible();
const panelTitle = page => page.locator('#lpAuthHost #authViewTitle');
const msg = page => page.locator('#lpAuthHost #authMsg');
/* Sonde posée avant tout script : la page d'accueil est-elle affichée à un moment (avant chaque image) ? */
async function probeLanding(page) {
  await page.addInitScript(() => {
    window.__lpSeen = [];
    const check = tag => { const el = document.getElementById('landing'); if (el && getComputedStyle(el).display !== 'none') window.__lpSeen.push(tag); };
    document.addEventListener('DOMContentLoaded', () => check('DOMContentLoaded'));
    let n = 0; const loop = () => { check('frame' + n); if (++n < 120) requestAnimationFrame(loop); }; requestAnimationFrame(loop);
  });
}

test('visiteur sans compte : page d’accueil avec un seul h1, application masquée, aucune requête tierce', async t => {
  const { page, problems, external } = await newPage(t, { turnstile: true });
  await probeLanding(page);
  await page.goto(server.url + '/');
  await page.locator('#landing').waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('lp-guest')), true);
  const seen = await page.evaluate(() => window.__lpSeen);
  assert.ok(seen[0] === 'frame0' || seen[0] === 'DOMContentLoaded', 'accueil affiché dès la première image (et la sonde fonctionne) : ' + seen.slice(0, 3));
  assert.equal(await page.locator('h1').count(), 1, 'un seul h1 dans le document');
  assert.equal(await page.locator('#landing h1').count(), 1);
  assert.match(await page.locator('#landing h1').textContent(), /Tout ce que tu regardes/);
  for (const sel of ['.hdr', '.layout', '.app-foot']) assert.equal(await visible(page, sel), false, sel + ' masqué');
  assert.match(await page.title(), /^Cinepisode · /);
  // Sections annoncées, extension présentée comme « bientôt » (non publiée), lien vers la politique de confidentialité
  for (const id of ['#lp-features', '#lp-extension', '#lp-privacy', '#lp-faq', '#lp-join']) assert.equal(await page.locator(id).count(), 1, id);
  assert.match(await page.locator('#lp-extension').textContent(), /Bientôt sur le Chrome Web Store/i);
  assert.equal(await page.locator('#lp-privacy a[href="/confidentialite"]').count() >= 1, true);
  assert.equal(await page.locator('#landing a[href="mailto:contact@cinepisode.com"]').count() >= 1, true);
  // Le panneau contient le vrai formulaire de compte (#authView déplacé, pas une copie)
  await panelTitle(page).filter({ hasText: 'Créer un compte' }).waitFor();
  assert.equal(await page.locator('#authView').count(), 1, 'un seul conteneur de compte');
  assert.equal(await page.locator('#authMbk .auth-modal #authView').count(), 0);
  await page.waitForTimeout(600);
  assert.deepEqual(external, [], 'aucune requête vers un tiers au chargement (Turnstile attend le premier geste)');
  assert.deepEqual(problems, []);
});

test('inscription depuis l’accueil : validations et appel Supabase existants, Turnstile au premier geste, code → application', async t => {
  const { page, db, problems, external } = await newPage(t, { turnstile: true });
  await page.goto(server.url + '/');
  await page.click('.lp-hero a[data-click="lpAuth"][data-args*="signup"]');
  await panelTitle(page).filter({ hasText: 'Créer un compte' }).waitFor();
  await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'authEmail');
  await page.locator('#lpAuthHost .fake-turnstile').waitFor({ state: 'attached' });
  assert.ok(external.some(u => u.startsWith('challenges.cloudflare.com')), 'Turnstile chargé après le premier geste');
  await page.fill('#authEmail', 'nouveau@exemple.fr');
  await page.fill('#authPassword', 'court');
  await page.fill('#authPasswordConfirm', 'court');
  await page.click('#lpAuthHost .auth-submit');
  assert.match(await msg(page).textContent(), /au moins 12 caractères/);
  await page.fill('#authPassword', 'Une-phrase-de-passe-42');
  await page.fill('#authPasswordConfirm', 'Une-phrase-de-passe-42');
  await page.click('#lpAuthHost .auth-submit');
  assert.match(await msg(page).textContent(), /Accepte les conditions/);
  await page.check('#authConsent');
  await page.click('#lpAuthHost .auth-submit');
  await panelTitle(page).filter({ hasText: 'Vérifie ta boîte mail' }).waitFor();
  const signup = db.calls.find(c => c.path === '/auth/v1/signup');
  assert.equal(signup.body.email, 'nouveau@exemple.fr');
  assert.match(signup.body.gotrue_meta_security.captcha_token, /^fake-captcha-token-/);
  assert.deepEqual(signup.body.data, { lang: 'fr' });
  assert.equal(await visible(page, '#authMbk'), false, 'tout se passe dans le panneau, sans fenêtre');
  await page.fill('#authCode', '123456');
  await page.click('#lpAuthHost .auth-submit');
  await page.locator('.hdr').waitFor({ state: 'visible' });
  assert.equal(await visible(page, '#landing'), false, 'compte confirmé : l’application remplace l’accueil');
  assert.equal(await page.locator('#authMbk .auth-modal #authView').count(), 1, 'le formulaire est revenu dans la fenêtre de compte');
  assert.deepEqual(problems, []);
});

test('connexion et « Mot de passe oublié » dans le panneau, puis application ; déconnexion → accueil', async t => {
  const { page, db, problems } = await newPage(t);
  await page.goto(server.url + '/');
  await page.click('.lp-nav a[data-click="lpAuth"][data-args*="login"]');
  await panelTitle(page).filter({ hasText: 'Connexion' }).waitFor();
  await page.click('#lpAuthHost >> text=Mot de passe oublié');
  await page.fill('#authEmail', 'pierre@exemple.fr');
  await page.click('#lpAuthHost .auth-submit');
  await panelTitle(page).filter({ hasText: 'Email envoyé' }).waitFor();
  assert.ok(db.calls.some(c => c.path === '/auth/v1/recover' && c.body.email === 'pierre@exemple.fr'));
  await page.click('.lp-hero a[data-click="lpAuth"][data-args*="login"]');
  await panelTitle(page).filter({ hasText: 'Connexion' }).waitFor();
  await page.fill('#authEmail', 'pierre@exemple.fr');
  await page.fill('#authPassword', 'mauvais-mot-de-passe');
  await page.click('#lpAuthHost .auth-submit');
  await msg(page).filter({ hasText: 'Email ou mot de passe incorrect.' }).waitFor({ timeout: 8000 });
  await page.fill('#authPassword', 'Correct-Horse-42');
  await page.click('#lpAuthHost .auth-submit');
  await page.locator('.hdr').waitFor({ state: 'visible' });
  assert.equal(await visible(page, '#landing'), false);
  assert.equal(await page.title(), 'Cinepisode');
  await page.locator('#syncStatusText').filter({ hasText: /Synchronis/ }).waitFor();
  await page.click('#syncStatusPill');
  await page.click('text=Se déconnecter');
  await page.locator('#landing').waitFor({ state: 'visible' });
  await panelTitle(page).filter({ hasText: 'Connexion' }).waitFor();
  assert.equal(await visible(page, '.hdr'), false);
  assert.deepEqual(problems, []);
});

test('membre connecté : l’accueil n’apparaît jamais, même pas une image (rechargement, /en, lien profond)', async t => {
  const { page, problems } = await newPage(t);
  await page.goto(server.url + '/');
  await page.click('.lp-nav a[data-click="lpAuth"][data-args*="login"]');
  await page.fill('#authEmail', 'pierre@exemple.fr');
  await page.fill('#authPassword', 'Correct-Horse-42');
  await page.click('#lpAuthHost .auth-submit');
  await page.locator('.hdr').waitFor({ state: 'visible' });
  await probeLanding(page);
  for (const p of ['/', '/en', '/#detectes']) {
    await page.goto(server.url + p);
    await page.locator('.hdr').waitFor({ state: 'visible' });
    await page.waitForTimeout(400);
    assert.deepEqual(await page.evaluate(() => window.__lpSeen), [], 'accueil jamais affiché sur ' + p);
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('lp-member')), true);
  }
  assert.deepEqual(problems, []);
});

test('ancienne liste locale sans compte : « Ma liste sur cet appareil » ouvre l’application, mémorisé', async t => {
  const { page, problems } = await newPage(t);
  await page.goto(server.url + '/');
  await page.locator('#landing').waitFor({ state: 'visible' });
  assert.equal(await visible(page, '#lpLocalBtn'), false, 'bouton caché sans liste locale');
  await page.evaluate(() => lpOpenApp());
  await page.locator('.hdr').waitFor({ state: 'visible' });
  await page.reload();
  await page.locator('.hdr').waitFor({ state: 'visible' });
  assert.equal(await visible(page, '#landing'), false);
  assert.deepEqual(problems, []);
});

for (const width of [360, 390, 412]) {
  test(`mobile ${width} px : aucune page plus large que l’écran, h1 et formulaire lisibles`, async t => {
    const { page, problems } = await newPage(t, { width, height: 800, mobile: true });
    await page.goto(server.url + '/');
    await page.locator('#landing').waitFor({ state: 'visible' });
    await page.evaluate(() => document.querySelectorAll('#landing .lp-reveal').forEach(e => e.classList.add('in')));
    const sw = await page.evaluate(() => [document.documentElement.scrollWidth, document.body.scrollWidth, window.innerWidth]);
    assert.ok(sw[0] <= sw[2] && sw[1] <= sw[2], 'débordement horizontal : ' + JSON.stringify(sw));
    const h1 = await page.locator('#landing h1').boundingBox();
    assert.ok(h1.x >= 0 && h1.x + h1.width <= width + 0.5, 'h1 dans l’écran');
    const card = await page.locator('.lp-auth-card').boundingBox();
    assert.ok(card.x >= 0 && card.x + card.width <= width + 0.5, 'panneau dans l’écran');
    assert.deepEqual(problems, []);
  });
}

test('anglais : /en en anglais (titre, description, h1, panneau), puis navigateur en anglais sur /', async t => {
  const { page, problems } = await newPage(t, { locale: 'fr-FR' });
  await page.goto(server.url + '/en');
  await page.locator('#landing').waitFor({ state: 'visible' });
  assert.equal(await page.getAttribute('html', 'lang'), 'en');
  assert.match(await page.title(), /^Cinepisode · Free movie, series and anime tracker/);
  assert.match(await page.getAttribute('meta[name="description"]', 'content'), /^Track your movies/);
  assert.match(await page.locator('#landing h1').textContent(), /Everything you watch/);
  assert.match(await page.locator('#lp-extension').textContent(), /Coming soon to the Chrome Web Store/i);
  await panelTitle(page).filter({ hasText: 'Create an account' }).waitFor();
  assert.doesNotMatch(await page.locator('#landing').innerText(), /Créer|Connexion|séries|Gratuit/, 'aucun texte français visible');
  assert.equal(await page.locator('#landing a[data-legal="privacy"]').first().getAttribute('href'), '/privacy');
  assert.deepEqual(problems, []);
});

test('navigateur en anglais sur / : accueil en anglais', async t => {
  const { page, problems } = await newPage(t, { locale: 'en-US' });
  await page.goto(server.url + '/');
  await page.locator('#landing').waitFor({ state: 'visible' });
  assert.equal(await page.getAttribute('html', 'lang'), 'en');
  assert.match(await page.locator('#landing h1').textContent(), /Everything you watch/);
  assert.match(await page.locator('.lp-hero').innerText(), /Create my free account/i);
  assert.deepEqual(problems, []);
});
