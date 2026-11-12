/* Prototype de landing 3D « la bobine » (experience/) : chargement sans erreur sous la vraie CSP,
   chapitres pilotés par le défilement (et rejoués à l'envers), aucun défilement horizontal en 1440, 768
   et 390 px, mode « animations réduites » lisible sans scène animée. Le rendu WebGL est logiciel
   (SwiftShader) dans ce test : il vérifie le comportement, pas la cadence réelle d'un GPU.
   Lancer : cd e2e && npm test */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { startServer } from './server.mjs';

const CHROME = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
let browser, server;
before(async () => {
  if (!CHROME) throw new Error('Chrome introuvable : définis CHROME_PATH');
  browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  server = await startServer();
});
after(async () => { await browser?.close(); await server?.close(); });

async function open(t, opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.vp || { width: 1440, height: 900 }, reducedMotion: opts.reduced ? 'reduce' : 'no-preference',
    ...(opts.vp && opts.vp.width < 500 ? { isMobile: true, hasTouch: true } : {}) });
  t.after(() => ctx.close());
  const page = await ctx.newPage();
  const problems = [], external = [];
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
  page.on('request', r => { const u = new URL(r.url()); if (!/^(127\.0\.0\.1|localhost)$/.test(u.hostname) && !/^(data|blob):/.test(r.url())) external.push(r.url()); });
  await page.goto(server.url + '/experience/index.html');
  await page.waitForFunction(() => window.__xp, null, { timeout: 60000 });
  return { page, problems, external };
}

test('chargement sous la CSP du site, sans requête externe ; chapitres pilotés par le défilement, réversibles', async t => {
  const { page, problems, external } = await open(t);
  assert.equal(await page.textContent('#ldPct'), '100');
  await page.waitForFunction(() => !document.documentElement.classList.contains('booting'), null, { timeout: 15000 });
  assert.equal(await page.textContent('#chapN'), '00');
  assert.equal(await page.textContent('#soundBtn'), 'Son : coupé');
  const H = await page.evaluate(() => document.getElementById('course').offsetHeight);
  // chapitre 3 (intérieur)
  await page.evaluate(y => scrollTo(0, y), Math.round(0.7 * H));
  await page.waitForFunction(() => window.__xp.p > 0.6 && window.__xp.p < 0.8, null, { timeout: 30000 });
  await page.waitForFunction(() => document.getElementById('chapN').textContent === '03', null, { timeout: 30000 });
  await page.waitForFunction(() => window.__xp.p > 0.66, null, { timeout: 30000 });
  await page.waitForFunction(() => +getComputedStyle(document.querySelector('.chap[data-c="3"]')).opacity > 0.5, null, { timeout: 30000 });
  assert.equal(await page.evaluate(() => +getComputedStyle(document.querySelector('.chap[data-c="1"]')).opacity), 0, 'texte du chapitre 1 sorti');
  // on remonte : tout rejoue à l'envers
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForFunction(() => window.__xp.p < 0.02 && document.getElementById('chapN').textContent === '00', null, { timeout: 30000 });
  // bouton son : bascule accessible
  await page.click('#soundBtn');
  assert.equal(await page.getAttribute('#soundBtn', 'aria-pressed'), 'true');
  assert.equal(await page.textContent('#soundBtn'), 'Son : activé');
  await page.click('#soundBtn');
  assert.equal(await page.getAttribute('#soundBtn', 'aria-pressed'), 'false');
  assert.deepEqual(external, [], 'aucune requête hors du site');
  assert.deepEqual(problems, []);
});

for (const vp of [{ width: 1440, height: 900 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
  test('aucun défilement horizontal en ' + vp.width + ' px, sections finales atteignables', async t => {
    const { page, problems } = await open(t, { vp });
    await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
    await page.locator('.cta-btn').waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await page.getAttribute('.cta-btn', 'href'), '/');
    assert.deepEqual(problems, []);
  });
}

test('animations réduites : scène fixe, textes lus dans l\'ordre, sans course de défilement', async t => {
  const { page, problems } = await open(t, { reduced: true });
  assert.ok(await page.evaluate(() => document.documentElement.classList.contains('static')));
  assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('course')).display), 'none');
  for (const c of [1, 2, 3, 4]) assert.equal(await page.evaluate(n => getComputedStyle(document.querySelector('.chap[data-c="' + n + '"]')).opacity, c), '1');
  assert.deepEqual(problems, []);
});
