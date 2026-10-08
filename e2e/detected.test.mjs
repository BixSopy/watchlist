/* Onglet « Détectés » : titres envoyés par l'extension (table detected_media, Supabase simulé avec
   RLS), sous la CSP de production. Correspondance avec la liste, choix TMDB (proxy /api/tmdb simulé),
   ajout et mise à jour par le code d'ajout du site, « Ignorer », « Tout effacer », badge.
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
const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '99999999-9999-4999-8999-999999999999';

before(async () => {
  if (!CHROME) throw new Error('Chrome introuvable : définis CHROME_PATH');
  browser = await chromium.launch({ executablePath: CHROME, headless: true });
  server = await startServer();
});
after(async () => { await browser?.close(); await server?.close(); });

const item = (o) => ({ id: 'srv-' + o.local_id, profile_id: 'p-' + ME, tmdb_type: 'tv', type: 'serie', status: 'avoir', year: '2017',
  poster_path: null, tmdb_score: 8, my_rating: 0, overview: '', tags: [], saison: null, episode: null, total_ep: null, anime_genre: '',
  deleted: false, updated_at: '2026-10-01T10:00:00Z', added_at: '2026-09-01T10:00:00Z', ...o });
let n = 0;
const det = (o) => ({ id: 'd' + String(++n).padStart(3, '0'), user_id: ME, source: 'netflix', media_type: 'show', season: null, episode: null,
  watched_at: '2026-10-0' + (1 + (n % 7)) + 'T10:00:00Z', progress_pct: null, state: 'pending', ...o });

function fixtures() {
  n = 0;
  return {
    items: [
      item({ local_id: 'l-dark', tmdb_id: 70523, title: 'Dark', status: 'encours', saison: 1, episode: 4, total_ep: 26 }),
      item({ local_id: 'l-inc', tmdb_id: 27205, tmdb_type: 'movie', type: 'film', title: 'Inception', status: 'termine', year: '2010' }),
      item({ local_id: 'l-lupin1', tmdb_id: 96677, title: 'Lupin' }),
      item({ local_id: 'l-lupin2', tmdb_id: 31724, type: 'anime', title: 'Lupin' }),
    ],
    detected: [
      det({ raw_title: 'Dark', normalized_title: 'dark', season: 2, episode: 3 }),
      det({ raw_title: 'Inception', normalized_title: 'inception', media_type: 'movie' }),
      det({ raw_title: 'Arcane', normalized_title: 'arcane', season: 1, episode: 9, source: 'netflix_csv' }),
      det({ raw_title: 'Arcane', normalized_title: 'arcane', season: 1, episode: 6 }),
      det({ raw_title: 'The Office', normalized_title: 'office', season: 1, episode: 2 }),
      det({ raw_title: 'Glass Onion', normalized_title: 'glass onion', media_type: 'movie' }),
      det({ raw_title: 'Lupin', normalized_title: 'lupin', season: 1, episode: 5, source: 'live' }),
      det({ raw_title: 'Titre Introuvable', normalized_title: 'titre introuvable', season: 1, episode: 1 }),
      det({ raw_title: 'Secret', normalized_title: 'secret', user_id: OTHER }),
      det({ raw_title: 'Dark Matter', normalized_title: 'dark matter', season: 1, episode: 1, state: 'ignored' }),
    ],
  };
}
const TMDB = {
  'tv:Arcane': [{ id: 94605, name: 'Arcane', original_name: 'Arcane', first_air_date: '2021-11-06', popularity: 120, vote_average: 8.7, poster_path: '/arcane.jpg', overview: 'Riot', genre_ids: [16], origin_country: ['US'] }],
  'tv:The Office': [
    { id: 2316, name: 'The Office', original_name: 'The Office', first_air_date: '2005-03-24', popularity: 300, vote_average: 8.6, poster_path: '/us.jpg' },
    { id: 2996, name: 'The Office', original_name: 'The Office', first_air_date: '2001-07-09', popularity: 120, vote_average: 8.1, poster_path: '/uk.jpg' }],
  'movie:Glass Onion': [{ id: 661374, title: 'Glass Onion', original_title: 'Glass Onion: A Knives Out Mystery', release_date: '2022-11-23', popularity: 80, vote_average: 7.1, poster_path: '/go.jpg' }],
  'tv:Titre Introuvable': [],
  'tv:JUJUTSU KAISEN': [{ id: 95479, name: 'JUJUTSU KAISEN', original_name: '呪術廻戦', first_air_date: '2020-10-03', popularity: 150, vote_average: 8.5, poster_path: '/jjk.jpg', overview: 'Anime', genre_ids: [16, 10759], origin_country: ['JP'] }],
  'tv:The Boys': [{ id: 76479, name: 'The Boys', original_name: 'The Boys', first_air_date: '2019-07-25', popularity: 400, vote_average: 8.4, poster_path: '/boys.jpg', overview: 'Supes', genre_ids: [10765], origin_country: ['US'] }],
};
const TV_DETAILS = {
  94605: { id: 94605, status: 'Returning Series', in_production: true, number_of_episodes: 18, seasons: [{ season_number: 1, episode_count: 9 }, { season_number: 2, episode_count: 9 }] },
  2996: { id: 2996, status: 'Ended', in_production: false, number_of_episodes: 14, seasons: [{ season_number: 1, episode_count: 6 }, { season_number: 2, episode_count: 6 }] },
  70523: { id: 70523, status: 'Ended', in_production: false, number_of_episodes: 26, seasons: [{ season_number: 1, episode_count: 10 }, { season_number: 2, episode_count: 8 }, { season_number: 3, episode_count: 8 }] },
};

async function newPage(t, opts = {}) {
  server.config = { turnstileSiteKey: '', signupsOpen: true };
  const ctx = await browser.newContext({ locale: opts.locale || 'fr-FR', viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', m => { const x = m.text(); if (m.type() === 'error' && !/^Failed to load resource: the server responded with a status of (4\d\d)/.test(x)) problems.push(x); if (/Content Security Policy/i.test(x)) problems.push(x); });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  page.on('dialog', d => d.accept());
  const fx = fixtures();
  if (opts.detected) fx.detected.push(...opts.detected.map(det));
  const db = await installFakeSupabase(page, fx);
  const tmdbCalls = [];
  /* Proxy TMDB du site : /api/tmdb?path=/search/tv&query=… (js/04-tmdb-api.js) */
  await page.route(u => u.pathname === '/api/tmdb', route => {
    const u = new URL(route.request().url());
    const tp = u.searchParams.get('path') || '';
    tmdbCalls.push({ path: tp, query: u.searchParams.get('query'), auth: route.request().headers()['authorization'] || '' });
    let body = { results: [] };
    const m = tp.match(/^\/search\/(tv|movie)$/);
    if (m) body = { page: 1, results: TMDB[m[1] + ':' + u.searchParams.get('query')] || [] };
    const d = tp.match(/^\/tv\/(\d+)$/);
    if (d) body = TV_DETAILS[d[1]] || { id: +d[1], status: 'Returning Series', seasons: [] };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.route('https://image.tmdb.org/**', r => r.fulfill({ status: 404, body: '' }));
  t.after(() => ctx.close());
  return { page, db, problems, tmdbCalls };
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
const row = (page, title) => page.locator('.det-row', { has: page.locator('.det-name', { hasText: new RegExp('^' + title + '$') }) });

test('Détectés : onglet caché sans compte, badge, groupes, filtres, correspondances et choix TMDB', async t => {
  const { page, db, problems, tmdbCalls } = await newPage(t);
  await page.goto(server.url + '/');
  assert.equal(await page.locator('#detTab').isHidden(), true, 'onglet invisible sans compte');
  await login(page);
  await page.locator('#detTab').waitFor({ state: 'visible' });
  await page.locator('#detBadge').filter({ hasText: /^\d+$/ }).waitFor();
  // Inception est déjà terminé : classé automatiquement (state = added), la liste n'est pas touchée
  await page.waitForFunction(() => document.getElementById('detBadge').textContent === '6');
  assert.equal(db.detected.find(r => r.raw_title === 'Inception').state, 'added');
  await page.click('#detTab');
  assert.equal(new URL(page.url()).hash, '#detectes');
  await page.locator('.det-row').first().waitFor();
  await page.waitForFunction(() => !document.querySelector('#detectedSection').textContent.includes('Recherche de la fiche'));
  const names = await page.locator('.det-name').allTextContents();
  assert.deepEqual(names.slice().sort(), ['Arcane', 'Dark', 'Glass Onion', 'Lupin', 'The Office', 'Titre Introuvable'], 'un groupe par titre ; ni ligne ignorée, ni ligne d\'un autre compte');
  assert.equal(await page.locator('#mc').isHidden(), true);
  // Correspondances
  assert.match(await row(page, 'Dark').textContent(), /Mise à jour.*Dans ta liste : Dark \(S01 E04\) → S02 E03/s);
  assert.deepEqual(await row(page, 'Arcane').locator('.det-src').allTextContents(), ['Fichier Netflix', 'Netflix'], 'une pastille par source');
  assert.match(await row(page, 'Arcane').textContent(), /Nouveau.*Fichier Netflix.*Netflix.*Vu jusqu'à ≈ S01 E09.*Ajouter Arcane \(2021\) en cours à ≈ S01 E09/s, 'CSV et historique fusionnés, épisode le plus avancé (estimé par le CSV : ≈)');
  assert.match(await row(page, 'Glass Onion').textContent(), /Ajouter Glass Onion \(2022\) comme terminé/);
  assert.match(await row(page, 'The Office').textContent(), /Ambigu.*Plusieurs fiches possibles/s);
  assert.match(await row(page, 'Lupin').textContent(), /Ambigu.*Plusieurs titres de ta liste correspondent/s);
  assert.match(await row(page, 'Titre Introuvable').textContent(), /Aucune fiche trouvée/);
  if (process.env.SCREENSHOTS) { fs.mkdirSync(process.env.SCREENSHOTS, { recursive: true }); await page.screenshot({ path: process.env.SCREENSHOTS + '/detectes.png', fullPage: true }); }
  // Coché par défaut seulement sans choix à faire
  const checked = async title => row(page, title).locator('.det-cb').isChecked();
  assert.deepEqual([await checked('Dark'), await checked('Arcane'), await checked('Glass Onion'), await checked('The Office'), await checked('Lupin')], [true, true, true, false, false]);
  assert.equal(await row(page, 'Titre Introuvable').locator('.det-cb').isDisabled(), true);
  // Filtres
  await page.click('.det-filters .stab:has-text("Mises à jour")');
  assert.deepEqual(await page.locator('.det-name').allTextContents(), ['Dark']);
  await page.click('.det-filters .stab:has-text("Ambigus")');
  assert.deepEqual((await page.locator('.det-name').allTextContents()).sort(), ['Lupin', 'The Office']);
  await page.click('.det-filters .stab:has-text("Nouveaux")');
  assert.deepEqual((await page.locator('.det-name').allTextContents()).sort(), ['Arcane', 'Glass Onion', 'Titre Introuvable']);
  await page.click('.det-filters .stab:has-text("Tous")');
  // TMDB par le proxy du site, avec la session (jamais de clé dans la page)
  const searches = tmdbCalls.filter(c => c.path.startsWith('/search/'));
  assert.deepEqual(searches.map(c => c.query).sort(), ['Arcane', 'Glass Onion', 'The Office', 'Titre Introuvable'], 'pas de recherche pour les titres déjà dans la liste');
  assert.ok(searches.every(c => /^Bearer /.test(c.auth)));
  // Lignes de l'autre compte : jamais demandées hors RLS
  assert.ok(db.calls.filter(c => c.path === '/rest/v1/detected_media' && c.method === 'GET').every(c => /state=eq\.pending/.test(c.search)));
  assert.equal(await page.evaluate(() => document.querySelectorAll('[onclick],[onchange]').length), 0);
  assert.deepEqual(problems, []);
});

test('Détectés : ajouter la sélection (ajouts identiques au formulaire, mises à jour en avant), Ignorer, Tout effacer', async t => {
  const { page, db, problems } = await newPage(t);
  await page.goto(server.url + '/#detectes');
  await login(page);
  // Arrivée par le lien de l'extension : l'onglet s'ouvre dès que le compte est prêt
  await page.locator('#detTab.on').waitFor();
  await page.waitForFunction(() => !document.querySelector('#detectedSection').textContent.includes('Recherche de la fiche') && document.querySelectorAll('.det-row').length === 6);
  // Choix : The Office (UK, série finie : S1E2 n'est pas le dernier épisode) et la série Lupin de la liste
  await row(page, 'The Office').locator('select').selectOption('1');
  await row(page, 'Lupin').locator('select').selectOption('l-lupin1');
  // Glass Onion décoché à la main
  await row(page, 'Glass Onion').locator('.det-cb').uncheck();
  assert.match(await page.locator('#detAddSelBtn').textContent(), /Ajouter la sélection \(4\)/);
  await page.click('#detAddSelBtn');
  await page.waitForFunction(() => document.querySelectorAll('.det-row').length === 2);
  assert.deepEqual((await page.locator('.det-name').allTextContents()).sort(), ['Glass Onion', 'Titre Introuvable']);
  const mem = await page.evaluate(() => memDB.filter(i => !i.deleted).map(i => ({ id: i.id, title: i.title, type: i.type, status: i.status, saison: i.saison, episode: i.episode,
    totalEp: i.totalEp, tmdbId: i.tmdbId, tmdbType: i.tmdbType, year: i.year, poster: i.poster, tmdbScore: i.tmdbScore, needsSync: i.needsSync, keys: Object.keys(i).sort().join(',') })));
  const by = Object.fromEntries(mem.map(i => [i.title + ':' + i.tmdbId, i]));
  // Mises à jour : la progression avance seulement
  assert.deepEqual([by['Dark:70523'].status, by['Dark:70523'].saison, by['Dark:70523'].episode, by['Dark:70523'].needsSync], ['encours', 2, 3, true]);
  assert.deepEqual([by['Lupin:96677'].status, by['Lupin:96677'].saison, by['Lupin:96677'].episode], ['encours', 1, 5]);
  assert.deepEqual([by['Lupin:31724'].status, by['Lupin:31724'].saison], ['avoir', null], 'l\'autre Lupin n\'est pas touché');
  // Ajouts : mêmes champs qu'un ajout manuel (makeEntry)
  const arcane = by['Arcane:94605'];
  assert.deepEqual([arcane.type, arcane.status, arcane.saison, arcane.episode, arcane.totalEp, arcane.tmdbType, arcane.year, arcane.poster, arcane.tmdbScore],
    ['serie', 'encours', 1, 9, 18, 'tv', '2021', '/arcane.jpg', '8.7']);
  const office = by['The Office:2996'];
  assert.deepEqual([office.status, office.saison, office.episode, office.totalEp], ['encours', 1, 2, 14]);
  const manualKeys = await page.evaluate(() => Object.keys(makeEntry({ tmdbId: 1, tmdbType: 'tv', title: 'x' }, { type: 'serie', status: 'encours' }, null, null)).sort().join(','));
  assert.equal(arcane.keys, manualKeys, 'fiche identique à un ajout par le formulaire');
  assert.equal(by['Glass Onion:661374'], undefined, 'décoché : pas ajouté');
  // Les détections appliquées sont classées (state = added) ; ignorées / effacées ensuite
  const st = title => db.detected.filter(r => r.raw_title === title && r.user_id === ME).map(r => r.state);
  assert.deepEqual([...st('Dark'), ...st('Arcane'), ...st('The Office'), ...st('Lupin')], ['added', 'added', 'added', 'added', 'added']);
  assert.ok(db.calls.filter(c => c.path === '/rest/v1/detected_media' && c.method === 'PATCH').every(c => JSON.stringify(c.body) === '{"state":"added"}' || JSON.stringify(c.body) === '{"state":"ignored"}'));
  assert.equal(await page.locator('#detBadge').textContent(), '2');
  // Synchronisation : les nouveaux titres partent par le chemin habituel (upsert watchlist_items)
  await page.evaluate(() => syncNow());
  await page.waitForFunction(() => !syncInProgress);
  const pushed = db.calls.filter(c => c.path === '/rest/v1/watchlist_items' && c.method === 'POST').flatMap(c => c.body || []);
  assert.ok(pushed.some(r => r.tmdb_id === 94605 && r.status === 'encours' && r.saison === 1 && r.episode === 9));
  // Ignorer
  await row(page, 'Titre Introuvable').locator('.det-ign').click();
  await page.waitForFunction(() => document.querySelectorAll('.det-row').length === 1);
  assert.deepEqual(st('Titre Introuvable'), ['ignored']);
  // Tout effacer : seulement les détections en attente (les ignorées restent ignorées)
  await page.click('button:has-text("Tout effacer")');
  await page.locator('.det-empty').filter({ hasText: 'Aucun titre en attente' }).waitFor();
  assert.deepEqual(st('Glass Onion'), []);
  assert.deepEqual(st('Titre Introuvable'), ['ignored']);
  assert.deepEqual(st('Dark Matter'), ['ignored']);
  assert.ok(db.detected.some(r => r.user_id === OTHER), 'lignes d\'un autre compte intactes');
  assert.equal(await page.locator('#detBadge').isHidden(), true, 'plus de badge');
  // Retour à la liste : le hash est retiré
  await page.click('.ntab[data-tab="all"]');
  assert.equal(new URL(page.url()).hash, '');
  assert.equal(await page.locator('#detectedSection').isHidden(), true);
  assert.deepEqual(problems, []);
});

test('Détectés : interface en anglais', async t => {
  const { page, problems } = await newPage(t, { locale: 'en-US' });
  await page.goto(server.url + '/');
  await page.evaluate(() => { localStorage.setItem('wl_lang', 'en'); });
  await page.goto(server.url + '/#detectes');
  await page.click('#syncStatusPill');
  await page.fill('#authEmail', 'pierre@exemple.fr');
  await page.fill('#authPassword', 'Correct-Horse-42');
  await page.click('.auth-submit');
  await page.locator('#detTab.on').waitFor();
  await page.evaluate(() => { const m = document.getElementById('authMbk'); if (m) m.classList.remove('on'); });
  assert.equal(await page.locator('#detTab span[data-i18n]').textContent(), 'Detected');
  await page.locator('.det-title', { hasText: 'Detected titles' }).waitFor();
  assert.match(await page.locator('.det-filters').textContent(), /All.*New.*Updates.*Ambiguous/s);
  assert.match(await page.locator('#detectedSection').textContent(), /Clear all/);
  assert.deepEqual(problems, []);
});

test('Détectés : pastilles Crunchyroll / Prime Video ; saison Crunchyroll à vérifier (pas cochée d\'office)', async t => {
  const { page, problems } = await newPage(t, { detected: [
    { raw_title: 'JUJUTSU KAISEN', normalized_title: 'jujutsu kaisen', season: 2, episode: 5, source: 'crunchyroll', progress_pct: 100 },
    { raw_title: 'The Boys', normalized_title: 'boys', season: 4, episode: 3, source: 'prime', progress_pct: 100 },
    { raw_title: 'The Boys', normalized_title: 'boys', season: 4, episode: 2, source: 'live' },
  ] });
  await page.goto(server.url + '/');
  await login(page);
  await page.locator('#detTab').waitFor({ state: 'visible' });
  await page.click('#detTab');
  await row(page, 'JUJUTSU KAISEN').waitFor();
  await page.waitForFunction(() => !document.querySelector('#detectedSection').textContent.includes('Recherche de la fiche'));
  const jjk = row(page, 'JUJUTSU KAISEN'), boys = row(page, 'The Boys');
  assert.deepEqual(await jjk.locator('.det-src').allTextContents(), ['Crunchyroll']);
  assert.equal(await jjk.locator('.det-src').getAttribute('class'), 'det-src det-src-crunchyroll');
  assert.deepEqual((await boys.locator('.det-src').allTextContents()).sort(), ['Prime Video', 'Vu en direct']);
  assert.equal(await boys.locator('.det-src-prime').count(), 1);
  assert.match(await jjk.textContent(), /Vu jusqu'à S02 E05.*Numérotation Crunchyroll : vérifie la saison/s);
  assert.match(await jjk.textContent(), /Ajouter JUJUTSU KAISEN \(2020\) en cours à S02 E05/);
  assert.equal(await jjk.locator('.det-cb').isChecked(), false, 'Crunchyroll : à vérifier avant d\'ajouter');
  assert.equal(await jjk.locator('.det-cb').isDisabled(), false);
  assert.equal(await boys.locator('.det-cb').isChecked(), true);
  assert.match(await boys.textContent(), /Vu jusqu'à S04 E03/);
  assert.deepEqual(problems, []);
});
