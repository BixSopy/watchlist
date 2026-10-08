/* Interface principale sous la CSP de production, sans aucun gestionnaire d'événement écrit dans le HTML
   (plus de script-src-attr 'unsafe-inline') : les boutons passent par js/00-actions.js.
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

async function newPage(t) {
  server.config = { turnstileSiteKey: '', signupsOpen: true };
  const ctx = await browser.newContext({ locale: 'fr-FR', viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', m => { const x = m.text(); if (m.type() === 'error' && !/^Failed to load resource: the server responded with a status of (4\d\d)/.test(x)) problems.push(x); if (/Content Security Policy/i.test(x)) problems.push(x); });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  await installFakeSupabase(page);
  /* Affiche TMDB : réponse 404 locale (l'image cassée doit être masquée, sans dépendre du réseau) */
  await page.route('https://image.tmdb.org/**', r => r.fulfill({ status: 404, body: '' }));
  t.after(() => ctx.close());
  return { page, problems };
}
/* Nombre d'attributs on*= présents dans la page (doit rester à 0) */
const inlineHandlers = page => page.evaluate(() => Array.from(document.querySelectorAll('*'))
  .reduce((n, el) => n + Array.from(el.attributes).filter(a => /^on/i.test(a.name)).length, 0));

test('CSP : script-src-attr \'unsafe-inline\' retiré, un attribut onclick injecté ne s’exécute pas', async t => {
  const { page } = await newPage(t);
  const r = await page.goto(server.url + '/');
  const csp = r.headers()['content-security-policy'];
  assert.doesNotMatch(csp, /script-src-attr/);
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
  const violations = [];
  page.on('console', m => { if (/Content Security Policy/i.test(m.text())) violations.push(m.text()); });
  const ran = await page.evaluate(async () => {
    window.__pwned = false;
    const b = document.createElement('button');
    b.setAttribute('onclick', 'window.__pwned=true');
    document.body.appendChild(b); b.click(); b.remove();
    await new Promise(res => setTimeout(res, 50));
    return window.__pwned;
  });
  assert.equal(ran, false, 'le gestionnaire en ligne est bloqué par la CSP');
  await page.waitForTimeout(100);
  assert.ok(violations.length >= 1, 'violation CSP signalée');
});

