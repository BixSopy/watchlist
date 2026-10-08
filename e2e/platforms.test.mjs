/* Extension 0.6.2 de bout en bout, dans un vrai Chrome : Crunchyroll et Prime Video (sites simulés).
   - extension telle que publiée : plateformes désactivées (permission facultative non accordée),
     aucun accès aux sites, import refusé avec un message clair ;
   - copie de test où les permissions facultatives sont accordées d'avance (Chrome ne permet pas de
     cliquer sur sa fenêtre d'autorisation en mode headless) : scripts en direct enregistrés,
     import des historiques (endpoints simulés), détection en direct sur une vraie vidéo.
   Rien ne part ailleurs que vers les sites simulés et la RPC Supabase simulée.
   Lancer : cd e2e && npm test */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
const EXT = path.resolve(HERE, '..', 'extension');
const FIX = path.resolve(HERE, '..', 'tests', 'fixtures');
const fixture = f => JSON.parse(fs.readFileSync(path.join(FIX, f), 'utf8'));
const SUPA = 'https://batfulcvvquffgfeppcx.supabase.co';
const TOKEN = 'c9'.repeat(24);
let ctx, cdp, extId, grantedId, profileDir, tmpDir, video;
const log = { push: [], mark: [], cr: [], pv: [], other: [] };
let crMode = 'ok';
const CR_SITE_DEVICE = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

function hasFfmpeg() { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } }

