/* Extension 0.5.0 de bout en bout, dans un vrai Chrome : import du fichier CSV et de l'historique
   Netflix (netflix.com simulé), envoi à extension_push_detections (Supabase simulé), puis ouverture
   de l'onglet « Détectés » du site. Rien ne part ailleurs : ni TMDB, ni le site (aucun appel réseau
   vers cinepisode.com, seulement l'onglet ouvert pour l'utilisateur).
   Chrome récent n'accepte plus --load-extension : l'extension est chargée par CDP
   (Extensions.loadUnpacked, --enable-unsafe-extension-debugging). Lancer : cd e2e && npm test */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const CHROME = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'extension');
const SUPA = 'https://batfulcvvquffgfeppcx.supabase.co';
const TOKEN = 'a7'.repeat(24);
let ctx, cdp, extId, profileDir;
const log = { push: [], other: [], site: [] };

before(async () => {
  if (!CHROME) throw new Error('Chrome introuvable : définis CHROME_PATH');
  const port = 9300 + Math.floor(Math.random() * 500);
  profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cinepisode-ext-'));
  ctx = await chromium.launchPersistentContext(profileDir, {
    executablePath: CHROME, headless: true, viewport: { width: 1000, height: 800 },
    ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--headless=new', '--enable-unsafe-extension-debugging', '--remote-debugging-port=' + port],
  });
  cdp = await chromium.connectOverCDP('http://127.0.0.1:' + port);
  const session = await cdp.newBrowserCDPSession();
  extId = (await session.send('Extensions.loadUnpacked', { path: EXT })).id;
  assert.match(extId, /^[a-p]{32}$/);

  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  await ctx.route(SUPA + '/**', async route => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    const url = req.url();
    const body = JSON.parse(req.postData() || '{}');
    if (url.endsWith('/rest/v1/rpc/extension_push_detections')) {
      log.push.push({ body, headers: req.headers() });
      if (body.p_token !== TOKEN) return json(route, { status: 'invalid_token' });
      return json(route, { status: 'ok', inserted: body.p_items.length, updated: 0, unchanged: 0, invalid: 0 });
    }
    log.other.push(url);
    return json(route, { status: 'ok' });
  });
  /* netflix.com simulé : page /browse (contexte React avec le profil actif), historique, fiches */
  const META = { video: { type: 'show', id: 80, title: 'Dark', year: 2017, hiddenEpisodeNumbers: false, seasons: [
    { seq: 1, episodes: [{ id: 81, seq: 1 }, { id: 82, seq: 2 }] }, { seq: 2, episodes: [{ id: 91, seq: 1 }, { id: 92, seq: 2 }, { id: 93, seq: 3 }] }] } };
  const HIST = [[
    { movieID: 93, series: 80, seriesTitle: 'Dark', title: 'Ghosts', date: Date.parse('2026-10-05T20:00:00Z'), bookmark: 2950, duration: 3000 },
    { movieID: 92, series: 80, seriesTitle: 'Dark', title: 'Dark Matter', date: Date.parse('2026-10-04T20:00:00Z'), bookmark: 3000, duration: 3000 },
    { movieID: 70, title: 'Glass Onion', date: Date.parse('2026-09-01T20:00:00Z'), bookmark: 7000, duration: 8400 },
  ]];
  await ctx.route('https://www.netflix.com/**', async route => {
    const u = new URL(route.request().url());
    if (u.pathname === '/browse') return route.fulfill({ status: 200, contentType: 'text/html', body:
      '<!doctype html><title>Netflix</title><script>window.netflix={reactContext:{models:{userInfo:{data:{userGuid:"GUID1",name:"Pierre"}}}}};</script><p>browse</p>' });
    if (u.pathname.startsWith('/api/aui/pathEvaluator/')) {
      const page = JSON.parse(u.searchParams.get('callPath'))[2];
      return json(route, { jsonGraph: { aui: { viewingActivity: { value: { viewedItems: HIST[page] || [] } } } } });
    }
    if (u.pathname.endsWith('/metadata')) return json(route, META);
    return route.fulfill({ status: 404, body: '' });
  });
  /* Onglet ouvert pour l'utilisateur : servi localement (pas de réseau) et noté */
  await ctx.route('https://cinepisode.com/**', route => { log.site.push(route.request().url()); return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Cinepisode</title>' }); });
  await ctx.route('**/api/tmdb**', route => { log.other.push(route.request().url()); return route.fulfill({ status: 500, body: '' }); });
});
after(async () => { await cdp?.close().catch(() => {}); await ctx?.close(); fs.rmSync(profileDir, { recursive: true, force: true }); });

async function optionsPage(token) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('chrome-extension://' + extId + '/options.html');
  await page.evaluate(t => new Promise(r => chrome.storage.local.set(t ? { wlToken: t } : {}, r)), token);
  if (!token) await page.evaluate(() => new Promise(r => chrome.storage.local.remove('wlToken', r)));
  await page.evaluate(() => new Promise(r => chrome.storage.local.remove(['wlImport', 'wlImportMeta'], r)));
  await page.reload();
  return { page, errors };
}
const waitDetectedTab = (n) => (async () => {
  for (let i = 0; i < 100; i++) {
    const pages = ctx.pages().filter(p => p.url().startsWith('https://cinepisode.com/'));
    if (pages.length >= n) return pages[n - 1];
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('onglet Détectés non ouvert');
})();

test('extension : fichier CSV -> détections envoyées à Cinepisode, puis onglet « Détectés »', async () => {
  const { page, errors } = await optionsPage(TOKEN);
  const csv = 'Title,Date\n"Severance: Season 1: Good News About Hell","20/02/2022"\n"Severance: Season 1: Half Loop","21/02/2022"\n'
    + '"Dark: Saison 3: Épisode 8","27/06/2020"\n"Inception","16/07/2010"\n';
  await page.setInputFiles('#csvFile', { name: 'NetflixViewingHistory.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  const tab = await waitDetectedTab(1);
  assert.equal(tab.url(), 'https://cinepisode.com/#detectes');
  await page.waitForFunction(() => document.querySelector('#importStatus').className === 'ok');
  assert.match(await page.textContent('#importStatus'), /3/);
  assert.equal(log.push.length, 1);
  const { body, headers } = log.push[0];
  assert.equal(body.p_token, TOKEN);
  assert.deepEqual(Object.keys(body).sort(), ['p_items', 'p_token']);
  const by = Object.fromEntries(body.p_items.map(i => [i.title, i]));
  assert.deepEqual(Object.keys(by).sort(), ['Dark', 'Inception', 'Severance']);
  for (const it of body.p_items) assert.deepEqual(Object.keys(it).sort(), ['episode', 'progress_pct', 'season', 'source', 'title', 'type', 'watched_at']);
  assert.deepEqual([by.Severance.source, by.Severance.type, by.Severance.season, by.Severance.episode], ['netflix_csv', 'show', 1, 2]);
  assert.deepEqual([by.Dark.season, by.Dark.episode], [3, 8]);
  assert.deepEqual([by.Inception.type, by.Inception.season], ['movie', null]);
  assert.ok(!('authorization' in headers) || !headers.authorization.includes(TOKEN), 'jeton seulement dans le corps de la RPC');
  await tab.close();
  assert.deepEqual(errors, []);
});

test('extension : historique Netflix (onglet netflix.com) -> une ligne par titre, épisode le plus avancé', async () => {
  log.push.length = 0;
  const { page, errors } = await optionsPage(TOKEN);
  await page.click('#importNetflix');
  const tab = await waitDetectedTab(1);
  assert.equal(tab.url(), 'https://cinepisode.com/#detectes');
  await page.waitForFunction(() => document.querySelector('#importStatus').className === 'ok');
  assert.equal(log.push.length, 1);
  const items = log.push[0].body.p_items;
  assert.deepEqual(items.map(i => [i.source, i.title, i.type, i.season, i.episode, i.progress_pct]),
    [['netflix', 'Dark', 'show', 2, 3, 98], ['netflix', 'Glass Onion', 'movie', null, null, 83]]);
  assert.equal(items[0].watched_at, Date.parse('2026-10-05T20:00:00Z'));
  const meta = await page.evaluate(() => new Promise(r => chrome.storage.local.get(['wlImportMeta', 'wlImport'], r)));
  assert.equal(meta.wlImportMeta.netflixLastMs, Date.parse('2026-10-05T20:00:00Z'), 'prochain import : seulement les nouveaux visionnages');
  assert.ok(!JSON.stringify(meta).includes(TOKEN), 'le jeton n\'est jamais recopié dans l\'état de l\'import');
  await tab.close();
  assert.deepEqual(errors, []);
});

test('extension : jeton refusé -> message clair, aucun onglet ouvert ; aucun appel TMDB ni au site', async () => {
  log.push.length = 0;
  const before = log.site.length;
  const { page } = await optionsPage('b8'.repeat(24));
  await page.setInputFiles('#csvFile', { name: 'h.csv', mimeType: 'text/csv', buffer: Buffer.from('Title,Date\n"Inception","16/07/2010"\n') });
  await page.waitForFunction(() => document.querySelector('#importStatus').className === 'err');
  assert.equal(log.push.length, 1);
  await new Promise(r => setTimeout(r, 300));
  assert.equal(log.site.length, before, 'pas d\'onglet Détectés quand rien n\'a été envoyé');
  assert.deepEqual(log.other, [], 'l\'extension ne parle qu\'à la RPC extension_push_detections');
  const manifest = await page.evaluate(() => chrome.runtime.getManifest());
  assert.deepEqual(manifest.host_permissions, [SUPA + '/*', 'https://www.netflix.com/*']);
});
