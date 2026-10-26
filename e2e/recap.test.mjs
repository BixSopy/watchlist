/* Récap à partager (js/31-recap.js) : depuis Statistiques, image story 1080×1920 dessinée dans le navigateur
   (affiches TMDB lisibles par le canvas), aperçu en data: compatible CSP, téléchargement PNG, aucune requête ajoutée.
   RECAP_OUT=fichier.png pour enregistrer l'image produite. Lancer : cd e2e && npm test */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { startServer } from './server.mjs';
import { installFakeSupabase } from './fake-supabase.mjs';

const CHROME = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
const SHOTS = process.env.SCREENSHOTS || '';
const TOK = 'k7Qm2xVf9TbR4wLpZ3nHq1';
const PUBLIC = { name: 'Pierre', kind: 'filtered', filter_status: ['encours'], filter_types: ['anime'], hide_ratings: true, hide_progress: false, stats: null,
  items: [{ tmdb_id: 70000, tmdb_type: 'tv', type: 'anime', status: 'encours', title: 'Kingdom', year: '2012', poster_path: '/p7.jpg', season: 5, episode: 9, rating: null },
    { tmdb_id: 95479, tmdb_type: 'tv', type: 'anime', status: 'encours', title: 'Jujutsu Kaisen', year: '2020', poster_path: '/p2.jpg', season: 3, episode: 1, rating: null },
    { tmdb_id: 31910, tmdb_type: 'tv', type: 'anime', status: 'encours', title: 'Monogatari', year: '2009', poster_path: '/p6.jpg', season: 1, episode: 4, rating: null }] };
let browser, server;
const ME = '11111111-1111-4111-8111-111111111111';
before(async () => {
  if (!CHROME) throw new Error('Chrome introuvable : définis CHROME_PATH');
  browser = await chromium.launch({ executablePath: CHROME, headless: true });
  server = await startServer({ shares: { [TOK]: PUBLIC } });
});
after(async () => { await browser?.close(); await server?.close(); });

let n = 0;
const item = (o) => ({ id: 'srv-' + (++n), local_id: 'l-' + n, profile_id: 'p-' + ME, tmdb_id: 1000 + n, tmdb_type: 'tv', type: 'anime', status: 'encours',
  title: 'Titre ' + n, year: '2020', poster_path: '/p' + n + '.jpg', tmdb_score: 7.5, my_rating: 8, overview: '', tags: [], saison: 1, episode: 2,
  total_ep: null, anime_genre: '', deleted: false, updated_at: '2026-10-01T10:00:00Z', added_at: '2026-09-10T10:00:00Z', ...o });
const LW = new Date(Date.now() - 864e5).toISOString();
const items = () => { n = 0; return [item({ title: 'Kingdom', last_watched_at: LW, added_at: LW }), item({ title: 'Jujutsu Kaisen' }), item({ title: 'Invincible', type: 'serie', last_watched_at: LW, my_rating: 9 }), item({ title: 'Monster', status: 'avoir' }), item({ title: 'Dune', type: 'film', tmdb_type: 'movie', status: 'termine', last_watched_at: LW })]; };
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="154" height="231"><rect width="154" height="231" fill="#3b4b8a"/></svg>';

