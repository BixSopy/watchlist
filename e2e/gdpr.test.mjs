/* Import RGPD Disney+ / Apple TV (js/27-gdpr-import.js) : carte dans « Détectés », tutoriel avec liens
   officiels, suivi local de la demande, dépôt d'un fichier synthétique lu dans le navigateur (aucune
   requête vers un tiers), titres envoyés dans « Détectés » puis ajoutés par le code habituel.
   Captures si SHOTS=dossier. Lancer : cd e2e && npm test */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { startServer } from './server.mjs';
import { installFakeSupabase } from './fake-supabase.mjs';

const CHROME = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
let browser, server;
const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '99999999-9999-4999-8999-999999999999';

before(async () => {
  if (!CHROME) throw new Error('Chrome introuvable : définis CHROME_PATH');
  browser = await chromium.launch({ executablePath: CHROME, headless: true });
  server = await startServer();
});
after(async () => { await browser?.close(); await server?.close(); });

const SHOTS = process.env.SHOTS || '';
const FIX = new URL('../tests/fixtures/gdpr/', import.meta.url).pathname;
const TMDB = {
  'tv:Ted Lasso': [{ id: 97546, name: 'Ted Lasso', original_name: 'Ted Lasso', first_air_date: '2020-08-14', popularity: 90, vote_average: 8.4, poster_path: '/ted.jpg' }],
  'tv:Severance': [{ id: 95396, name: 'Severance', original_name: 'Severance', first_air_date: '2022-02-17', popularity: 120, vote_average: 8.4, poster_path: '/sev.jpg' }],
  'movie:Seven Sisters': [{ id: 406990, title: 'Seven Sisters', original_title: 'What Happened to Monday', release_date: '2017-08-18', popularity: 30, vote_average: 7, poster_path: '/ss.jpg' }],
  'movie:CODA': [{ id: 776503, title: 'CODA', original_title: 'CODA', release_date: '2021-08-13', popularity: 40, vote_average: 8, poster_path: '/coda.jpg' }],
};
async function newPage(t, opts = {}) {
  server.config = { turnstileSiteKey: '', signupsOpen: true };
  const ctx = await browser.newContext({ locale: opts.locale || 'fr-FR', viewport: opts.mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
    ...(opts.mobile ? { deviceScaleFactor: 2, isMobile: true, hasTouch: true } : {}), reducedMotion: opts.reduced ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  const problems = [], external = [], finds = [];
  page.on('console', m => { const x = m.text(); if (m.type() === 'error' && !/^Failed to load resource: the server responded with a status of (4\d\d)/.test(x)) problems.push(x); if (/Content Security Policy/i.test(x)) problems.push(x); });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  page.on('request', r => { const u = new URL(r.url()); if (!/^(127\.0\.0\.1|localhost)$/.test(u.hostname) && !/^(data|blob):/.test(r.url()) && u.hostname !== 'batfulcvvquffgfeppcx.supabase.co' && u.hostname !== 'image.tmdb.org') external.push(u.hostname); });
  const db = await installFakeSupabase(page, { items: [], detected: [] });
  await page.route(u => u.pathname === '/api/tmdb', route => {
    const u = new URL(route.request().url()), tp = u.searchParams.get('path') || '';
    let body = { results: [] };
    const m = tp.match(/^\/search\/(tv|movie|multi)$/);
    if (m) body = { page: 1, results: TMDB[m[1] + ':' + u.searchParams.get('query')] || [] };
    const f = tp.match(/^\/find\/(\d+)$/);
    if (f) { finds.push([f[1], u.searchParams.get('external_source')]); body = { movie_results: [], tv_results: f[1] === '82066' ? [{ id: 1705, name: 'Fringe', original_name: 'Fringe', first_air_date: '2008-09-09', popularity: 60, vote_average: 8, poster_path: '/fr.jpg' }] : [] }; }
    const d = tp.match(/^\/tv\/(\d+)$/);
    if (d) body = { id: +d[1], status: 'Returning Series', number_of_episodes: 30, seasons: [{ season_number: 1, episode_count: 10 }, { season_number: 2, episode_count: 10 }] };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.route('https://image.tmdb.org/**', r => r.fulfill({ status: 404, body: '' }));
  t.after(() => ctx.close());
  return { page, db, problems, external, finds };
}
async function login(page) {
  await page.click('#syncStatusPill');
  await page.fill('#authEmail', 'pierre@exemple.fr');
  await page.fill('#authPassword', 'Correct-Horse-42');
  await page.click('.auth-submit');
  await page.locator('#authViewTitle').filter({ hasText: 'Mon compte' }).waitFor();
  await page.keyboard.press('Escape');
  await page.evaluate(() => { const m = document.getElementById('authMbk'); if (m) m.classList.remove('on'); });
}
const shot = async (page, name, sel) => { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); await page.waitForTimeout(700); await (sel ? page.locator(sel) : page).screenshot({ path: path.join(SHOTS, name + '.png') }); };

for (const mobile of [false, true]) test('Import RGPD : tutoriel, suivi de la demande, fichier Apple lu localement, ajout' + (mobile ? ' (mobile 390 px)' : ''), async t => {
  const { page, db, problems, external } = await newPage(t, { mobile });
  const sfx = mobile ? '-mobile' : '-desktop';
  await page.goto(server.url + '/');
  await login(page);
  await page.locator('button[data-v="detectes"]:visible').waitFor({ state: 'visible' });
  await page.click('button[data-v="detectes"]:visible');
  await page.click('.det-ext-btn');
  const card = page.locator('.gd-card');
  await card.waitFor();
  assert.match(await card.textContent(), /Pas encore demandé/);
  await shot(page, '1-carte' + sfx);
  // Tutoriel Apple : lien officiel, puis « J'ai fait la demande »
  await page.click('.gd-plat.gd-apple');
  await page.locator('#gdprMbk.on .gd-steps li').nth(4).waitFor();
  assert.equal(await page.locator('#gdprMbk a.gd-link').getAttribute('href'), 'https://privacy.apple.com/');
  assert.equal(await page.locator('#gdprMbk a.gd-link').getAttribute('target'), '_blank');
  const font = await page.locator('#gdprTitle').evaluate(e => getComputedStyle(e).fontFamily);
  assert.match(font, /Inter/);
  await shot(page, '2-tutoriel-apple' + sfx, mobile ? null : '#gdprMbk .gd-modal');
  await page.click('#gdprMbk button:has-text("J’ai fait la demande")');
  await page.locator('.gd-ring').waitFor();
  assert.match(await page.locator('#gdprView').textContent(), /Demande faite le/);
  await shot(page, '3-attente' + sfx, mobile ? null : '#gdprMbk .gd-modal');
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith('wl_gdpr_')))));
  assert.ok(st.apple.requestedAt > 0, 'date gardée dans ce navigateur');
  // Disney+ : onglet du sélecteur, lien du portail Disney
  await page.click('.gd-seg button:has-text("Disney+")');
  assert.match(await page.locator('#gdprMbk a.gd-link').getAttribute('href'), /^https:\/\/privacy\.thewaltdisneycompany\.com\//);
  await shot(page, '4-tutoriel-disney' + sfx, mobile ? null : '#gdprMbk .gd-modal');
  // Retour Apple, export reçu : dépôt du CSV synthétique
  await page.click('.gd-seg button:has-text("Apple TV")');
  await page.click('#gdprMbk button:has-text("J’ai reçu le fichier")');
  await page.locator('#gdprFile').setInputFiles(path.join(FIX, 'video-play-activity.csv'));
  await page.locator('.gd-res').waitFor();
  assert.match(await page.locator('.gd-res').textContent(), /3 titres trouvés/);
  await shot(page, '5-fichier-lu' + sfx, mobile ? null : '#gdprMbk .gd-modal');
  await page.click('#gdprSendBtn');
  await page.locator('#gdprMbk.on').waitFor({ state: 'detached' }).catch(() => {});
  await page.waitForFunction(() => !document.getElementById('gdprMbk').classList.contains('on'));
  await page.locator('.det-row').nth(2).waitFor();
  await page.waitForFunction(() => !document.querySelector('#detectedSection').textContent.includes('Recherche de la fiche'));
  const names = (await page.locator('.det-name').allTextContents()).sort();
  assert.deepEqual(names, ['CODA', 'Severance', 'Ted Lasso']);
  assert.match(await page.locator('.det-src-apple').first().textContent(), /Apple TV/);
  assert.match(await card.textContent(), /Importé le .* 3 titres/);
  await shot(page, '6-detectes' + sfx);
  // Ajout par le code habituel ; rien n'a été écrit dans detected_media
  await page.click('#detAddSelBtn');
  await page.waitForFunction(() => document.querySelectorAll('.det-row').length === 0);
  await page.waitForFunction(() => typeof memDB !== 'undefined' && memDB.filter(i => !i.deleted).length === 3);
  const ted = await page.evaluate(() => memDB.find(i => i.title === 'Ted Lasso'));
  assert.deepEqual([ted.saison, ted.episode], [1, 4]);
  assert.equal(db.detected.length, 0);
  assert.deepEqual(external, [], 'aucune requête vers un tiers');
  assert.deepEqual(problems, []);
});

