/* Anti-spoiler (fiche détail, js/08-plex.js) : épisodes pas encore vus floutés et sans titre, résumé
   des saisons pas commencées masqué, un toucher pour afficher ; réglage dans Réglages → Suivi.
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

const EPS = [1, 2, 3, 4].map(n => ({ episode_number: n, name: 'Épisode secret ' + n, air_date: '2024-01-0' + n, runtime: 50, still_path: '/s' + n + '.jpg' }));
async function open(t) {
  server.config = { turnstileSiteKey: '', signupsOpen: true };
  const ctx = await browser.newContext({ locale: 'fr-FR', viewport: { width: 1280, height: 860 }, serviceWorkers: 'block' });
  t.after(() => ctx.close());
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  await installFakeSupabase(page);
  await page.route(u => u.pathname === '/api/tmdb', r => {
    const path = new URL(r.request().url()).searchParams.get('path') || '';
    const body = /\/season\/1$/.test(path) ? { overview: 'Saison 1', episodes: EPS }
      : /\/season\/2$/.test(path) ? { overview: 'La grande révélation de la saison 2', episodes: EPS }
      : /^\/tv\/500$/.test(path) ? { id: 500, name: 'Série test', overview: 'Résumé général', seasons: [{ season_number: 1, episode_count: 4 }, { season_number: 2, episode_count: 4 }] }
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
    const a = { id: 'sp1', tmdbId: 500, tmdbType: 'tv', title: 'Série test', type: 'serie', status: 'encours', saison: 1, episode: 2, tags: [], createdAt: now, updatedAtLocal: now };
    memDB.push(a); dbPut(a, () => { render(); res(); });
  }));
  await page.evaluate(() => openPlex('sp1'));
  await page.locator('#plexMbk.on').waitFor();
  return { page, problems };
}
const rows = page => page.evaluate(() => [...document.querySelectorAll('#plexEps .pe-row')].map(r => ({
  spoil: r.classList.contains('spoil'), shown: r.classList.contains('shown'), text: r.querySelector('b').innerText.trim(),
  blur: getComputedStyle(r.querySelector('.pe-im')).filter })));

test('épisodes pas encore vus : floutés et sans titre, un toucher les affiche', async t => {
  const { page, problems } = await open(t);
  await page.evaluate(() => plexSeason(1));
  await page.waitForFunction(() => document.querySelectorAll('#plexEps .pe-row').length === 4);
  let r = await rows(page);
  assert.deepEqual(r.map(x => x.spoil), [false, false, true, true], 'E1-E2 vus, E3-E4 masqués');
  assert.equal(r[0].text, 'E1 · Épisode secret 1');
  assert.equal(r[2].text, 'E3 · Titre masqué');
  assert.match(r[2].blur, /blur/);
  assert.equal(r[0].blur, 'none');
  await page.locator('#plexEps .pe-row').nth(2).click();
  r = await rows(page);
  assert.equal(r[2].text, 'E3 · Épisode secret 3');
  assert.equal(r[2].blur, 'none');
  assert.equal(r[3].text, 'E4 · Titre masqué', 'les autres restent masqués');
  assert.deepEqual(problems, []);
});

test('saison pas commencée : résumé masqué, un toucher l\'affiche ; réglage désactivé = tout visible', async t => {
  const { page, problems } = await open(t);
  await page.evaluate(() => plexSeason(2));
  await page.waitForFunction(() => document.getElementById('plexOverview').classList.contains('spoil'));
  assert.match(await page.locator('#plexOverview').textContent(), /Résumé masqué/);
  await page.click('#plexOverview');
  assert.equal(await page.locator('#plexOverview').textContent(), 'La grande révélation de la saison 2');
  /* Saison en cours : résumé visible */
  await page.evaluate(() => plexSeason(1));
  await page.waitForFunction(() => document.getElementById('plexOverview').textContent === 'Saison 1');
  /* Réglage coupé : plus rien de masqué */
  await page.evaluate(() => { localStorage.setItem('wl_spoilers', '0'); loadSettings(); plexSeason(2); });
  await page.waitForFunction(() => document.getElementById('plexOverview').textContent === 'La grande révélation de la saison 2');
  await page.waitForFunction(() => document.querySelectorAll('#plexEps .pe-row').length === 4 && !document.querySelector('#plexEps .pe-row.spoil'));
  assert.deepEqual(problems, []);
});
