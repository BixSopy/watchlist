/* Passerelle de session vers les prévisualisations Vercel (js/00-preview-handoff.js), dans un vrai Chrome.
   Les hôtes https de production et de prévisualisation sont servis par le serveur de test (context.route),
   le Supabase est simulé : on vérifie le parcours complet prévisualisation → production → prévisualisation.
   Lancer : cd e2e && npm test */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { startServer } from './server.mjs';
import { installFakeSupabase } from './fake-supabase.mjs';

const CHROME = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
const brand = JSON.parse(fs.readFileSync(new URL('../brand.config.json', import.meta.url), 'utf8'));
const PROD = brand.baseUrl;
const PREV = 'https://watchlist-git-test-pierre-unbekand-s-projects.vercel.app';
const EVIL = 'https://evil-watchlist-pierre-unbekand-s-projects.example.com';
const KEY = 'sb-batfulcvvquffgfeppcx-auth-token';
let browser, server;
before(async () => {
  if (!CHROME) throw new Error('Chrome introuvable : définis CHROME_PATH');
  browser = await chromium.launch({ executablePath: CHROME, headless: true });
  server = await startServer();
});
after(async () => { await browser?.close(); await server?.close(); });

async function newCtx(t) {
  const ctx = await browser.newContext({ locale: 'fr-FR', colorScheme: 'dark', viewport: { width: 1100, height: 800 } });
  t.after(() => ctx.close());
  const nav = [];
  const hosts = [PROD, PREV, EVIL].map(u => new URL(u).host);
  await ctx.route(u => hosts.includes(u.host), async route => {
    const u = new URL(route.request().url()); nav.push(route.request().url());
    const r = await fetch(server.url + u.pathname + u.search);
    const headers = {}; r.headers.forEach((v, k) => { if (!/content-encoding|content-length|transfer-encoding/i.test(k)) headers[k] = v; });
    await route.fulfill({ status: r.status, headers, body: Buffer.from(await r.arrayBuffer()) });
  });
  const open = async () => { const p = await ctx.newPage(); await installFakeSupabase(p, { landing: true }); await p.route('https://image.tmdb.org/**', r => r.fulfill({ status: 404, body: '' })); return p; };
  return { ctx, open, nav };
}
const ready = p => p.waitForFunction(() => typeof supa !== 'undefined' && supa);
const session = p => p.evaluate(async () => { const s = (await supa.auth.getSession()).data.session; return s ? { email: s.user && s.user.email, refresh: s.refresh_token } : null; });
const login = p => p.evaluate(async () => !!(await supa.auth.signInWithPassword({ email: 'pierre@exemple.fr', password: 'Correct-Horse-42' })).data.session);

test('production connectée : la prévisualisation s\'ouvre sur le même compte, sans jeton réel ni trace dans l\'adresse', async t => {
  const { open } = await newCtx(t);
  const page = await open();
  await page.goto(PROD + '/'); await ready(page);
  assert.ok(await login(page));
  const prodRefresh = (await session(page)).refresh;
  await page.goto(PREV + '/');
  await page.waitForFunction(() => document.documentElement.classList.contains('lp-member') && typeof supa !== 'undefined', null, { timeout: 15000 });
  await page.waitForFunction(async () => !!(await supa.auth.getSession()).data.session, null, { timeout: 15000 });
  assert.equal(await page.evaluate(() => location.href), PREV + '/', 'adresse propre : aucun jeton ni paramètre');
  const s = await session(page);
  assert.equal(s.email, 'pierre@exemple.fr');
  assert.equal(s.refresh, 'handoff', 'jeton de rafraîchissement factice');
  assert.ok(!(await page.evaluate(k => localStorage.getItem(k), KEY)).includes(prodRefresh), 'le jeton de production n\'est pas copié');
  /* la production n'a pas été touchée */
  const prod2 = await open(); await prod2.goto(PROD + '/'); await ready(prod2);
  assert.equal((await session(prod2)).refresh, prodRefresh);
});

test('production non connectée : retour propre sur la prévisualisation, aucune session, pas de boucle', async t => {
  const { open, nav } = await newCtx(t);
  const page = await open();
  await page.goto(PREV + '/'); await ready(page); await page.waitForTimeout(2500);
  assert.equal(await page.evaluate(() => location.href), PREV + '/');
  assert.equal(await session(page), null);
  const pages = nav.filter(u => !/\.(js|css|woff2|png|svg|json|jpg)(\?|$)/.test(u) && !u.includes('/api/'));
  assert.ok(pages.length <= 3, 'pas de boucle : ' + pages.join(' | '));
});

test('origine non autorisée : la production n\'émet aucun jeton et ne quitte pas son domaine', async t => {
  const { open, nav } = await newCtx(t);
  const page = await open();
  await page.goto(PROD + '/'); await ready(page); await login(page);
  await page.goto('about:blank');
  await page.goto(PROD + '/#wl_preview=' + encodeURIComponent(EVIL)); await ready(page); await page.waitForTimeout(1500);
  const href = await page.evaluate(() => location.href);
  assert.equal(new URL(href).origin, PROD);
  assert.ok(!href.includes('wl_handoff') && !href.includes('wl_preview'));
  assert.ok(!nav.some(u => u.includes('wl_handoff') || u.startsWith(EVIL)));
});
