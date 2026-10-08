/* « Donner mon avis » : fenêtre ouverte depuis le pied de la page d'accueil (sans compte) et depuis le
   menu de l'app (connecté, email prérempli), validations, envoi à /api/feedback (simulé), erreurs,
   fermeture par Échap / bouton retour, affichage mobile 390 px. Vrai Chrome, CSP de production.
   Lancer : cd e2e && npm test */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { startServer } from './server.mjs';
import { installFakeSupabase } from './fake-supabase.mjs';

const CHROME = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
let browser, server;
before(async () => {
  if (!CHROME) throw new Error('Chrome introuvable : définis CHROME_PATH');
  browser = await chromium.launch({ executablePath: CHROME, headless: true });
  server = await startServer();
});
after(async () => { await browser?.close(); await server?.close(); });

async function newPage(t, { landing = false, width = 1440, height = 900, mobile = false, api = () => ({ status: 200, body: { ok: true } }) } = {}) {
  const ctx = await browser.newContext({ locale: 'fr-FR', viewport: { width, height }, ...(mobile ? { deviceScaleFactor: 2, isMobile: true, hasTouch: true } : {}) });
  const page = await ctx.newPage();
  const problems = [], external = [], sent = [];
  page.on('console', m => { const x = m.text(); if (m.type() === 'error' && !/^Failed to load resource: the server responded with a status of (4\d\d|5\d\d)/.test(x)) problems.push(x); if (/Content Security Policy/i.test(x)) problems.push(x); });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  page.on('request', r => { const u = new URL(r.url()); if (!/^(127\.0\.0\.1|localhost)$/.test(u.hostname) && !/^(data|blob):/.test(r.url()) && u.hostname !== 'batfulcvvquffgfeppcx.supabase.co') external.push(u.hostname + u.pathname); });
  const db = await installFakeSupabase(page, { landing });
  await page.route(/\/api\/feedback$/, async route => {
    const req = route.request();
    sent.push({ method: req.method(), headers: req.headers(), body: req.postDataJSON() });
    const r = api(sent.length);
    await route.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(r.body) });
  });
  t.after(() => ctx.close());
  return { page, db, problems, external, sent };
}
async function login(page) {
  await page.click('#syncStatusPill');
  await page.fill('#authEmail', 'pierre@exemple.fr');
  await page.fill('#authPassword', 'Correct-Horse-42');
  await page.click('.auth-submit');
  await page.locator('#authViewTitle').filter({ hasText: 'Mon compte' }).waitFor();
  await page.click('#authMbk .auth-close');
  await page.locator('#authMbk').waitFor({ state: 'hidden' });
}
const msg = page => page.locator('#fbMsg');

