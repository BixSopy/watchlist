/* Onglet « Calendrier » (js/26-calendar.js) : sorties des titres de la liste via le proxy /api/tmdb simulé,
   grille du mois, prochaines sorties, filtres, épisodes vus masqués, export .ics ; et compteurs des onglets
   qui suivent le filtre de statut. Date figée au lundi 12 octobre 2026. SCREENSHOTS=dossier pour les captures.
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
const item = (o) => ({ id: 'srv-' + (++n), local_id: 'l-' + n, profile_id: 'p-' + ME, tmdb_id: 1000 + n, tmdb_type: 'tv', type: 'serie', status: 'encours',
  title: 'Titre ' + n, year: '2020', poster_path: '/p' + n + '.jpg', tmdb_score: 7.5, my_rating: 0, overview: '', tags: [], saison: null, episode: null,
  total_ep: null, anime_genre: '', deleted: false, updated_at: '2026-10-01T10:00:00Z', added_at: '2026-09-10T10:00:00Z', ...o });
function items() {
  n = 0;
  return [
    item({ tmdb_id: 95479, type: 'anime', title: 'Jujutsu Kaisen', saison: 3, episode: 1 }),
    item({ tmdb_id: 95557, title: 'Invincible', saison: 3, episode: 4 }),
    item({ tmdb_id: 30981, title: 'Monster', status: 'avoir' }),
    item({ tmdb_id: 70000, type: 'anime', title: 'Kingdom', saison: 6, episode: 0 }),
    item({ tmdb_id: 1399, title: 'Game of Thrones', status: 'termine', saison: 8, episode: 6 }),
    item({ tmdb_id: 693134, tmdb_type: 'movie', type: 'film', title: 'Dune : Part Three', status: 'encours' }),
    item({ tmdb_id: 500, tmdb_type: 'movie', type: 'film', title: 'Halloween', status: 'avoir' }),
    item({ tmdb_id: 501, tmdb_type: 'movie', type: 'film', title: 'Film vu', status: 'termine' }),
  ];
}
const weekly = (s, first, from, count) => ({ season_number: s, episodes: Array.from({ length: count }, (_, i) => {
  const d = new Date(first + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 7 * i); return { episode_number: from + i, season_number: s, air_date: d.toISOString().slice(0, 10), name: 'Épisode ' + (from + i) };
}) });
const TV = {
  95479: [{ next_episode_to_air: { season_number: 3, episode_number: 2, air_date: '2026-10-12' } }, { 3: weekly(3, '2026-10-05', 1, 6) }],
  95557: [{ next_episode_to_air: { season_number: 3, episode_number: 6, air_date: '2026-10-13' } }, { 3: weekly(3, '2026-09-22', 3, 8) }],
  30981: [{ next_episode_to_air: { season_number: 1, episode_number: 9, air_date: '2026-10-12' } }, { 1: { season_number: 1, episodes: [{ episode_number: 9, air_date: '2026-10-12' }] } }],
  70000: [{ next_episode_to_air: { season_number: 6, episode_number: 1, air_date: '2026-10-15' } }, { 6: weekly(6, '2026-10-15', 1, 3) }],
  1399: [{ next_episode_to_air: null, last_episode_to_air: { season_number: 8, air_date: '2019-05-19' } }, {}],
};
const MOVIE_RD = {
  693134: { results: [{ iso_3166_1: 'FR', release_dates: [{ type: 3, release_date: '2026-10-10T00:00:00.000Z' }, { type: 4, release_date: '2026-10-31T00:00:00.000Z' }] }] },
  500: { results: [{ iso_3166_1: 'FR', release_dates: [{ type: 3, release_date: '2026-10-22T00:00:00.000Z' }] }] },
};
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="154" height="231"><defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="#3b4b8a"/><stop offset="1" stop-color="#b44a7a"/></linearGradient></defs><rect width="154" height="231" fill="url(#g)"/></svg>';

async function newPage(t, { viewport = { width: 1440, height: 900 }, mobile = false, locale = 'fr-FR' } = {}) {
  server.config = { turnstileSiteKey: '', signupsOpen: true };
  const ctx = await browser.newContext({ locale, timezoneId: 'Europe/Paris', viewport, acceptDownloads: true, ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date('2026-10-12T10:00:00+02:00'));
  const problems = [], calls = [];
  page.on('console', m => { const x = m.text(); if (m.type() === 'error' && !/^Failed to load resource: the server responded with a status of (4\d\d)/.test(x)) problems.push(x); if (/Content Security Policy/i.test(x)) problems.push(x); });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  page.on('request', r => { const u = new URL(r.url()); if (!/^(127\.0\.0\.1|localhost)$/.test(u.hostname) && u.hostname !== 'image.tmdb.org' && !/supabase/.test(u.hostname)) calls.push(r.url()); });
  await installFakeSupabase(page, { items: items() });
  await page.route(u => u.pathname === '/api/tmdb', r => {
    const u = new URL(r.request().url()), p = u.searchParams.get('path') || '';
    let body = { results: [], page: 1, total_pages: 1 }, m;
    if ((m = p.match(/^\/tv\/(\d+)$/)) && TV[m[1]]) body = { id: +m[1], ...TV[m[1]][0] };
    else if ((m = p.match(/^\/tv\/(\d+)\/season\/(\d+)$/)) && TV[m[1]]) body = TV[m[1]][1][m[2]] || { episodes: [] };
    else if ((m = p.match(/^\/movie\/(\d+)\/release_dates$/))) body = MOVIE_RD[m[1]] || { results: [] };
    else if ((m = p.match(/^\/movie\/(\d+)$/))) body = { id: +m[1], release_date: '2020-01-01' };
    if (u.searchParams.get('api_key')) problems.push('clé TMDB côté client');
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
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
  await page.waitForFunction(() => memDB.filter(i => !i.deleted).length >= 8 && !syncInProgress);
  return { page, problems, calls };
}
const openCal = async page => { await page.click('button[data-v="calendar"]:visible'); await page.waitForFunction(() => _calState.loaded && !_calState.loading); };

test('Calendrier (bureau) : grille d\'octobre, aujourd\'hui, prochaines sorties, filtres, options, .ics', async t => {
  const { page, problems, calls } = await newPage(t);
  await openCal(page);
  // Vue Semaine par défaut (7 colonnes), puis Mois
  assert.equal(await page.locator('.cal-wcol').count(), 7);
  await page.click('.cal-vw button:nth-child(2)');
  assert.equal(new URL(page.url()).hash, '#calendrier');
  assert.equal(await page.locator('#mc').isHidden(), true);
  assert.equal(await page.locator('#heroBand').isHidden(), true);
  assert.equal(await page.textContent('.cal-h1'), 'Octobre 2026');
  assert.equal(await page.locator('.cal-d').count(), 35);
  const todayCell = page.locator('.cal-d.today');
  assert.match(await todayCell.textContent(), /^12Aujourd’huiJujutsu KaisenS03 · E02\+1 autre/);
  // JJK S03E01 déjà vu : masqué ; Invincible E05 (6 oct.) aussi (vu jusqu'à E04 ? non : E05 visible)
  assert.doesNotMatch(await page.locator('.cal-g').textContent(), /S03 · E01/);
  assert.match(await page.locator('.cal-g').textContent(), /Invincible.*S03 · E05/s);
  // Prochaines sorties (7 jours)
  const side = await page.locator('.cal-side .cal-card').first().textContent();
  assert.match(side, /Prochaines sorties 7 jours/);
  assert.match(side, /12lun\.Aujourd’hui.*Jujutsu Kaisen.*Anime S03 · E02Dispo.*Monster.*Série S01 · E09Dispo/s);
  assert.match(side, /13mar\..*Invincible.*S03 · E06Bientôt.*15jeu\..*Kingdom.*S06 · E01/s);
  // Films : Dune (en cours) visible, Halloween (à voir) seulement avec l'option
  assert.match(await page.locator('.cal-g').textContent(), /Dune : Part Three.*Ciné/s);
  assert.doesNotMatch(await page.locator('.cal-g').textContent(), /Halloween/);
  assert.match(await page.textContent('.ntab[data-tab="calendar"] .ntab-cnt'), /^\d+$/);
  if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.addStyleTag({ content: '#toastWrap{display:none}' }); await page.waitForTimeout(700); await page.screenshot({ path: SHOTS + '/calendrier-bureau.png' }); await page.locator('#calendarSection').screenshot({ path: SHOTS + '/calendrier-bureau-section.png' }); await page.locator('.tabs-row').screenshot({ path: SHOTS + '/calendrier-onglets.png' }); }
  await page.click('.cal-sw[data-args*="avoirFilms"]');
  await page.waitForFunction(() => _calState.loaded && document.querySelector('.cal-g').textContent.includes('Halloween'));
  // Filtre Anime
  await page.click('.cal-flt button:has-text("Anime")');
  const g = await page.locator('.cal-g').textContent();
  assert.match(g, /Kingdom/); assert.doesNotMatch(g, /Invincible|Dune/);
  await page.click('.cal-flt button:has-text("Tout")');
  // Masquer les épisodes vus désactivé : S03E01 réapparaît
  await page.click('.cal-sw[data-args*="hideWatched"]');
  assert.match(await page.locator('.cal-g').textContent(), /S03 · E01/);
  // Mois suivant / Aujourd'hui
  await page.click('.cal-ar >> nth=1');
  assert.equal(await page.textContent('.cal-h1'), 'Novembre 2026');
  await page.click('.cal-td');
  assert.equal(await page.textContent('.cal-h1'), 'Octobre 2026');
  // Vue Agenda
  await page.click('.cal-vw button:has-text("Agenda")');
  assert.match(await page.textContent('.cal-agenda-full'), /Octobre 2026 \d+ sorties/);
  // Export .ics : fichier local, sans requête
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.cal-ics')]);
  assert.equal(dl.suggestedFilename(), 'cinepisode-calendrier.ics');
  const ics = fs.readFileSync(await dl.path(), 'utf8');
  assert.match(ics, /^BEGIN:VCALENDAR/); assert.match(ics, /SUMMARY:Invincible — S03E06/); assert.doesNotMatch(ics, /DTSTART;VALUE=DATE:202610(0\d|11)\r/, 'sorties passées non exportées');
  // Retour sur Tout : la liste revient
  await page.click('button[data-v="tonight"]:visible');
  assert.equal(await page.locator('#calendarSection').isHidden(), true);
  assert.equal(new URL(page.url()).hash, '');
  assert.deepEqual(calls, [], 'aucun appel à un tiers');
  assert.deepEqual(problems, []);
});

test('Calendrier (mobile) : bande de la semaine, agenda par défaut', async t => {
  const { page, problems } = await newPage(t, { viewport: { width: 390, height: 844 }, mobile: true });
  await openCal(page);
  assert.equal(await page.locator('.cal-week .cal-wk').count(), 7);
  assert.match(await page.textContent('.cal-wk.on'), /lun12/);
  assert.match(await page.locator('.cal-vw button.on').textContent(), /Semaine/);
  assert.equal(await page.locator('.cal-wcol').count(), 7);
  assert.equal(await page.locator('.cal-g').count(), 0);
  assert.match(await page.locator('.cal-side').textContent(), /Jujutsu Kaisen/);
  const w = await page.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(w <= 390, 'pas de défilement horizontal : ' + w);
  if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.addStyleTag({ content: '#toastWrap{display:none}' }); await page.screenshot({ path: SHOTS + '/calendrier-mobile.png', fullPage: true }); }
  await page.click('.cal-vw button:has-text("Mois")');
  assert.equal(await page.locator('.cal-d').count(), 35);
  assert.deepEqual(problems, []);
});

test('Calendrier en anglais, ouverture par #calendrier', async t => {
  const { page, problems } = await newPage(t, { locale: 'en-US' });
  await page.evaluate(() => { location.hash = '#calendrier'; });
  await page.waitForFunction(() => activeTab === 'calendar' && _calState.loaded && !_calState.loading);
  assert.equal(await page.textContent('.cal-h1'), 'Week of October 12 – October 18');
  await page.click('.cal-vw button:nth-child(2)');
  assert.equal(await page.textContent('.cal-h1'), 'October 2026');
  assert.match(await page.textContent('.cal-ics'), /Add to my calendar/);
  assert.match(await page.locator('.cal-side').textContent(), /Upcoming releases 7 days12Mon.*Today/s);
  assert.deepEqual(problems, []);
});

test('compteurs des onglets : suivent le filtre de statut (Tous / À voir / En cours / Terminé)', async t => {
  const { page, problems } = await newPage(t);
  const counts = () => page.evaluate(() => ['all', 'film', 'serie', 'anime'].map(k => document.querySelector('.ntab[data-tab="' + k + '"] .ntab-cnt').textContent));
  assert.deepEqual(await counts(), ['8', '3', '3', '2']);
  await page.click('#stabs .stab[data-s="avoir"]');
  assert.deepEqual(await counts(), ['2', '1', '1', '0']);
  await page.click('#stabs .stab[data-s="encours"]');
  assert.deepEqual(await counts(), ['4', '1', '1', '2']);
  await page.click('#stabs .stab[data-s="termine"]');
  assert.deepEqual(await counts(), ['2', '1', '1', '0']);
  await page.click('#stabs .stab[data-s="all"]');
  assert.deepEqual(await counts(), ['8', '3', '3', '2']);
  assert.deepEqual(problems, []);
});