test('boutons principaux : cartes, fiche, édition, épisode suivant, menu, réglages, statistiques, recherche', async t => {
  const { page, problems } = await newPage(t);
  await page.goto(server.url + '/');
  await page.waitForFunction(() => typeof render === 'function' && typeof memDB !== 'undefined' && idb);
  await page.evaluate(() => new Promise(res => {
    const now = Date.now();
    const a = { id: 'e2e1', title: 'Série en cours', type: 'serie', status: 'encours', saison: 1, episode: 3, totalEp: 10,
      poster: '/introuvable.jpg', tags: [], createdAt: now, updatedAtLocal: now };
    const b = { id: 'e2e2', title: 'Série à voir', type: 'serie', status: 'avoir', poster: '/introuvable2.jpg', tags: [], createdAt: now, updatedAtLocal: now };
    memDB.push(a, b); dbPut(a, () => dbPut(b, () => { render(); res(); }));
  }));
  /* Espion sur les sons : vérifie les sons de survol et de clic sans les entendre */
  await page.evaluate(() => { window.__sfx = []; const o = window.sfx; window.sfx = function (k) { window.__sfx.push(k); return o.apply(this, arguments); }; });
  const strip = page.locator('.ec-card').filter({ hasText: 'Série en cours' }).first();
  const card = page.locator('.card').filter({ hasText: 'Série à voir' }).first();
  await strip.waitFor();
  await card.waitFor();
  // Images cassées masquées (ancien onerror)
  await page.waitForFunction(() => ['.card .card-poster', '.ec-card .ec-poster'].every(s => { const i = document.querySelector(s); return i && i.style.display === 'none'; }));
  // Survol : son « hover » (ancien onmouseenter)
  await page.mouse.move(5, 5);
  await card.hover();
  await page.waitForFunction(() => window.__sfx.includes('hover'));
  // Épisode suivant : ne doit pas ouvrir la fiche (stopPropagation conservé)
  await strip.locator('.ec-next[data-click="quickNextEp"]').click();
  await page.waitForFunction(() => memDB.find(i => i.id === 'e2e1').episode === 4);
  await page.waitForTimeout(150);
  assert.equal(await page.locator('#plexMbk.on').count(), 0, 'la fiche ne s’ouvre pas');
  // Édition : ouvre la fenêtre d'édition, sans ouvrir la fiche ; Annuler la ferme
  await card.hover();
  await card.locator('.ibtn[data-click="editEntry"]').click();
  await page.locator('#addMbk.on').waitFor();
  assert.equal(await page.locator('#mtitle').textContent(), 'Modifier');
  assert.equal(await page.locator('#plexMbk.on').count(), 0);
  await page.click('#addMbk [data-click="closeAdd"]');
  await page.locator('#addMbk.on').waitFor({ state: 'detached' });
  // Suppression : confirmation demandée, refusée → rien ne change
  let asked = '';
  page.once('dialog', d => { asked = d.message(); d.dismiss(); });
  await card.hover();
  await card.locator('.ibtn[data-click="delEntry"]').click();
  assert.match(asked, /\S/);
  assert.equal(await page.evaluate(() => memDB.some(i => i.id === 'e2e2')), true);
  assert.equal(await page.locator('#plexMbk.on').count(), 0);
  // Clic sur une carte : ouvre la fiche
  await card.click({ position: { x: 20, y: 20 } });
  await page.locator('#plexMbk.on').waitFor();
  assert.match(await page.locator('#plexMbk').textContent(), /Série à voir/);
  await page.evaluate(() => closePlex());
  await strip.click({ position: { x: 10, y: 10 } });
  await page.locator('#plexMbk.on').waitFor();
  await page.evaluate(() => closePlex());
  // Onglets
  await page.click('.ntab[data-tab="film"]');
  assert.match(await page.getAttribute('.ntab[data-tab="film"]', 'class'), /\bon\b/);
  await page.click('.ntab[data-tab="all"]');
  // Menu → Statistiques → Fermer
  await page.click('button.hbtn[data-click="toggleMenu"]');
  await page.locator('#optMenu.on').waitFor();
  await page.click('#optMenuMain [data-click="menuStats"]');
  await page.locator('#statsMbk.on').waitFor();
  await page.click('#statsMbk [data-click="closeStats"]');
  await page.locator('#statsMbk.on').waitFor({ state: 'detached' });
  // Menu → Réglages : interrupteur (son), interrupteur de réglage, liste déroulante, curseur
  await page.click('button.hbtn[data-click="toggleMenu"]');
  await page.click('#optMenuMain [data-click="openSettings"]');
  await page.locator('#optMenuSettings [data-click="settingFn"]').first().waitFor();
  const glow = page.locator('#optMenuSettings [data-click="settingToggle"][data-args*="wl_glow_border"]');
  const glowOn = /\bon\b/.test(await glow.getAttribute('class'));
  await glow.click();
  assert.equal(/\bon\b/.test(await glow.getAttribute('class')), !glowOn);
  await page.evaluate(() => { const s = document.querySelector('#optMenuSettings select[data-change="settingSelect"][data-args*="wl_grid_cols"]'); s.value = '5'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  assert.equal(await page.evaluate(() => wlSettings.wl_grid_cols), '5');
  await page.evaluate(() => { const r = document.querySelector('#optMenuSettings input[data-input="settingRange"][data-args*="wl_glass"]'); r.value = '35'; r.dispatchEvent(new Event('input', { bubbles: true })); });
  assert.equal(await page.locator('#_rangeVal_wl_glass').textContent(), '35%');
  await page.click('#optMenuSettings [data-click="closeSettings"]');
  await page.locator('#optMenuMain').waitFor();
  /* Son : le menu se referme après ce clic (comportement inchangé : le panneau est redessiné) */
  await page.click('#optMenuMain [data-click="openSettings"]');
  const snd = await page.evaluate(() => localStorage.getItem('wl_snd'));
  await page.click('#optMenuSettings [data-click="settingFn"][data-args*="toggleSound"]');
  assert.notEqual(await page.evaluate(() => localStorage.getItem('wl_snd')), snd);
  await page.keyboard.press('Escape');
  // Recherche : ouverture puis bouton de fermeture
  await page.evaluate(() => openSearchModal(''));
  await page.locator('#searchModal.on').waitFor();
  await page.click('#searchModal [data-click="closeSearch"]');
  await page.locator('#searchModal.on').waitFor({ state: 'detached' });
  // Ajout : ouverture par le bouton, fermeture par Annuler
  await page.click('.add-btn[data-click="openAdd"]');
  await page.locator('#addMbk.on').waitFor();
  assert.equal(await page.locator('#mtitle').textContent(), 'Ajouter un titre');
  await page.click('#addMbk [data-click="closeAdd"]');
  // Compte : la pastille ouvre la connexion, le lien « mot de passe oublié » change de vue
  await page.click('#syncStatusPill');
  await page.locator('#authViewTitle').filter({ hasText: 'Connexion' }).waitFor();
  await page.click('#authView .pw-eye');
  assert.equal(await page.getAttribute('#authPassword', 'type'), 'text');
  await page.click('#authView [data-click="authGo"][data-args*="forgot"]');
  await page.locator('#authViewTitle').filter({ hasText: /oubli/i }).waitFor();
  await page.click('#authMbk [data-click="closeAuth"]');
  assert.equal(await inlineHandlers(page), 0, 'aucun attribut on*= dans la page');
  assert.ok((await page.evaluate(() => window.__sfx)).includes('click'));
  assert.deepEqual(problems, []);
});