async function newPage(t, { viewport = { width: 1440, height: 900 }, mobile = false, login = true } = {}) {
  const ctx = await browser.newContext({ locale: 'fr-FR', timezoneId: 'Europe/Paris', viewport, permissions: ['clipboard-read', 'clipboard-write'], ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  const page = await ctx.newPage();
  const problems = [], calls = [];
  page.on('console', m => { const x = m.text(); if (m.type() === 'error' && !/^Failed to load resource: the server responded with a status of (4\d\d)/.test(x)) problems.push(x); if (/Content Security Policy/i.test(x)) problems.push(x); });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  page.on('request', r => { const u = new URL(r.url()); if (!/^(127\.0\.0\.1|localhost)$/.test(u.hostname) && u.hostname !== 'image.tmdb.org' && !/supabase/.test(u.hostname)) calls.push(r.url()); });
  const db = await installFakeSupabase(page, { items: items() });
  await page.route(u => /^\/api\/(tmdb|omdb|releases)/.test(u.pathname), r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"results":[]}' }));
  await page.route(/kitsu\.(io|app)|api\.tvmaze\.com/, r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"data":[]}' }));
  const ASSETS = process.env.POSTERS || '';  /* dossier de p0.jpg…p9.jpg pour des captures plus parlantes (facultatif) */
  await page.route('https://image.tmdb.org/**', r => {
    const k = (parseInt(r.request().url().split('/').pop().replace(/\D/g, ''), 10) || 0) % 10;
    if (ASSETS && fs.existsSync(ASSETS + '/p' + k + '.jpg')) return r.fulfill({ status: 200, contentType: 'image/jpeg', body: fs.readFileSync(ASSETS + '/p' + k + '.jpg') });
    return r.fulfill({ status: 200, contentType: 'image/svg+xml', body: SVG });
  });
  t.after(() => ctx.close());
  if (login) {
    await page.goto(server.url + '/');
    await page.waitForFunction(() => typeof render === 'function' && typeof memDB !== 'undefined');
    await page.click('#syncStatusPill');
    await page.fill('#authEmail', 'pierre@exemple.fr');
    await page.fill('#authPassword', 'Correct-Horse-42');
    await page.click('.auth-submit');
    await page.locator('#authViewTitle').filter({ hasText: /Mon compte/ }).waitFor();
    await page.click('#authMbk .auth-close');
    await page.waitForFunction(() => memDB.filter(i => !i.deleted).length >= 5 && !syncInProgress && authProfileId);
  }
  return { page, db, problems, calls };
}
const shot = async (page, name, full) => { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); await page.addStyleTag({ content: '#toastWrap{display:none}' }); await page.waitForTimeout(600); await page.screenshot({ path: SHOTS + '/' + name + '.png', fullPage: !!full }); };

test('Récap : aperçu 1080×1920, chiffres du mois, téléchargement, période vide', async t => {
  const { page, problems, calls } = await newPage(t);
  await page.evaluate(() => openStats());
  await page.click('#statsMbk [data-click="openRecap"]');
  const sheet = page.locator('#recapMbk.on .sh-wrap');
  await sheet.waitFor();
  const img = sheet.locator('.rc-prev img');
  await img.waitFor();
  await page.waitForFunction(() => RECAP.blob && document.querySelector('.rc-prev img').naturalWidth > 0);
  assert.deepEqual(await img.evaluate(i => [i.naturalWidth, i.naturalHeight]), [1080, 1920]);
  assert.match(await img.getAttribute('src'), /^data:image\/png;base64,/);
  const st = await page.evaluate(() => recapStats(memDB, recapRange(RECAP.period, Date.now())));
  assert.equal(st.watched, 3);
  if (process.env.RECAP_OUT) fs.writeFileSync(process.env.RECAP_OUT, Buffer.from((await img.getAttribute('src')).split(',')[1], 'base64'));
  const [dl] = await Promise.all([page.waitForEvent('download'), sheet.locator('[data-click="recapDownload"]').click()]);
  assert.match(dl.suggestedFilename(), /^cinepisode-recap-\d{4}-\d{2}\.png$/);
  await sheet.locator('.sh-chips button', { hasText: 'Cette année' }).click();
  await page.waitForFunction(() => RECAP.period === 'year' && RECAP.blob);
  await page.evaluate(() => { memDB.forEach(i => { i.lastWatchedAt = null; i.addedAt = 0; }); });
  await sheet.locator('.sh-chips button', { hasText: 'Mois dernier' }).click();
  await sheet.locator('.rc-empty').waitFor();
  assert.equal(await sheet.locator('[data-click="recapDownload"]').isDisabled(), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#recapMbk.on').count(), 0);
  assert.deepEqual(problems, []);
  assert.deepEqual(calls, []);
});
