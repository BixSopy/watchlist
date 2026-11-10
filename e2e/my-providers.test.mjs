/* Mes plateformes : je coche mes abonnements dans Réglages → Suivi, la pastille « Sur mes plateformes »
   apparaît dans Ma liste et ne garde que ce qui y est disponible. Lancer : cd e2e && npm test */
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

test('cocher Netflix dans les réglages, puis filtrer Ma liste sur mes plateformes', async t => {
  server.config = { turnstileSiteKey: '', signupsOpen: true };
  const ctx = await browser.newContext({ locale: 'fr-FR', viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  t.after(() => ctx.close());
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  await installFakeSupabase(page);
  await page.route(u => u.pathname === '/api/tmdb', r => {
    const p = new URL(r.request().url()).searchParams.get('path') || '';
    const body = /^\/watch\/providers\/(movie|tv)$/.test(p)
      ? { results: [{ provider_id: 8, provider_name: 'Netflix', display_priorities: { FR: 0 } }, { provider_id: 337, provider_name: 'Disney Plus', display_priorities: { FR: 1 } }] }
      : { results: [], page: 1, total_pages: 1 };
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.route(/kitsu\.(io|app)|api\.tvmaze\.com|image\.tmdb\.org/, r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{}' }));
  await page.goto(server.url + '/');
  await page.waitForFunction(() => typeof render === 'function' && typeof memDB !== 'undefined' && idb);
  await page.click('#syncStatusPill');
  await page.fill('#authEmail', 'pierre@exemple.fr');
  await page.fill('#authPassword', 'Correct-Horse-42');
  await page.click('.auth-submit');
  await page.locator('#authViewTitle').filter({ hasText: 'Mon compte' }).waitFor();
  await page.click('#authMbk .auth-close');
  await page.waitForFunction(() => !syncInProgress);
  await page.evaluate(() => new Promise(res => {
    const now = Date.now();
    const mk = (id, title, prov) => ({ id, title, type: 'film', tmdbId: id.length, status: 'avoir', tags: [], createdAt: now, addedAt: now, updatedAtLocal: now, providersAt: now, streamingProviders: prov });
    const items = [mk('n1', 'Sur Netflix', [{ id: 8, name: 'Netflix' }]), mk('d1', 'Sur Disney', [{ id: 337, name: 'Disney Plus' }]), mk('x1', 'Nulle part', [])];
    let left = items.length; items.forEach(i => { memDB.push(i); dbPut(i, () => { if (!--left) { render(); res(); } }); });
  }));
  await page.click('button[data-v="list"]:visible');
  assert.equal(await page.locator('#myProvChip').isHidden(), true, 'pastille cachée tant que rien n\'est coché');

  await page.click('button.hbtn[data-click="toggleMenu"]');
  await page.click('#optMenuMain [data-click="openSettings"]');
  const chip = page.locator('#mpGrid .mp-chip', { hasText: 'Netflix' });
  await chip.waitFor();
  await chip.click();
  assert.equal(await chip.getAttribute('aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => localStorage.getItem('wl_my_providers')), '[8]');
  await page.keyboard.press('Escape');

  await page.locator('#myProvChip').waitFor({ state: 'visible' });
  const titles = () => page.evaluate(() => [...document.querySelectorAll('#mc .card .card-title')].map(e => e.textContent).sort());
  assert.deepEqual(await titles(), ['Nulle part', 'Sur Disney', 'Sur Netflix']);
  await page.click('#myProvChip');
  await page.waitForFunction(() => document.querySelectorAll('#mc .card').length === 1);
  assert.deepEqual(await titles(), ['Sur Netflix']);
  assert.equal(await page.locator('#myProvChip').getAttribute('aria-pressed'), 'true');
  await page.click('#myProvChip');
  await page.waitForFunction(() => document.querySelectorAll('#mc .card').length === 3);
  assert.deepEqual(problems, []);
});
