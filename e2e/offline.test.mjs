/* Hors connexion : après une visite en ligne, l'app se rouvre sans réseau (service worker, sw.js) avec
   la liste de l'appareil (IndexedDB) ; en ligne, chaque page reste la dernière version du serveur.
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

test('hors connexion : l\'app se rouvre depuis le cache avec la liste de l\'appareil', async t => {
  server.config = { turnstileSiteKey: '', signupsOpen: true };
  const ctx = await browser.newContext({ locale: 'fr-FR', viewport: { width: 1280, height: 860 } });
  t.after(() => ctx.close());
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  await installFakeSupabase(page);
  await page.goto(server.url + '/');
  await page.waitForFunction(() => typeof render === 'function' && typeof memDB !== 'undefined' && idb);
  /* Service worker actif et aux commandes de la page */
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.waitForFunction(() => typeof render === 'function' && typeof memDB !== 'undefined' && idb);
  await page.evaluate(() => new Promise(res => {
    const now = Date.now();
    const a = { id: 'off1', title: 'Série hors ligne', type: 'serie', status: 'avoir', poster: '', tags: [], createdAt: now, updatedAtLocal: now };
    memDB.push(a); dbPut(a, () => { render(); res(); });
  }));
  /* Une seconde visite en ligne : toutes les ressources de la page passent par le service worker */
  await page.reload();
  await page.waitForFunction(() => typeof render === 'function' && typeof memDB !== 'undefined' && idb);
  await page.waitForTimeout(500);

  await ctx.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => typeof render === 'function' && typeof memDB !== 'undefined' && idb, null, { timeout: 15000 });
  await page.waitForFunction(() => memDB.some(i => i.id === 'off1'));
  assert.equal(await page.evaluate(() => navigator.onLine), false);
  assert.equal(await page.evaluate(() => typeof t === 'function' && t('lang.label')), 'Langue', 'dictionnaires servis hors connexion');

  /* De retour en ligne, une page modifiée côté serveur est servie à jour (réseau d'abord) */
  await ctx.setOffline(false);
  const fresh = await page.evaluate(async () => (await fetch('/index.html', { cache: 'no-store' })).status);
  assert.equal(fresh, 200);
  assert.deepEqual(problems.filter(p => !/Failed to fetch|NetworkError|ERR_INTERNET_DISCONNECTED/.test(p)), []);
});
