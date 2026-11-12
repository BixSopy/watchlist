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

/* Régression (capture de Pierre, 12/11) : avec une barre de défilement classique (Windows), le canvas était dimensionné sur
   innerWidth au lieu de la zone réellement affichée : image écrasée et décalée de ~15 px, bezel 25 px à gauche / 2 px à droite. */
test('barre de défilement classique : le HTML tombe pile dans la dalle (bezel gauche = bezel droit), PC puis tablette', async t => {
  const b2 = await chromium.launch({ executablePath: CHROME, headless: true, ignoreDefaultArgs: ['--hide-scrollbars'], args: ['--disable-features=OverlayScrollbar'] });
  t.after(() => b2.close());
  server.config = { turnstileSiteKey: '', signupsOpen: true };
  const page = await (await b2.newContext({ locale: 'fr-FR', viewport: { width: 1440, height: 900 } })).newPage();
  await installFakeSupabase(page, { landing: true });
  await page.goto(server.url + '/');
  await page.waitForSelector('#landing [data-lp-j]', { state: 'attached', timeout: 30000 });
  await page.waitForFunction(() => document.documentElement.classList.contains('lp-3don'), null, { timeout: 60000 });
  const bez = () => page.evaluate(() => {
    const cv = document.getElementById('lpDv3d'), scr = document.querySelector('.lp-dv-scr').getBoundingClientRect(), c = cv.getContext('2d');
    const cr = cv.getBoundingClientRect(), k = cv.width / cr.width, y = Math.round((scr.top + scr.height / 2 - cr.top) * k), row = c.getImageData(0, y, cv.width, 1).data;
    let L = -1, R = -1; for (let x = 0; x < cv.width; x++) if (row[x * 4 + 3] > 128) { if (L < 0) L = x; R = x; }
    return { sb: innerWidth - document.documentElement.clientWidth, css: cr.width, buf: cv.width, l: scr.left - L / k, r: R / k - scr.right };
  });
  await page.waitForTimeout(3000);
  let r = await bez();
  assert.ok(r.sb > 0, 'le test doit tourner avec une vraie barre de défilement');
  assert.equal(r.css, r.buf, 'le canvas est dimensionné sur la zone affichée');
  assert.ok(Math.abs(r.l - r.r) < 3 && r.l > 5, 'PC : bezel ' + JSON.stringify(r));
  const y = await page.evaluate(() => { const c = document.querySelectorAll('.lp-ch')[3], q = c.getBoundingClientRect(); return Math.round(scrollY + q.top + q.height * 0.6 - innerHeight * 0.38); });
  await page.evaluate(v => scrollTo(0, v), y);
  await page.waitForFunction(() => { const d = document.getElementById('lpDv'); return d && d.style.getPropertyValue('--bo') === '0.0000'; }, null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  r = await bez();
  assert.ok(Math.abs(r.l - r.r) < 3 && r.l > 5, 'tablette : bezel ' + JSON.stringify(r));
});
