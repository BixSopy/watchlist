/* Landing 3D « voyage » (experience/) : chargement sous la vraie CSP, défilement hybride (tension réversible
   puis saut automatique), grand saut tablette ↔ téléphone, touches clavier, FAQ atteignable sans défilement
   horizontal, repli en lecture normale sur écran étroit, animations réduites. Le rendu WebGL est logiciel
   (SwiftShader) dans ce test : il vérifie le comportement, pas la cadence réelle d'un GPU.
   Lancer : cd e2e && npm test */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { startServer } from './server.mjs';

const CHROME = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
let browser, server;
before(async () => {
  if (!CHROME) throw new Error('Chrome introuvable : définis CHROME_PATH');
  browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  server = await startServer();
});
after(async () => { await browser?.close(); await server?.close(); });

async function open(t, opts = {}) {
  const q = opts.q === undefined ? '?q=low&force3d' : opts.q;
  const ctx = await browser.newContext({ viewport: opts.vp || { width: 1440, height: 900 }, reducedMotion: opts.reduced ? 'reduce' : 'no-preference' });
  t.after(() => ctx.close());
  const page = await ctx.newPage();
  const problems = [], external = [];
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  /* les affiches TMDB (autorisées par la CSP) ne se chargent qu'au premier geste ; hors ligne ici, leur échec est attendu */
  page.on('console', m => { if (m.type() === 'error' && !/image\.tmdb\.org/.test(m.location().url || '')) problems.push(m.text()); });
  page.on('request', r => { const u = new URL(r.url()); if (!/^(127\.0\.0\.1|localhost)$/.test(u.hostname) && !/^(data|blob):/.test(r.url()) && u.hostname !== 'image.tmdb.org') external.push(r.url()); });
  await page.goto(server.url + '/experience/index.html' + q);
  await page.waitForFunction(() => window.__xp, null, { timeout: 90000 });
  return { page, problems, external };
}
const state = (page) => page.evaluate(() => window.__xp.state);

test('chargement sous la CSP du site : 100 %, ouverture par un saut vers l\'ordinateur, aucune requête externe', async t => {
  const { page, problems, external } = await open(t);
  assert.equal(await page.textContent('#ldPct'), '100');
  await page.waitForFunction(() => !document.documentElement.classList.contains('booting'), null, { timeout: 15000 });
  assert.equal(await page.textContent('#chapN'), '01');
  assert.equal(await page.textContent('#soundBtn'), 'Son : coupé');
  await page.waitForFunction(() => window.__xp.state.jump === null, null, { timeout: 90000 });
  await page.waitForFunction(() => document.querySelector('.ttl.hero').classList.contains('on'), null, { timeout: 30000 });
  assert.match(await page.textContent('.ttl.hero h2'), /Tout ce que tu regardes, enfin au même endroit\./);
  await page.click('#soundBtn');
  assert.equal(await page.getAttribute('#soundBtn', 'aria-pressed'), 'true');
  assert.equal(await page.textContent('#soundBtn'), 'Son : activé');
  await page.click('#soundBtn');
  assert.equal(await page.getAttribute('#soundBtn', 'aria-pressed'), 'false');
  assert.deepEqual(external, [], 'aucune requête hors du site');
  assert.deepEqual(problems, []);
});

test('GPU logiciel (ici SwiftShader) : repli immédiat en lecture normale, pas d\'attente ni d\'écran noir', async t => {
  const { page, problems } = await open(t, { q: '' });
  assert.ok(await page.evaluate(() => document.documentElement.classList.contains('soft')));
  assert.ok(await page.evaluate(() => document.documentElement.classList.contains('static')));
  assert.equal(await page.textContent('#ldPct'), '100');
  assert.equal(await page.locator('.ttl').count(), 9);
  for (const el of await page.locator('.ttl').all()) assert.equal(await el.evaluate(e => getComputedStyle(e).visibility), 'visible');
  assert.deepEqual(problems, []);
});

