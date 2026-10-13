/* Partage en lecture seule (js/30-share.js, api/share.js) : fenêtre « Partager » depuis Ma liste et le menu ☰,
   création d'un lien filtré (notes masquées par défaut, titres détectés jamais partagés), copie, désactivation ;
   page publique /s/<jeton> rendue par la vraie fonction (noindex, sans script, sans traceur), lien inconnu = 404 ;
   « Ajouter à ma liste » depuis la page publique. SCREENSHOTS=dossier pour les captures.
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
const items = () => { n = 0; return [item({ title: 'Kingdom' }), item({ title: 'Jujutsu Kaisen' }), item({ title: 'Invincible', type: 'serie' }), item({ title: 'Monster', status: 'avoir' }), item({ title: 'Dune', type: 'film', tmdb_type: 'movie', status: 'termine' })]; };
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

test('Partager depuis Ma liste : lien filtré, notes masquées, détectés jamais, copie et désactivation', async t => {
  const { page, db, problems, calls } = await newPage(t);
  await page.click('button[data-v="list"]:visible');
  await page.locator('#p3ShareBtn').waitFor();
  await page.click('#p3ShareBtn');
  const sheet = page.locator('#shareMbk.on .sh-wrap');
  await sheet.waitFor();
  assert.match(await sheet.textContent(), /Liste filtrée.*Titres détectés.*Jamais/s);
  assert.equal(await sheet.locator('.sh-kind.on b').textContent(), 'Liste filtrée');
  assert.equal(await sheet.locator('.sh-sw[aria-checked="true"]').count(), 1, 'seul « Masquer mes notes » est activé par défaut');
  await sheet.locator('.sh-chips button', { hasText: 'Anime' }).click();
  assert.match(await sheet.locator('.sh-foot').textContent(), /^2 titres/);
  await shot(page, 'share-modal-desktop');
  await sheet.locator('.sh-create').click();
  await sheet.locator('.sh-link').waitFor();
  const link = await page.textContent('#shLinkTxt');
  assert.match(link, new RegExp('^' + server.url.replace(/[.:/]/g, '\\$&') + '/s/[A-Za-z0-9_-]{22}$'));
  assert.equal(db.shares.length, 1);
  assert.deepEqual([db.shares[0].kind, db.shares[0].filter_status, db.shares[0].filter_types, db.shares[0].hide_ratings, db.shares[0].hide_progress], ['filtered', ['encours'], ['anime'], true, false]);
  await shot(page, 'share-link-desktop');
  await sheet.locator('button', { hasText: 'Copier le lien' }).first().click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), link);
  page.once('dialog', d => d.accept());
  await sheet.locator('.sh-rev').first().click();
  await page.waitForFunction(() => !document.querySelector('#shareMbk .sh-link'));
  assert.ok(db.shares[0].revoked_at, 'lien révoqué en base');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#shareMbk.on').count(), 0);
  // Menu ☰ : même fenêtre
  await page.locator('[data-click="toggleMenu"]:visible').first().click();
  await page.click('[data-click="menuShare"]');
  await page.locator('#shareMbk.on').waitFor();
  assert.deepEqual(calls, [], 'aucun appel à un tiers');
  assert.deepEqual(problems, []);
});

test('Partager sur mobile : feuille en bas d\'écran, sans débordement', async t => {
  const { page, problems } = await newPage(t, { viewport: { width: 390, height: 844 }, mobile: true });
  await page.tap('.p3-tb[data-v="list"]');
  await page.locator('#p3ShareBtn').waitFor();
  await page.tap('#p3ShareBtn');
  await page.locator('#shareMbk.on .sh-wrap').waitFor();
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => { const b = document.querySelector('#shareMbk .sh-wrap').getBoundingClientRect(); return { l: b.left, w: b.width, bottom: Math.round(b.bottom), sw: document.documentElement.scrollWidth }; });
  assert.ok(r.l === 0 && r.w === 390 && r.bottom === 844 && r.sw <= 390, JSON.stringify(r));
  await shot(page, 'share-modal-mobile');
  await page.tap('#shareMbk .sh-create');
  await page.locator('#shareMbk .sh-link').waitFor();
  await shot(page, 'share-link-mobile');
  assert.deepEqual(problems, []);
});

test('Page publique /s/<jeton> : lecture seule, noindex, sans script ni traceur ; lien inconnu = 404', async t => {
  const res = await fetch(server.url + '/s/' + TOK);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  assert.match(res.headers.get('cache-control'), /no-store/);
  const html = await res.text();
  assert.doesNotMatch(html, /<script/i, 'aucun script');
  assert.match(html, /<meta name="robots" content="noindex/);
  assert.match(html, new RegExp('og:image" content="[^"]*/api/og\\?t=' + TOK));
  assert.match(html, /Pierre regarde 3 anime en ce moment/);
  for (const bad of [TOK.slice(0, 21) + 'X', 'trop-court', "x'or1=1"]) {
    const r = await fetch(server.url + '/s/' + encodeURIComponent(bad));
    assert.equal(r.status, 404, bad);
    assert.doesNotMatch(await r.text(), /Kingdom/);
  }
  for (const [name, vp, mob] of [['desktop', { width: 1440, height: 900 }, false], ['mobile', { width: 390, height: 844 }, true]]) {
    const { page, problems, calls } = await newPage(t, { viewport: vp, mobile: mob, login: false });
    await page.goto(server.url + '/s/' + TOK);
    assert.equal(await page.locator('.grid .pc').count(), 3);
    assert.equal(await page.locator('.pc .add').count(), 3);
    assert.ok(await page.evaluate(() => [...document.querySelectorAll('.pc')].every(c => c.getBoundingClientRect().right <= innerWidth)), 'grille dans l\'écran');
    assert.match(await page.locator('.cta').textContent(), /Créé avec Cinepisode|Créer avec Cinepisode/);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await shot(page, 'share-public-' + name, true);
    assert.deepEqual(calls, []);
    assert.deepEqual(problems, []);
  }
});

test('« Ajouter à ma liste » depuis la page publique : fenêtre d\'ajout pré-remplie une fois connecté', async t => {
  const { page, problems } = await newPage(t, { login: false });
  await page.goto(server.url + '/s/' + TOK);
  const href = await page.locator('.pc .add').nth(1).getAttribute('href');
  assert.match(href, /^\/\?ajouter=tv\.95479&t=Jujutsu\+Kaisen&y=2020&p=%2Fp2\.jpg$/);
  await page.goto(server.url + href);
  await page.waitForFunction(() => typeof memDB !== 'undefined');
  assert.equal(new URL(page.url()).search, '', 'paramètres retirés de l\'adresse');
  await page.evaluate(() => { const m = document.getElementById('authMbk'); if (m && !m.classList.contains('on')) document.getElementById('syncStatusPill').click(); });
  await page.locator('#authEmail').waitFor();
  await page.fill('#authEmail', 'pierre@exemple.fr');
  await page.fill('#authPassword', 'Correct-Horse-42');
  await page.click('.auth-submit');
  await page.locator('#authViewTitle').filter({ hasText: /Mon compte/ }).waitFor();
  await page.click('#authMbk .auth-close');
  await page.locator('#addMbk.on').waitFor({ timeout: 10000 });
  assert.equal(await page.textContent('#sptitle'), 'Jujutsu Kaisen');
  assert.deepEqual(problems, []);
});