test('accueil sans compte : pied de page → fenêtre, validations, envoi sans session, remerciement, aucune requête tierce', async t => {
  const { page, problems, external, sent } = await newPage(t, { landing: true });
  await page.goto(server.url + '/');
  await page.locator('#landing').waitFor({ state: 'visible' });
  const btn = page.locator('.lp-foot button[data-click="openFeedback"]');
  assert.equal((await btn.textContent()).trim(), 'Donner mon avis');
  await btn.click();
  await page.locator('#fbMbk').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#fbTitle').textContent(), 'Donner mon avis');
  assert.equal(await page.locator('#fbEmail').inputValue(), '', 'pas d\'adresse sans compte');
  assert.equal(await page.locator('input[name="fbKind"]:checked').inputValue(), 'idea');
  assert.match(await page.locator('.fb-privacy').textContent(), /24 mois/);
  assert.equal(await page.locator('.fb-privacy a').getAttribute('href'), '/confidentialite');
  // Le formulaire a le focus sur ordinateur
  assert.equal(await page.evaluate(() => document.activeElement.id), 'fbText');
  // Validations côté navigateur : rien n'est envoyé
  await page.click('#fbSend');
  await msg(page).filter({ hasText: 'au moins 3 caractères' }).waitFor();
  await page.fill('#fbText', 'Le site est top, il manque un calendrier des sorties.');
  await page.fill('#fbEmail', 'pas-un-email');
  await page.click('#fbSend');
  await msg(page).filter({ hasText: 'ne semble pas valide' }).waitFor();
  assert.equal(sent.length, 0);
  assert.match(await page.locator('#fbCount').textContent(), /^5\d \/ 2[\s ]?000$/);
  // Type « Bug » : l'exemple du champ change
  await page.click('.fb-kind:has(input[value="bug"])');
  assert.match(await page.locator('#fbText').getAttribute('placeholder'), /Sur quel écran/);
  await page.fill('#fbEmail', 'visiteur@exemple.fr');
  await page.click('#fbSend');
  await page.locator('.fb-done').waitFor();
  assert.equal(sent.length, 1);
  const s = sent[0];
  assert.equal(s.method, 'POST');
  assert.equal(s.headers['content-type'], 'application/json');
  assert.equal(s.headers.authorization, undefined, 'aucune session envoyée sans compte');
  assert.equal(s.body.kind, 'bug');
  assert.equal(s.body.message, 'Le site est top, il manque un calendrier des sorties.');
  assert.equal(s.body.reply_email, 'visiteur@exemple.fr');
  assert.equal(s.body.context, 'landing');
  assert.equal(s.body.locale, 'fr');
  assert.equal(s.body.website, '', 'champ piège vide pour un humain');
  assert.equal(typeof s.body.elapsed, 'number');
  assert.match(await page.locator('.fb-done').textContent(), /Merci[\s\S]*visiteur@exemple\.fr/);
  await page.click('#fbDoneClose');
  await page.locator('#fbMbk').waitFor({ state: 'hidden' });
  // Rouverte : brouillon vidé après un envoi réussi
  await btn.click();
  assert.equal(await page.locator('#fbText').inputValue(), '');
  assert.equal(await page.locator('#fbEmail').inputValue(), 'visiteur@exemple.fr', 'adresse saisie gardée pour la session');
  await page.keyboard.press('Escape');
  await page.locator('#fbMbk').waitFor({ state: 'hidden' });
  assert.deepEqual(external, [], 'aucune requête vers un tiers');
  assert.deepEqual(problems, []);
});

test('app connectée : menu → fenêtre, email du compte prérempli et effaçable, session envoyée ; bouton retour ferme', async t => {
  const { page, problems, external, sent } = await newPage(t);
  await page.goto(server.url + '/');
  await login(page);
  await page.click('.hdr-right .hbtn[data-click="toggleMenu"]');
  await page.locator('#optMenu button[data-click="menuFeedback"]').click();
  await page.locator('#fbMbk').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#optMenu').evaluate(e => e.classList.contains('on')), false, 'menu refermé');
  assert.equal(await page.locator('#fbEmail').inputValue(), 'pierre@exemple.fr', 'adresse du compte proposée');
  // Brouillon gardé si on ferme par erreur ; bouton retour du téléphone = fermeture
  await page.fill('#fbText', 'Idée : une vue « À venir » avec les prochains épisodes.');
  await page.waitForFunction(() => window._modalHistory.stack().includes('fbMbk'));
  await page.goBack();
  await page.locator('#fbMbk').waitFor({ state: 'hidden' });
  assert.ok(page.url().startsWith(server.url), 'on reste sur le site');
  await page.click('.hdr-right .hbtn[data-click="toggleMenu"]');
  await page.locator('#optMenu button[data-click="menuFeedback"]').click();
  assert.equal(await page.locator('#fbText').inputValue(), 'Idée : une vue « À venir » avec les prochains épisodes.', 'brouillon retrouvé');
  // L'utilisateur efface l'adresse : envoi sans adresse de réponse
  await page.fill('#fbEmail', '');
  await page.click('#fbSend');
  await page.locator('.fb-done').waitFor();
  assert.equal(sent.length, 1);
  assert.match(sent[0].headers.authorization || '', /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/, 'session jointe pour rattacher l\'avis au compte');
  assert.equal(sent[0].body.reply_email, null);
  assert.equal(sent[0].body.context, 'app');
  assert.match(await page.locator('.fb-done').textContent(), /pas laissé d’adresse/);
  // Fermeture par le fond
  await page.mouse.click(5, 5);
  await page.locator('#fbMbk').waitFor({ state: 'hidden' });
  assert.deepEqual(external, []);
  assert.deepEqual(problems, []);
});