before(async () => {
  if (!CHROME) throw new Error('Chrome introuvable : définis CHROME_PATH');
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cinepisode-plat-'));
  /* Copie de test : permissions facultatives accordées d'avance */
  const granted = path.join(tmpDir, 'ext-granted');
  fs.cpSync(EXT, granted, { recursive: true });
  const m = JSON.parse(fs.readFileSync(path.join(granted, 'manifest.json'), 'utf8'));
  m.host_permissions = [...m.host_permissions, ...m.optional_host_permissions];
  delete m.optional_host_permissions;
  fs.writeFileSync(path.join(granted, 'manifest.json'), JSON.stringify(m));
  /* Vidéo de 50 s (VP8, minuscule) lue en x1,5 : 80 % atteint en ~27 s, avec plus de 20 s de lecture observée */
  if (hasFfmpeg()) {
    const file = path.join(tmpDir, 'v.webm');
    execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=32x18:r=2:d=50', '-c:v', 'libvpx', '-b:v', '20k', file]);
    video = fs.readFileSync(file);
  }

  const port = 9800 + Math.floor(Math.random() * 500);
  profileDir = path.join(tmpDir, 'profile');
  ctx = await chromium.launchPersistentContext(profileDir, {
    executablePath: CHROME, headless: true, viewport: { width: 1000, height: 800 },
    ignoreDefaultArgs: ['--disable-extensions'], env: { ...process.env, LANGUAGE: 'fr', LANG: 'fr_FR.UTF-8' },
    args: ['--headless=new', '--enable-unsafe-extension-debugging', '--remote-debugging-port=' + port, '--autoplay-policy=no-user-gesture-required', '--lang=fr'],
  });
  cdp = await chromium.connectOverCDP('http://127.0.0.1:' + port);
  const session = await cdp.newBrowserCDPSession();
  extId = (await session.send('Extensions.loadUnpacked', { path: EXT })).id;
  grantedId = (await session.send('Extensions.loadUnpacked', { path: granted })).id;

  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: typeof body === 'string' ? body : JSON.stringify(body) });
  await ctx.route(SUPA + '/**', async route => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    const body = JSON.parse(req.postData() || '{}');
    if (req.url().endsWith('/rpc/extension_push_detections')) {
      log.push.push(body);
      return json(route, { status: 'ok', inserted: body.p_items.length, updated: 0, unchanged: 0, invalid: 0 });
    }
    if (req.url().endsWith('/rpc/mark_watched_by_title')) {
      log.mark.push(body);
      return json(route, { status: 'not_found', title: body.p_title, season: body.p_season, episode: body.p_episode });
    }
    log.other.push(req.url());
    return json(route, {});
  });
  /* crunchyroll.com simulé : accueil, jeton, historique (2 pages), page /watch/ et lecteur (iframe) */
  await ctx.route(/^https:\/\/(www|static)\.crunchyroll\.com\//, async route => {
    const req = route.request();
    const u = new URL(req.url());
    log.cr.push({ url: req.url(), method: req.method(), headers: req.headers(), body: req.postData() });
    if (u.pathname === '/' && req.method() === 'GET') return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>Crunchyroll</title><p>Accueil</p>' });
    if (u.pathname === '/auth/v1/token') {
      if (crMode === 'challenge') return route.fulfill({ status: 403, contentType: 'text/html', headers: { 'cf-mitigated': 'challenge' }, body: '<!doctype html><title>Just a moment...</title><div id="challenge-platform"></div>' });
      return json(route, { access_token: 'cr-at', account_id: 'acc-123', expires_in: 300, token_type: 'Bearer' });
    }
    if (u.pathname === '/content/v2/acc-123/watch-history') {
      if (req.headers().authorization !== 'Bearer cr-at') return json(route, { error: 'unauthorized' }, 401);
      if (crMode === 'cursor') {
        /* 0.6.2 : curseur opaque dans meta.next_page ; numéro de page > 1 refusé (400), comme l'API réelle ;
           le 3e curseur est refusé aussi, pour vérifier l'import partiel */
        const pg = u.searchParams.get('page');
        const invalid = { code: 'content.get_watch_history_v2.format_validation_error', context: [{ code: 'content.get_watch_history_v2.invalid_value', field: 'page' }] };
        if (pg === '1') return json(route, crCursorPage(0, 'CUR2'));
        if (pg === 'CUR2') return json(route, crCursorPage(100, 'CUR3'));
        return json(route, invalid, 400);
      }
      return json(route, fixture(u.searchParams.get('page') === '1' ? 'crunchyroll-history-p1.json' : 'crunchyroll-history-p2.json'));
    }
    if (u.pathname.startsWith('/fr/watch/')) {
      const ld = { '@context': 'https://schema.org', '@type': 'TVEpisode', url: 'https://www.crunchyroll.com/fr/watch/GRDQPM1ZY/hidden-inventory', name: 'Hidden Inventory',
        episodeNumber: '5', partOfSeason: { '@type': 'TVSeason', seasonNumber: 2 }, partOfSeries: { '@type': 'TVSeries', name: 'JUJUTSU KAISEN' } };
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Crunchyroll</title><script type="application/ld+json">' + JSON.stringify(ld)
        + '</script><h1>E5 - Hidden Inventory</h1><iframe src="https://static.crunchyroll.com/vilos-v2/web/vilos/player.html" width="320" height="180" allow="autoplay"></iframe>' });
    }
    if (u.pathname === '/vilos-v2/web/vilos/player.html') return route.fulfill({ status: 200, contentType: 'text/html',
      body: '<!doctype html><video id="player0" src="https://static.crunchyroll.com/v.webm" muted autoplay></video><script>document.querySelector("video").playbackRate=1.5;</script>' });
    if (u.pathname === '/v.webm' && video) return route.fulfill({ status: 200, contentType: 'video/webm', body: video });
    return route.fulfill({ status: 404, body: '' });
  });
  /* primevideo.com simulé : région, historique (2 pages), pourcentages, fiches, page de lecture */
  const items = fixture('prime-items.json');
  const enrich = fixture('prime-enrich.json').enrichments;
  await ctx.route(/^https:\/\/(www|atv-ps|atv-ps-eu|atv-ps-fe)\.primevideo\.com\//, async route => {
    const req = route.request();
    const u = new URL(req.url());
    log.pv.push({ url: req.url(), headers: req.headers() });
    if (u.pathname.endsWith('/GetAppStartupConfig')) return json(route, { customerConfig: { homeRegion: 'EU' }, territoryConfig: { defaultVideoWebsite: 'https://www.amazon.fr' } });
    if (u.pathname === '/region/eu/api/getWatchHistorySettingsPage') {
      const args = JSON.parse(u.searchParams.get('widgetArgs'));
      return json(route, fixture(args.nextToken ? 'prime-history-p2.json' : 'prime-history-p1.json'));
    }
    if (u.pathname === '/region/eu/api/enrichItemMetadata') {
      const ids = JSON.parse(u.searchParams.get('titleIDsToEnrich'));
      return json(route, { enrichments: Object.fromEntries(ids.filter(i => enrich[i]).map(i => [i, enrich[i]])) });
    }
    if (u.pathname === '/cdp/catalog/GetPlaybackResources') {
      const it = items[u.searchParams.get('asin')];
      return it ? json(route, it) : json(route, { error: 'not found' }, 404);
    }
    if (u.pathname.startsWith('/detail/')) return route.fulfill({ status: 200, contentType: 'text/html', body:
      '<!doctype html><meta charset="utf-8"><title>Prime Video</title><div id="dv-web-player"><video src="https://www.primevideo.com/v.webm" muted autoplay></video>'
      + '<div class="atvwebplayersdk-title-text">The Boys</div><div class="atvwebplayersdk-subtitle-text">Saison 4, ép. 3 Ombres de Washington</div></div>'
      + '<script>document.querySelector("video").playbackRate=1.5;</script>' });
    if (u.pathname === '/v.webm' && video) return route.fulfill({ status: 200, contentType: 'video/webm', body: video });
    return route.fulfill({ status: 404, body: '' });
  });
  await ctx.route('https://cinepisode.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Cinepisode</title>' }));
});
after(async () => { await cdp?.close().catch(() => {}); await ctx?.close(); fs.rmSync(tmpDir, { recursive: true, force: true }); });