test('Import RGPD : texte Disney+ collé, anglais, animations réduites', async t => {
  const { page, problems } = await newPage(t, { locale: 'en-US', reduced: true });
  await page.goto(server.url + '/');
  await page.click('#syncStatusPill');
  await page.fill('#authEmail', 'pierre@exemple.fr');
  await page.fill('#authPassword', 'Correct-Horse-42');
  await page.click('.auth-submit');
  await page.locator('#authViewTitle').waitFor();
  await page.keyboard.press('Escape');
  await page.evaluate(() => { const m = document.getElementById('authMbk'); if (m) m.classList.remove('on'); });
  await page.locator('button[data-v="detectes"]:visible').waitFor({ state: 'visible' });
  await page.click('button[data-v="detectes"]:visible');
  await page.click('.det-ext-btn');
  await page.click('.gd-plat.gd-disney');
  assert.match(await page.locator('#gdprView').textContent(), /I made the request/);
  const anim = await page.locator('.gd-steps li').first().evaluate(e => getComputedStyle(e).animationName);
  assert.equal(anim, 'none');
  await page.click('#gdprMbk button:has-text("I made the request")');
  await page.click('#gdprMbk button:has-text("I got the file")');
  await page.click('.gd-paste summary');
  await page.fill('#gdprPaste', fs.readFileSync(path.join(FIX, 'disney-export.txt'), 'utf8'));
  await page.click('#gdprMbk button:has-text("Analyze text")');
  await page.locator('.gd-res').waitFor();
  assert.match(await page.locator('.gd-res').textContent(), /4 titles found/);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.getElementById('gdprMbk').classList.contains('on'));
  assert.deepEqual(problems, []);
});

