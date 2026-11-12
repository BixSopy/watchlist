/* Appareils 3D de la landing (landing/3d/lp3d.js) : vrai Chrome, CSP de production, Supabase simulé.
   ?lp3d=force passe outre le refus du GPU logiciel (SwiftShader en CI). */
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
  browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
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

test('3D forcé : modèles chargés, classe lp-3don, page intacte, aucune ressource externe ni violation CSP', async t => {
  const { page, problems, asked, external } = await open(t, '?lp3d=force');
  await page.waitForFunction(() => document.documentElement.classList.contains('lp-3don'), null, { timeout: 60000 });
  assert.ok(asked.includes('/landing/3d/lp3d.js'));
  for (const f of ['studio-display', 'ipad-pro', 'telephone']) assert.ok(asked.includes('/landing/3d/models/' + f + '.glb'), f);
  const h = await page.evaluate(() => document.body.getBoundingClientRect().height);
  assert.ok(h > 3000, 'la page ne doit pas s\'effondrer (hauteur ' + h + ')');
  const box = await page.evaluate(() => { const r = document.getElementById('lpDv3d').getBoundingClientRect(); return [r.width, r.height, getComputedStyle(document.getElementById('lpDv3d')).display]; });
  assert.ok(box[0] >= 1400 && box[1] >= 800 && box[2] === 'block', JSON.stringify(box));
  /* l'écran HTML reste du vrai HTML par-dessus le corps 3D */
  assert.ok(await page.evaluate(() => !!document.querySelector('.lp-dv .lp-s[data-s="0"] *')));
  assert.deepEqual(problems, []);
  assert.deepEqual([...new Set(external)].filter(h => !/image\.tmdb\.org/.test(h)), []);
});

test('?lp3d=off : aucun fichier 3D demandé, appareil CSS conservé', async t => {
  const { page, problems, asked } = await open(t, '?lp3d=off');
  await page.waitForTimeout(1500);
  assert.deepEqual(asked, []);
  assert.ok(!(await page.evaluate(() => document.documentElement.classList.contains('lp-3don'))));
  assert.deepEqual(problems, []);
});

test('mobile (< 860 px) : pas de 3D, appareil CSS d\'origine', async t => {
  const { page, problems, asked } = await open(t, '?lp3d=force', { width: 400, height: 800, mobile: true });
  await page.waitForTimeout(1500);
  assert.deepEqual(asked, []);
  assert.ok(!(await page.evaluate(() => document.documentElement.classList.contains('lp-3don'))));
  assert.deepEqual(problems, []);
});

test('sans ?lp3d=force : un GPU logiciel est refusé sans erreur, la landing reste intacte', async t => {
  const { page, problems } = await open(t, '');
  await page.waitForTimeout(3000);
  const st = await page.evaluate(() => ({ on: document.documentElement.classList.contains('lp-3don'), h: document.body.getBoundingClientRect().height }));
  assert.ok(st.h > 3000);
  assert.deepEqual(problems, []);
});