/* Page d'historique de 100 éléments finis (une série chacun) et son curseur suivant */
function crCursorPage(from, next) {
  const data = Array.from({ length: 100 }, (_, i) => {
    const n = from + i;
    return { panel: { id: 'E' + n, type: 'episode', title: 'Ep', episode_metadata: { series_id: 'S' + n, series_title: 'Série ' + n, season_number: 1, episode_number: 1, duration_ms: 1440000 } },
      parent_id: 'S' + n, parent_type: 'series', id: 'E' + n, date_played: new Date(Date.parse('2026-10-01T00:00:00Z') - n * 60000).toISOString(), playhead: 1440, fully_watched: true };
  });
  return { total: 1500, data, meta: { prev_page: '', next_page: '/content/v2/acc-123/watch-history?page=' + next + '&page_size=100&locale=fr-FR' } };
}

async function optionsPage(id) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.goto('chrome-extension://' + id + '/options.html');
  await page.evaluate(t => new Promise(r => chrome.storage.local.set({ wlToken: t }, r)), TOKEN);
  await page.evaluate(() => new Promise(r => chrome.storage.local.remove(['wlImport', 'wlImportMeta'], r)));
  await page.reload();
  return { page, errors };
}
const box = (page, name) => page.locator('.platform[data-platform="' + name + '"]');
async function closeDetectedTabs() { for (const p of ctx.pages()) if (p.url().startsWith('https://cinepisode.com/')) await p.close(); }