test('défilement hybride : la tension monte puis retombe si on revient ; passé le seuil, le saut part seul et verrouille le défilement', async t => {
  const { page, problems } = await open(t);
  await page.evaluate(() => window.__xp.goto(0, 0.9));
  const { E, S } = await state(page);
  const G = await page.evaluate(() => innerHeight);
  // tension à 30 % : pas de saut, la scène s'assombrit, puis on revient
  await page.evaluate(y => scrollTo(0, y), Math.round(E[0] + 0.3 * G));
  await page.waitForFunction(() => window.__xp.state.tau > 0.2, null, { timeout: 60000 });
  let s = await state(page);
  assert.equal(s.jump, null); assert.equal(s.cur, 0);
  await page.evaluate(y => scrollTo(0, y), Math.round(E[0] - 100));
  await page.waitForFunction(() => window.__xp.state.tau === 0, null, { timeout: 60000 });
  assert.equal((await state(page)).cur, 0, 'revenir avant le seuil annule le saut');
  // au-delà de 60 % : le saut part tout seul
  await page.evaluate(y => scrollTo(0, y), Math.round(E[0] + 0.75 * G));
  await page.waitForFunction(() => window.__xp.state.jump !== null || window.__xp.state.cur === 1, null, { timeout: 60000 });
  await page.waitForFunction(() => window.__xp.state.cur === 1, null, { timeout: 90000 });
  s = await state(page);
  assert.ok(s.y >= S[1] && s.y < S[1] + 0.2 * G, 'arrivée au début de l\'étape 2 (y=' + s.y + ')');
  await page.waitForFunction(() => window.__xp.state.jump === null, null, { timeout: 90000 });
  assert.equal(await page.textContent('#chapN'), '02');
  await page.waitForFunction(() => document.querySelector('.ttl[data-step="1"]').classList.contains('on'), null, { timeout: 30000 });
  // saut inverse depuis le début de l'étape
  await page.evaluate(y => scrollTo(0, y), Math.round(S[1] - 0.8 * G));
  await page.waitForFunction(() => window.__xp.state.cur === 0, null, { timeout: 90000 });
  s = await state(page);
  assert.ok(s.y > E[0] - 0.2 * G && s.y <= E[0], 'retour à la fin de l\'étape 1 (y=' + s.y + ')');
  assert.deepEqual(problems, []);
});

test('grand saut tablette ↔ téléphone (tunnel d\'affiches) et touches PageDown / PageUp', async t => {
  const { page, problems } = await open(t);
  await page.evaluate(() => window.__xp.goto(2, 0.9));
  await page.keyboard.press('PageDown');
  await page.waitForFunction(() => window.__xp.state.jump && window.__xp.state.jump.grand === true, null, { timeout: 30000 });
  await page.waitForFunction(() => window.__xp.state.cur === 3, null, { timeout: 120000 });
  await page.waitForFunction(() => window.__xp.state.jump === null, null, { timeout: 120000 });
  await page.waitForFunction(() => document.querySelector('.ttl[data-step="3"]').classList.contains('on'), null, { timeout: 30000 });
  assert.equal(await page.textContent('#chapN'), '04');
  await page.waitForTimeout(500);
  await page.keyboard.press('PageUp');
  await page.waitForFunction(() => window.__xp.state.cur === 2, null, { timeout: 120000 });
  assert.deepEqual(problems, []);
});

test('étape 5 : pastilles et lien de création de compte ; FAQ et pied de page atteignables sans défilement horizontal', async t => {
  const { page, problems } = await open(t);
  await page.evaluate(() => window.__xp.goto(4, 0.8));
  await page.waitForFunction(() => document.getElementById('join').classList.contains('on') && document.getElementById('join').classList.contains('cta-on'), null, { timeout: 30000 });
  assert.equal(await page.locator('#joinList li.on').count(), 3);
  assert.equal(await page.getAttribute('#join .btn', 'href'), '/#lp-join');
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
  await page.locator('#faq summary').first().waitFor({ state: 'visible' });
  await page.locator('#faq summary').first().click();
  assert.equal(await page.locator('#faq details[open]').count(), 1);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.match(await page.textContent('.foot-tmdb'), /TMDB/);
  assert.deepEqual(problems, []);
});

for (const vp of [{ width: 768, height: 1024 }, { width: 390, height: 844 }]) {
  test('écran étroit ' + vp.width + ' px : lecture normale sans scène, rien ne déborde', async t => {
    const { page, problems } = await open(t, { vp });
    assert.ok(await page.evaluate(() => document.documentElement.classList.contains('static')));
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('scene')).display), 'none');
    assert.equal(await page.locator('.ttl').count(), 9);
    for (const el of await page.locator('.ttl').all()) assert.equal(await el.evaluate(e => getComputedStyle(e).visibility), 'visible');
    await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
    await page.locator('.foot-tmdb').waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(problems, []);
  });
}

test('animations réduites : même scène, saut remplacé par un fondu court, sans traînées ni parallaxe', async t => {
  const { page, problems } = await open(t, { reduced: true });
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('static')), false);
  await page.waitForFunction(() => window.__xp.state.jump === null, null, { timeout: 60000 });
  await page.evaluate(() => window.__xp.goto(0, 0.9));
  await page.evaluate(() => window.__xp.jump(1));
  await page.waitForFunction(() => window.__xp.state.cur === 1 && window.__xp.state.jump === null, null, { timeout: 60000 });
  assert.equal(await page.evaluate(() => window.__xp.dbg.ST.warp), 0, 'aucune traînée');
  assert.deepEqual(problems, []);
});
