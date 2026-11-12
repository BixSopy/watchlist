/* Appareils de la landing rendus par Blender (landing/3d/) : vrai Chrome, CSP de production, Supabase simulé. */
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

async function open(t, query, { width = 1440, height = 900, mobile = false } = {}) {
  server.config = { turnstileSiteKey: '', signupsOpen: true };
  const ctx = await browser.newContext({ locale: 'fr-FR', viewport: { width, height }, ...(mobile ? { deviceScaleFactor: 2, isMobile: true, hasTouch: true } : {}) });
  const page = await ctx.newPage();
  const problems = [], asked = [], external = [];
  page.on('console', m => { const x = m.text(); if (m.type() === 'error' && !/^Failed to load resource: the server responded with a status of (4\d\d)/.test(x)) problems.push(x); if (/Content Security Policy/i.test(x)) problems.push(x); });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  page.on('request', r => { const u = new URL(r.url()); if (/^\/landing\/3d\//.test(u.pathname)) asked.push(u.pathname); if (!/^(127\.0\.0\.1|localhost)$/.test(u.hostname) && !/^(data|blob):/.test(r.url())) external.push(u.hostname); });
  await installFakeSupabase(page, { landing: true });
  t.after(() => ctx.close());
  await page.goto(server.url + '/' + query);
  await page.waitForSelector('#landing [data-lp-j]', { state: 'attached', timeout: 30000 });
  return { page, problems, asked, external };
}

test('3D : images Blender du PC chargées, classe lp-3don, écran HTML posé sur la dalle de l’image, aucune ressource externe ni violation CSP', async t => {
  const { page, problems, asked, external } = await open(t, '');
  await page.waitForFunction(() => document.documentElement.classList.contains('lp-3don'), null, { timeout: 60000 });
  assert.ok(asked.includes('/landing/3d/lp3d.js') && asked.includes('/landing/3d/img/manifest.json'));
  for (const k of ['pc', 'tab', 'ph']) assert.ok(asked.includes('/landing/3d/img/' + k + '.webp') || k !== 'pc', 'image ' + k);
  const h = await page.evaluate(() => document.body.getBoundingClientRect().height);
  assert.ok(h > 3000, 'la page ne doit pas s\'effondrer (hauteur ' + h + ')');
  const st = await page.evaluate(() => {
    const dv = document.getElementById('lpDv'), cv = document.getElementById('lpDv3d'), r = cv.getBoundingClientRect();
    return { tr: dv.style.transform, org: dv.style.transformOrigin, cw: r.width, chh: r.height, disp: getComputedStyle(cv).display, scr: !!document.querySelector('.lp-dv .lp-s[data-s="0"] *') };
  });
  assert.ok(/^translate\(.*\) scale\(/.test(st.tr) && st.org === '0px 0px', st.tr + ' / ' + st.org);
  assert.ok(st.cw >= 1400 && st.chh >= 800 && st.disp === 'block', JSON.stringify(st));
  assert.ok(st.scr, 'l\'écran reste du vrai HTML');
  assert.deepEqual(problems, []);
  assert.deepEqual([...new Set(external)].filter(x => !/image\.tmdb\.org/.test(x)), []);
});

test('3D : l\'appareil ne bouge pas tout seul (aucune transformation qui change sans défilement)', async t => {
  const { page, problems } = await open(t, '');
  await page.waitForFunction(() => document.documentElement.classList.contains('lp-3don'), null, { timeout: 60000 });
  await page.mouse.move(200, 200);
  const a = await page.evaluate(() => document.getElementById('lpDv').style.transform);
  await page.mouse.move(1200, 700); await page.waitForTimeout(1800);
  const b = await page.evaluate(() => document.getElementById('lpDv').style.transform);
  assert.equal(a, b, 'ni suivi du curseur, ni flottement');
  assert.deepEqual(problems, []);
});

test('?lp3d=off : aucun fichier 3D demandé, appareil CSS conservé', async t => {
  const { page, problems, asked } = await open(t, '?lp3d=off');
  await page.waitForTimeout(1500);
  assert.deepEqual(asked, []);
  assert.ok(!(await page.evaluate(() => document.documentElement.classList.contains('lp-3don'))));
  assert.deepEqual(problems, []);
});

test('mobile (< 860 px) : pas de 3D, appareil CSS d\'origine', async t => {
  const { page, problems, asked } = await open(t, '', { width: 400, height: 800, mobile: true });
  await page.waitForTimeout(1500);
  assert.deepEqual(asked, []);
  assert.ok(!(await page.evaluate(() => document.documentElement.classList.contains('lp-3don'))));
  assert.deepEqual(problems, []);
});
