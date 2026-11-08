/* Découvrir (js/06-discovery.js) : une erreur du proxy /api/tmdb n'est plus masquée (message + Réessayer).
   Lancer : cd e2e && npm test */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { startServer } from './server.mjs';
import { installFakeSupabase } from './fake-supabase.mjs';

const CHROME = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
const SHOTS = process.env.SCREENSHOTS || '';
let browser, server;
const ME = '11111111-1111-4111-8111-111111111111';
before(async () => {
  if (!CHROME) throw new Error('Chrome introuvable : définis CHROME_PATH');
  browser = await chromium.launch({ executablePath: CHROME, headless: true });
  server = await startServer();
});
after(async () => { await browser?.close(); await server?.close(); });

let n = 0;
const item = (o) => ({ id: 'srv-' + (++n), local_id: 'l-' + n, profile_id: 'p-' + ME, tmdb_id: 1000 + n, tmdb_type: 'tv', type: 'serie', status: 'avoir',
  title: 'Titre ' + n, year: '2020', poster_path: '/p' + n + '.jpg', tmdb_score: 7.5, my_rating: 0, overview: '', tags: [], saison: null, episode: null,
  total_ep: null, anime_genre: '', deleted: false, updated_at: '2026-10-01T10:00:00Z', added_at: '2026-09-10T10:00:00Z', ...o });
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="154" height="231"><rect width="154" height="231" fill="#345"/></svg>';
const results = Array.from({ length: 24 }, (_, i) => ({ id: 50000 + i, title: 'Proposition ' + i, name: 'Proposition ' + i, poster_path: '/q' + i + '.jpg',
  release_date: '2024-01-01', first_air_date: '2024-01-01', vote_average: 7.1, media_type: 'movie' }));

async function newPage(t, state) {
  server.config = { turnstileSiteKey: '', signupsOpen: true };
  const ctx = await browser.newContext({ locale: 'fr-FR', viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', m => { const x = m.text(); if (m.type() === 'error' && !/^Failed to load resource: the server responded with a status of (4\d\d|5\d\d)/.test(x)) problems.push(x); });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  n = 0;
  await installFakeSupabase(page, { items: [item({ tmdb_id: 1 }), item({ tmdb_id: 2 })] });
  await page.route(u => u.pathname === '/api/tmdb', r => {
    if (state.fail) return r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"upstream"}' });
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results, page: 1, total_pages: 5 }) });
  });
  await page.route(u => /^\/api\/(omdb|releases)/.test(u.pathname), r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route(/kitsu\.(io|app)|api\.tvmaze\.com/, r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"data":[]}' }));
  await page.route('https://image.tmdb.org/**', r => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: SVG }));
  t.after(() => ctx.close());
  await page.goto(server.url + '/');
  await page.waitForFunction(() => typeof render === 'function' && typeof memDB !== 'undefined');
  await page.click('#syncStatusPill');
  await page.fill('#authEmail', 'pierre@exemple.fr');
  await page.fill('#authPassword', 'Correct-Horse-42');
  await page.click('.auth-submit');
  await page.locator('#authViewTitle').filter({ hasText: /Mon compte|My account/ }).waitFor();
  await page.click('#authMbk .auth-close');
  await page.waitForFunction(() => memDB.filter(i => !i.deleted).length >= 2 && !syncInProgress);
  return { page, problems };
}

test('Découvrir « Pour toi » : erreur du proxy = message d\'erreur + Réessayer (pas « rien à te proposer »), puis les propositions reviennent', async t => {
  const state = { fail: true };
  const { page, problems } = await newPage(t, state);
  await page.click('button[data-v="discover"]:visible');
  const err = page.locator('#p3ForYou .empty-state');
  await err.waitFor();
  await page.waitForFunction(() => /Impossible de charger les propositions/.test(document.getElementById('p3ForYou').textContent));
  assert.doesNotMatch(await err.textContent(), /Rien de nouveau/);
  state.fail = false;
  await page.locator('#p3ForYou [data-click="retryRecos"]').click();
  await page.locator('#p3ForYou .p3-feat').waitFor();
  assert.deepEqual(problems, []);
});

test('Découvrir (Films/Séries/Anime) : erreur du proxy = message + Réessayer par rangée, jamais mise en cache', async t => {
  const state = { fail: true };
  const { page, problems } = await newPage(t, state);
  await page.click('button[data-v="discover"]:visible');
  await page.locator('#p3DiscSeg button', { hasText: /^Films$/ }).click();
  await page.locator('#discoverSection .dr-row-err').first().waitFor();
  assert.ok(await page.locator('#discoverSection .dr-row-err').count() >= 2, 'chaque rangée en erreur est signalée');
  assert.match(await page.locator('#discoverSection .dr-row-err').first().textContent(), /Impossible de charger cette rangée/);
  assert.equal(await page.locator('#discoverSection .dr-card').count(), 0);
  state.fail = false;
  const before = await page.locator('#discoverSection .dr-row-err').count();
  await page.locator('#discoverSection .dr-row-err .btn').first().click();
  await page.locator('#discoverSection .dr-card').first().waitFor();
  assert.equal(await page.locator('#discoverSection .dr-row-err').count(), before - 1);
  // Autre filtre puis retour : rien d'erroné n'a été mis en cache, tout se recharge
  await page.locator('#p3DiscSeg button', { hasText: /^Séries$/ }).click();
  await page.locator('#discoverSection .dr-card').first().waitFor();
  assert.equal(await page.locator('#discoverSection .dr-row-err').count(), 0);
  assert.deepEqual(problems, []);
});
