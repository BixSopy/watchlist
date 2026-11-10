/* Sons d'interface dans le vrai navigateur, sous la CSP de production : les 9 fichiers de /sounds/
   se chargent et se décodent au premier geste, servis avec un long cache ; silence (sans erreur ni
   synthèse) si le téléchargement échoue ; le curseur de volume est enregistré et survit au rechargement.
   Lancer : cd e2e && npm test */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { startServer } from './server.mjs';
import { installFakeSupabase } from './fake-supabase.mjs';

const CHROME = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
const NAMES = ['click', 'open', 'close', 'next', 'toast', 'add', 'done', 'del', 'err'];
let browser, server;

before(async () => {
  if (!CHROME) throw new Error('Chrome introuvable : définis CHROME_PATH');
  browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  server = await startServer();
});
after(async () => { await browser?.close(); await server?.close(); });

async function newPage(t) {
  server.config = { turnstileSiteKey: '', signupsOpen: true };
  const ctx = await browser.newContext({ locale: 'fr-FR', viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', m => { const x = m.text(); if (m.type() === 'error' && !/^Failed to load resource/.test(x)) problems.push(x); if (/Content Security Policy/i.test(x)) problems.push(x); });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  await installFakeSupabase(page);
  t.after(() => ctx.close());
  return { page, problems };
}

test('premier clic : les 9 sons se chargent et se décodent (CSP respectée), avec un long cache', async t => {
  const { page, problems } = await newPage(t);
  const responses = [];
  page.on('response', r => { if (r.url().includes('/sounds/')) responses.push(r); });
  await page.goto(server.url + '/');
  await page.waitForFunction(() => typeof sfx === 'function' && typeof _sfxState !== 'undefined');
  assert.deepEqual(await page.evaluate(() => _sfxState), {}, 'rien n’est téléchargé avant un geste');
  await page.mouse.click(5, 5);
  await page.waitForFunction(n => n.every(k => _sfxState[k] === 'ready' || _sfxState[k] === 'failed'), NAMES);
  assert.deepEqual(await page.evaluate(n => n.map(k => _sfxState[k]), NAMES), NAMES.map(() => 'ready'));
  assert.equal(responses.length, 9);
  for (const r of responses) {
    assert.equal(r.status(), 200);
    assert.match(r.headers()['cache-control'] || '', /max-age=\d{6,}/);
  }
  /* Lecture : passe par le fichier décodé (aucune erreur) */
  const played = await page.evaluate(n => {
    let srcs = 0; const o = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function () { srcs++; return o.apply(this, arguments); };
    n.forEach(k => sfx(k)); sfx('hover');
    AudioContext.prototype.createBufferSource = o;
    return srcs;
  }, NAMES);
  assert.equal(played, 9, 'un fichier joué par son, rien pour le survol');
  await page.waitForTimeout(100);
  assert.deepEqual(problems, []);
});

test('téléchargement impossible : silence, sans erreur ni synthèse', async t => {
  const { page, problems } = await newPage(t);
  await page.route('**/sounds/**', r => r.abort());
  await page.goto(server.url + '/');
  await page.waitForFunction(() => typeof sfx === 'function');
  await page.mouse.click(5, 5);
  await page.waitForFunction(n => n.every(k => _sfxState[k] === 'failed'), NAMES);
  const nodes = await page.evaluate(n => {
    let c = 0; const os = AudioContext.prototype.createOscillator, bs = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createOscillator = function () { c++; return os.apply(this, arguments); };
    AudioContext.prototype.createBufferSource = function () { c++; return bs.apply(this, arguments); };
    n.forEach(k => sfx(k));
    AudioContext.prototype.createOscillator = os; AudioContext.prototype.createBufferSource = bs;
    return c;
  }, NAMES);
  assert.equal(nodes, 0);
  assert.deepEqual(problems, []);
});

test('Réglages : le curseur « Volume des sons » est enregistré (wl_snd_vol) et survit au rechargement', async t => {
  const { page, problems } = await newPage(t);
  await page.goto(server.url + '/');
  await page.waitForFunction(() => typeof render === 'function' && typeof wlSettings !== 'undefined');
  assert.equal(await page.evaluate(() => _sfxVolume), 0.5, 'volume par défaut : 50 %');
  await page.click('button.hbtn[data-click="toggleMenu"]');
  await page.click('#optMenuMain [data-click="openSettings"]');
  const slider = page.locator('#optMenuSettings input[data-input="settingRange"][data-args*="wl_snd_vol"]');
  await slider.waitFor();
  assert.match(await page.locator('#optMenuSettings').textContent(), /Volume des sons/);
  assert.equal(await slider.inputValue(), '50');
  await slider.fill('25');
  assert.equal(await page.locator('#_rangeVal_wl_snd_vol').textContent(), '25%');
  assert.equal(await page.evaluate(() => localStorage.getItem('wl_snd_vol')), '25');
  assert.equal(await page.evaluate(() => _sfxVolume), 0.25);
  await page.reload();
  await page.waitForFunction(() => typeof wlSettings !== 'undefined' && typeof _sfxVolume !== 'undefined');
  assert.equal(await page.evaluate(() => _sfxVolume), 0.25);
  await page.mouse.click(5, 5);
  assert.equal(await page.evaluate(() => getAC() && _master.gain.value), 0.25, 'appliqué au volume général');
  await page.click('button.hbtn[data-click="toggleMenu"]');
  await page.click('#optMenuMain [data-click="openSettings"]');
  assert.equal(await slider.inputValue(), '25');
  /* La touche M et wl_snd restent inchangés */
  await page.keyboard.press('Escape');
  await page.keyboard.press('m');
  assert.equal(await page.evaluate(() => localStorage.getItem('wl_snd')), '0');
  assert.deepEqual(problems, []);
});
