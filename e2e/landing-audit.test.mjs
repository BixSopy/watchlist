/* Garde-fous de l'audit visuel de la landing (12/11) : vrai Chrome, CSP de production, Supabase simulé. */
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

async function open(t, opts) {
  server.config = { turnstileSiteKey: '', signupsOpen: true };
  const ctx = await browser.newContext({ locale: 'fr-FR', ...opts });
  const page = await ctx.newPage();
  await installFakeSupabase(page, { landing: true });
  t.after(() => ctx.close());
  await page.goto(server.url + '/');
  await page.waitForSelector('#landing [data-lp-j]', { state: 'attached', timeout: 30000 });
  await page.waitForTimeout(1500);
  return page;
}

/* Avant : un visiteur dont l'OS est en mode clair voyait des onglets blancs dans le formulaire (texte actif à 1,9:1),
   une liste de langues noire sur noir et « cin » invisible dans le logo. */
test('OS en mode clair : la landing reste sombre (thème, onglets du formulaire, liste de langues, logo)', async t => {
  const page = await open(t, { viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
  const lum = c => { const m = c.match(/[\d.]+/g).map(Number); return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255; };
  const r = await page.evaluate(() => {
    const cs = e => getComputedStyle(e), q = s => document.querySelector(s);
    return { theme: document.documentElement.getAttribute('data-theme'), scheme: cs(document.documentElement).colorScheme,
      tabs: cs(q('#authView .auth-tabs')).backgroundColor, sel: cs(q('.lp-foot .lang-pick')).color, word: cs(q('.lp-brand .logo-word')).color };
  });
  assert.equal(r.theme, 'dark');
  assert.equal(r.scheme, 'dark');
  assert.ok(lum(r.tabs) < 0.25, 'fond des onglets sombre : ' + r.tabs);
  assert.ok(lum(r.sel) > 0.6, 'texte de la liste de langues clair : ' + r.sel);
  assert.ok(lum(r.word) > 0.6, 'logo lisible en entier : ' + r.word);
});

for (const [w, h] of [[1366, 768], [1280, 720], [1536, 864], [1440, 900]]) {
  test(`${w}×${h} : boutons d'accueil entièrement visibles, pied de l'écran dans le cadre`, async t => {
    const page = await open(t, { viewport: { width: w, height: h } });
    await page.waitForFunction(() => document.documentElement.classList.contains('lp-3don'), null, { timeout: 60000 });
    await page.waitForTimeout(1200);
    const r = await page.evaluate(() => {
      const cta = [...document.querySelectorAll('.lp-hero .lp-cta-row a')].map(e => e.getBoundingClientRect());
      const cv = document.getElementById('lpDv3d'), c = cv.getContext('2d'), cr = cv.getBoundingClientRect(), k = cv.width / cr.width;
      const scr = document.querySelector('.lp-dv-scr').getBoundingClientRect(), x = Math.round((scr.left + scr.width / 2) * k), col = c.getImageData(x, 0, 1, cv.height).data;
      let b = -1; for (let y = 0; y < cv.height; y++) if (col[y * 4 + 3] > 40) b = y;
      return { vh: innerHeight, ctaBottom: Math.max(...cta.map(q => q.bottom)), sameRow: Math.abs(cta[0].top - cta[1].top) < 2, devBottom: b / k + cr.top };
    });
    assert.ok(r.ctaBottom <= r.vh - 16, 'boutons visibles : ' + JSON.stringify(r));
    assert.ok(r.devBottom <= r.vh - 8, 'pied de l\'écran visible : ' + JSON.stringify(r));
  });
}