test('extension publiée : plateformes désactivées, aucun accès aux sites, import refusé clairement', async () => {
  const { page, errors } = await optionsPage(extId);
  const manifest = await page.evaluate(() => chrome.runtime.getManifest());
  assert.equal(manifest.version, '0.6.2');
  assert.deepEqual(manifest.host_permissions, [SUPA + '/*', 'https://www.netflix.com/*'], 'avertissement à l\'installation inchangé');
  await page.waitForFunction(() => !document.querySelector('.platform[data-platform="crunchyroll"] [data-role="enable"]').hidden);
  assert.equal(await box(page, 'crunchyroll').locator('[data-role="enable"]').textContent(), 'Activer Crunchyroll');
  assert.equal(await box(page, 'prime').locator('[data-role="enable"]').textContent(), 'Activer Prime Video');
  assert.equal(await box(page, 'crunchyroll').locator('[data-role="import"]').isHidden(), true);
  assert.deepEqual(await page.evaluate(() => chrome.scripting.getRegisteredContentScripts()), [], 'aucun script sur Crunchyroll / Prime Video');
  const before = log.cr.length;
  await page.evaluate(() => chrome.runtime.sendMessage({ type: 'wl_import_crunchyroll' }));
  await page.waitForFunction(() => document.querySelector('#importStatus').className === 'err');
  assert.match(await page.textContent('#importStatus'), /Active d'abord la plateforme/);
  assert.equal(log.cr.length, before, 'aucune requête vers Crunchyroll');
  assert.deepEqual(errors, []);
  await page.close();
});

test('plateformes activées : scripts en direct enregistrés ; import Crunchyroll -> détections « crunchyroll »', async () => {
  log.push.length = 0;
  /* Cookie device_id posé par le site (non HttpOnly, lisible par la page) */
  await ctx.addCookies([{ name: 'device_id', value: CR_SITE_DEVICE, domain: 'www.crunchyroll.com', path: '/', secure: true, sameSite: 'Lax' }]);
  /* Onglet www.crunchyroll.com déjà ouvert (site simulé) : l'import s'en sert. L'ouverture d'un onglet
     en arrière-plan quand il n'y en a pas est vérifiée par tests/extension-platforms.test.js. */
  const crTab = await ctx.newPage();
  await crTab.goto('https://www.crunchyroll.com/');
  const { page, errors } = await optionsPage(grantedId);
  await page.waitForFunction(async () => (await chrome.scripting.getRegisteredContentScripts()).length === 3);
  const ids = (await page.evaluate(() => chrome.scripting.getRegisteredContentScripts())).map(c => c.id).sort();
  assert.deepEqual(ids, ['cp-crunchyroll-page', 'cp-crunchyroll-player', 'cp-prime-page']);
  await page.waitForFunction(() => !document.querySelector('.platform[data-platform="crunchyroll"] [data-role="import"]').hidden);
  await box(page, 'crunchyroll').locator('[data-role="import"]').click();
  await page.waitForFunction(() => document.querySelector('#importStatus').className === 'ok');
  assert.match(await page.textContent('#importStatus'), /^3 titres envoyés/);
  const tok = log.cr.find(r => r.url.includes('/auth/v1/token?_='));
  assert.equal(tok.method, 'POST');
  assert.match(tok.headers.authorization, /^Basic /);
  assert.equal(tok.body.split('&')[0], 'grant_type=etp_rt_cookie');
  assert.ok(tok.body.includes('device_id=' + CR_SITE_DEVICE + '&'), 'même identifiant d\'appareil que le site');
  assert.ok(!/scope=/.test(tok.body));
  // Requêtes faites depuis l'onglet du site (même origine), pas depuis le service worker
  assert.equal(tok.headers.origin, 'https://www.crunchyroll.com');
  assert.ok(log.cr.filter(r => /watch-history/.test(r.url)).every(r => !r.headers.origin || r.headers.origin === 'https://www.crunchyroll.com'));
  assert.ok(!log.cr.some(r => /cdn-cgi/.test(r.url)), 'site simulé seulement');
  assert.equal(crTab.isClosed(), false, 'onglet de l\'utilisateur jamais fermé');
  await crTab.close();
  assert.equal(log.push.length, 1);
  assert.deepEqual(log.push[0].p_items.map(i => [i.source, i.title, i.type, i.season, i.episode, i.progress_pct]), [
    ['crunchyroll', 'JUJUTSU KAISEN', 'show', 2, 5, 100], ['crunchyroll', 'JUJUTSU KAISEN 0', 'movie', null, null, 100], ['crunchyroll', 'SPY x FAMILY', 'show', 2, 12, 81]]);
  assert.equal(log.push[0].p_token, TOKEN);
  await closeDetectedTabs();
  assert.deepEqual(errors, []);
  await page.close();
});

test('Crunchyroll bloqué par Cloudflare : étape et statut affichés, « Copier le diagnostic » sans jeton', async () => {
  crMode = 'challenge';
  const crTab = await ctx.newPage();
  try {
    await crTab.goto('https://www.crunchyroll.com/');
    const { page, errors } = await optionsPage(grantedId);
    await page.waitForFunction(() => !document.querySelector('.platform[data-platform="crunchyroll"] [data-role="import"]').hidden);
    await box(page, 'crunchyroll').locator('[data-role="import"]').click();
    await page.waitForFunction(() => document.querySelector('#importStatus').className === 'err');
    const text = await page.textContent('#importStatus');
    assert.match(text, /Cloudflare/);
    assert.match(text, /Étape jeton : HTTP 403\./);
    const st = await page.evaluate(() => new Promise(r => chrome.storage.local.get(['wlImport'], x => r(x.wlImport))));
    assert.deepEqual([st.error, st.errStep, st.errStatus, st.diag.cloudflare, st.diag.via], ['crunchyroll_blocked', 'token', 403, true, 'tab']);
    assert.ok(!/cr-at|acc-123|device_id|[0-9a-f]{8}-[0-9a-f]{4}-/.test(JSON.stringify(st.diag)), 'diagnostic sans jeton ni identifiant');
    await page.evaluate(() => { window.__copied = null; navigator.clipboard.writeText = t => { window.__copied = t; return Promise.resolve(); }; });
    await page.click('#importStatus button.diag');
    await page.waitForFunction(() => window.__copied);
    const copied = await page.evaluate(() => window.__copied);
    assert.match(copied, /step: token/);
    assert.match(copied, /status: 403/);
    assert.match(copied, /cloudflare: true/);
    assert.match(copied, /v: 0\.6\.2/);
    assert.match(await page.textContent('#importStatus button.diag'), /Diagnostic copié/);
    assert.deepEqual(errors, []);
    await page.close();
  } finally { crMode = 'ok'; await crTab.close(); }
});

test('Crunchyroll 0.6.2 : curseur meta.next_page suivi ; page refusée ensuite -> début envoyé, note et diagnostic', async () => {
  crMode = 'cursor';
  log.push.length = 0;
  const before = log.cr.length;
  const crTab = await ctx.newPage();
  try {
    await crTab.goto('https://www.crunchyroll.com/');
    const { page, errors } = await optionsPage(grantedId);
    await page.waitForFunction(() => !document.querySelector('.platform[data-platform="crunchyroll"] [data-role="import"]').hidden);
    await box(page, 'crunchyroll').locator('[data-role="import"]').click();
    await page.waitForFunction(() => document.querySelector('#importStatus').className === 'ok', null, { timeout: 20000 });
    const text = await page.textContent('#importStatus');
    assert.match(text, /^200 titres envoyés/);
    assert.match(text, /L'historique le plus ancien n'a pas pu être lu/);
    const pages = log.cr.slice(before).filter(r => /watch-history/.test(r.url)).map(r => new URL(r.url).searchParams.get('page'));
    assert.deepEqual(pages, ['1', 'CUR2', 'CUR3'], 'curseurs suivis, jamais page=2');
    assert.equal(log.push.length, 1);
    assert.equal(log.push[0].p_items.length, 200, 'les 2 pages lues sont envoyées');
    const st = await page.evaluate(() => new Promise(r => chrome.storage.local.get(['wlImport', 'wlImportMeta'], x => r(x))));
    assert.deepEqual([st.wlImport.state, st.wlImport.partial, st.wlImport.diag.partial, st.wlImport.diag.page, st.wlImport.diag.status], ['done', true, true, 3, 400]);
    assert.equal(st.wlImportMeta.crunchyrollLastMs, undefined, 'date non avancée : le prochain import relit tout');
    await page.evaluate(() => { window.__copied = null; navigator.clipboard.writeText = t => { window.__copied = t; return Promise.resolve(); }; });
    await page.click('#importStatus button.diag');
    await page.waitForFunction(() => window.__copied);
    const copied = await page.evaluate(() => window.__copied);
    assert.match(copied, /partial: true/);
    assert.match(copied, /page: 3/);
    assert.doesNotMatch(copied, /cr-at|acc-123/);
    await closeDetectedTabs();
    assert.deepEqual(errors, []);
    await page.close();
  } finally { crMode = 'ok'; await crTab.close(); }
});

test('plateformes activées : import Prime Video (région EU, bandes-annonces et lectures courtes écartées)', async () => {
  log.push.length = 0;
  log.pv.length = 0;
  const { page, errors } = await optionsPage(grantedId);
  await page.waitForFunction(() => !document.querySelector('.platform[data-platform="prime"] [data-role="import"]').hidden);
  await box(page, 'prime').locator('[data-role="import"]').click();
  await page.waitForFunction(() => document.querySelector('#importStatus').className === 'ok', null, { timeout: 20000 });
  assert.match(await page.textContent('#importStatus'), /^4 titres envoyés/);
  assert.deepEqual(log.push[0].p_items.map(i => [i.source, i.title, i.type, i.season, i.episode]), [
    ['prime', 'The Boys', 'show', 4, 3], ['prime', 'Reacher', 'show', 2, 8], ['prime', 'Fallout', 'show', 1, 1], ['prime', 'Anatomie d\'une chute', 'movie', null, null]]);
  const hist = log.pv.filter(r => /getWatchHistorySettingsPage/.test(r.url));
  assert.equal(hist.length, 2);
  assert.equal(hist[0].headers['x-requested-with'], 'XMLHttpRequest');
  const asins = log.pv.filter(r => /GetPlaybackResources/.test(r.url)).map(r => new URL(r.url).searchParams.get('asin'));
  assert.ok(!asins.includes('amzn1.dv.gti.saltburn') && !asins.includes('amzn1.dv.gti.boys-s4e4'), 'pas de fiche pour les lectures courtes');
  await closeDetectedTabs();
  assert.deepEqual(errors, []);
  await page.close();
});

test('plateformes activées : détection en direct sur Prime Video (texte français) et Crunchyroll (vidéo dans l\'iframe)', { skip: !hasFfmpeg() && 'ffmpeg absent' }, async () => {
  log.mark.length = 0;
  log.push.length = 0;
  const pvPage = await ctx.newPage();
  const crPage = await ctx.newPage();
  await pvPage.goto('https://www.primevideo.com/detail/0ABCDEF/');
  await crPage.goto('https://www.crunchyroll.com/fr/watch/GRDQPM1ZY/hidden-inventory');
  for (let i = 0; i < 120 && log.mark.length < 2; i++) await new Promise(r => setTimeout(r, 500));
  const marks = log.mark.map(b => [b.p_title, b.p_season, b.p_episode, b.p_type]).sort();
  assert.deepEqual(marks, [['JUJUTSU KAISEN', 2, 5, 'episode'], ['The Boys', 4, 3, 'episode']]);
  for (let i = 0; i < 20 && log.push.length < 2; i++) await new Promise(r => setTimeout(r, 200));
  assert.deepEqual(log.push.map(b => b.p_items[0].source), ['live', 'live'], 'pas dans la liste : envoyé à l\'onglet « Détectés »');
  await pvPage.close();
  await crPage.close();
});