test('erreurs : trop d\'envois (429) puis serveur indisponible (503), message clair et adresse de contact', async t => {
  const { page, problems, sent } = await newPage(t, { landing: true, api: n => n === 1
    ? { status: 429, body: { error: 'rate_limited', message: 'x' } } : { status: 503, body: { error: 'unavailable', message: 'x' } } });
  await page.goto(server.url + '/');
  await page.click('.lp-foot button[data-click="openFeedback"]');
  await page.fill('#fbText', 'Un message de test assez long.');
  await page.click('#fbSend');
  await msg(page).filter({ hasText: 'plusieurs avis d’affilée' }).waitFor();
  assert.equal(await page.locator('#fbSend').isDisabled(), false, 'bouton de nouveau actif');
  await page.click('#fbSend');
  await msg(page).filter({ hasText: 'L’envoi n’a pas abouti' }).waitFor();
  assert.equal(await msg(page).locator('a[href="mailto:contact@cinepisode.com"]').count(), 1);
  assert.equal(await page.locator('#fbText').inputValue(), 'Un message de test assez long.', 'message conservé');
  assert.equal(sent.length, 2);
  assert.deepEqual(problems, []);
});

test('anglais : textes traduits', async t => {
  const { page } = await newPage(t, { landing: true });
  await page.goto(server.url + '/en');
  await page.click('.lp-foot button[data-click="openFeedback"]');
  assert.equal(await page.locator('#fbTitle').textContent(), 'Send feedback');
  assert.deepEqual(await page.locator('.fb-kind span').allTextContents(), ['Idea', 'Bug', 'Other']);
  assert.equal((await page.locator('#fbSend').textContent()).trim(), 'Send');
  assert.equal(await page.locator('.fb-privacy a').getAttribute('href'), '/privacy');
});

test('mobile 390 px : plein écran, rien ne dépasse, champs à 16 px, cibles de 44 px', async t => {
  const { page, problems } = await newPage(t, { landing: true, width: 390, height: 844, mobile: true });
  await page.goto(server.url + '/');
  await page.locator('.lp-foot button[data-click="openFeedback"]').scrollIntoViewIfNeeded();
  const footBtn = await page.locator('.lp-foot button[data-click="openFeedback"]').boundingBox();
  assert.ok(footBtn.height >= 44, 'bouton du pied de page : ' + footBtn.height);
  await page.locator('.lp-foot button[data-click="openFeedback"]').tap();
  await page.locator('#fbMbk').waitFor({ state: 'visible' });
  await page.waitForTimeout(400); /* fin de l'animation d'ouverture (scaleIn) */
  const m = await page.evaluate(() => {
    const r = sel => document.querySelector(sel).getBoundingClientRect();
    const fs = sel => parseFloat(getComputedStyle(document.querySelector(sel)).fontSize);
    const panel = r('#fbMbk .fb-modal');
    return {
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      panelOverflow: document.querySelector('#fbMbk .fb-modal').scrollWidth - document.querySelector('#fbMbk .fb-modal').clientWidth,
      panelW: panel.width, vw: window.innerWidth,
      textFs: fs('#fbText'), emailFs: fs('#fbEmail'),
      kinds: [...document.querySelectorAll('.fb-kind span')].map(s => s.getBoundingClientRect().height),
      send: r('#fbSend').height, close: r('#fbMbk .auth-close').height, closeW: r('#fbMbk .auth-close').width,
      focus: document.activeElement && document.activeElement.id,
    };
  });
  assert.ok(m.overflow <= 0, 'page : ' + m.overflow);
  assert.ok(m.panelOverflow <= 0, 'fenêtre : ' + m.panelOverflow);
  assert.equal(Math.round(m.panelW), m.vw, 'plein écran');
  assert.equal(m.textFs, 16); assert.equal(m.emailFs, 16);
  for (const h of m.kinds) assert.ok(h >= 44, 'type : ' + h);
  assert.ok(m.send >= 44 && m.close >= 44 && m.closeW >= 44, JSON.stringify(m));
  assert.equal(m.focus, 'fbTitle', 'pas de clavier ouvert d\'office sur téléphone');
  await page.locator('#fbMbk .auth-close').tap();
  await page.locator('#fbMbk').waitFor({ state: 'hidden' });
  assert.deepEqual(problems, []);
});