test('Import TV Time : zip officiel lu localement, série trouvée par id TVDB (/find), film par titre', async t => {
  const { page, db, problems, external, finds } = await newPage(t);
  await page.goto(server.url + '/');
  await login(page);
  await page.locator('button[data-v="detectes"]:visible').waitFor({ state: 'visible' });
  await page.click('button[data-v="detectes"]:visible');
  await page.click('.det-ext-btn');
  await page.locator('.gd-plat.gd-tvtime').waitFor();
  assert.match(await page.locator('.gd-plat.gd-tvtime').textContent(), /Service fermé/);
  await page.click('.gd-plat.gd-tvtime');
  // Pas de demande possible : directement le dépôt du fichier
  await page.locator('#gdprFile').waitFor({ state: 'attached' });
  assert.equal(await page.locator('#gdprMbk .gd-prog').count(), 0);
  assert.match(await page.locator('#gdprView').textContent(), /15 juillet 2026/);
  await shot(page, '7-tvtime', '#gdprMbk .gd-modal');
  const v2 = 'key,created_at,s_id,series_name,episode_id,season_number,episode_number,ep_id\nwatch-episode-a-1,2021-10-10 11:49:11,82066,Fringe,1331151,2,10,\nwatch-episode-a-2,2021-10-11 11:49:11,82066,Fringe,1331152,2,11,\nuser-series-b,2021-05-19 06:06:35,353309,Haunted,,,,';
  const v1 = 'type,type-uuid-n,created_at,release_date,alpha_range_key,movie_name,entity_type,watch_date_range_key\nwatch,watch-x-0,2022-04-10 11:26:55,2017-10-12,watch-alpha-what-happened-to-monday,Seven Sisters,movie,watch-date-1649590015';
  const zip = await page.evaluate(async ([a, b]) => { /* zip « stored » construit dans la page */
    const enc = new TextEncoder(), files = [['gdpr/tracking-prod-records-v2.csv', enc.encode(a)], ['gdpr/tracking-prod-records.csv', enc.encode(b)], ['gdpr/access_token.csv', enc.encode('token\nSECRET')]];
    const parts = [], cen = []; let off = 0;
    const w = (n, v, o, buf) => { for (let i = 0; i < n; i++) buf[o + i] = (v >>> (8 * i)) & 255; };
    for (const [name, data] of files) {
      const nb = enc.encode(name), lh = new Uint8Array(30), ch = new Uint8Array(46);
      w(4, 0x04034b50, 0, lh); w(4, data.length, 18, lh); w(4, data.length, 22, lh); w(2, nb.length, 26, lh);
      w(4, 0x02014b50, 0, ch); w(4, data.length, 20, ch); w(4, data.length, 24, ch); w(2, nb.length, 28, ch); w(4, off, 42, ch);
      parts.push(lh, nb, data); cen.push(ch, nb); off += 30 + nb.length + data.length;
    }
    const cl = cen.reduce((s, x) => s + x.length, 0), e = new Uint8Array(22);
    w(4, 0x06054b50, 0, e); w(2, files.length, 8, e); w(2, files.length, 10, e); w(4, cl, 12, e); w(4, off, 16, e);
    return Array.from(new Uint8Array(await new Blob([...parts, ...cen, e]).arrayBuffer()));
  }, [v2, v1]);
  await page.locator('#gdprFile').setInputFiles({ name: 'tv-time-personal-data.zip', mimeType: 'application/zip', buffer: Buffer.from(zip) });
  await page.locator('.gd-res').waitFor();
  assert.match(await page.locator('.gd-res').textContent(), /2 titres trouvés/);
  await page.click('#gdprSendBtn');
  await page.waitForFunction(() => !document.getElementById('gdprMbk').classList.contains('on'));
  await page.locator('.det-row').nth(1).waitFor();
  await page.waitForFunction(() => !document.querySelector('#detectedSection').textContent.includes('Recherche de la fiche'));
  assert.deepEqual((await page.locator('.det-name').allTextContents()).sort(), ['Fringe', 'Seven Sisters']);
  assert.deepEqual(finds, [['82066', 'tvdb_id']]);
  assert.match(await page.locator('.det-src-tvtime').first().textContent(), /TV Time/);
  await shot(page, '8-tvtime-detectes');
  await page.click('#detAddSelBtn');
  await page.waitForFunction(() => typeof memDB !== 'undefined' && memDB.filter(i => !i.deleted).length === 2);
  const fr = await page.evaluate(() => memDB.find(i => i.title === 'Fringe'));
  assert.deepEqual([fr.tmdbId, fr.saison, fr.episode], [1705, 2, 11]);
  assert.equal(db.detected.length, 0);
  assert.deepEqual(external, []);
  assert.deepEqual(problems, []);
});

test('« Donner mon avis » : titre de la fenêtre en Inter', async t => {
  const { page } = await newPage(t);
  await page.goto(server.url + '/');
  await page.evaluate(() => openFeedback('app'));
  const f = await page.locator('#fbTitle').evaluate(e => getComputedStyle(e).fontFamily);
  assert.match(f, /^'?"?Inter/);
});
