/* Appairage de bout en bout (extension 0.8.0), dans un vrai Chrome : fenêtre de l'extension non reliée ->
   « Se connecter avec Cinepisode » -> page d'appairage du site (servie localement sous https://cinepisode.com,
   CSP de prod) -> connexion -> « Autoriser cet appareil » -> jeton remis à l'extension par
   chrome.runtime.sendMessage (externally_connectable) -> extension connectée ; puis retrait depuis
   « Appareils connectés » -> l'extension repasse en « non reliée ». Supabase simulé.
   Captures : PAIRING_SHOTS=<dossier> (facultatif). Lancer : cd e2e && npm test */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { startServer } from './server.mjs';
import { installFakeSupabase } from './fake-supabase.mjs';

const CHROME = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'extension');
const SUPA = 'https://batfulcvvquffgfeppcx.supabase.co';
const SHOTS = process.env.PAIRING_SHOTS || '';
let ctx, cdp, extId, profileDir, server, db;
const dev = { devices: [], whoami: [], unpair: [] };
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }); };

before(async () => {
  if (!CHROME) throw new Error('Chrome introuvable : définis CHROME_PATH');
  server = await startServer();
  const port = 9800 + Math.floor(Math.random() * 500);
  profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cinepisode-pair-'));
  ctx = await chromium.launchPersistentContext(profileDir, {
    executablePath: CHROME, headless: true, viewport: { width: 1280, height: 860 }, locale: 'fr-FR',
    ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--headless=new', '--lang=fr', '--enable-unsafe-extension-debugging', '--remote-debugging-port=' + port],
  });
  cdp = await chromium.connectOverCDP('http://127.0.0.1:' + port);
  extId = (await (await cdp.newBrowserCDPSession()).send('Extensions.loadUnpacked', { path: EXT })).id;
  /* Le site, servi par le serveur de test, sous sa vraie adresse (externally_connectable du manifeste) */
  await ctx.route('https://cinepisode.com/**', async route => {
    const u = new URL(route.request().url());
    const r = await fetch(server.url + u.pathname + u.search);
    const headers = Object.fromEntries(r.headers);
    delete headers['content-length']; delete headers['transfer-encoding']; delete headers['connection'];
    route.fulfill({ status: r.status, headers, body: Buffer.from(await r.arrayBuffer()) });
  });
  db = await installFakeSupabase(ctx);
  db.profiles.push({ id: 'p-11111111-1111-4111-8111-111111111111', account_id: '11111111-1111-4111-8111-111111111111', name: 'Pierre' });
  dev.devices.push({ id: '0b0b0b0b-0000-4000-8000-000000000002', label: 'Edge · macOS', ext_version: '0.7.3',
    created_at: '2026-10-02T09:00:00Z', last_seen_at: new Date(Date.now() - 4 * 864e5).toISOString(), revoked_at: null, token: null });
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'x-supabase-api-version', 'x-supabase-api-version': '2024-01-01' }, body: JSON.stringify(body) });
  /* Fonctions de la migration 20261013120000_appairage_appareils.sql (comportement simulé) */
  await ctx.route(SUPA + '/rest/v1/**', async route => {
    const req = route.request(), p = new URL(req.url()).pathname;
    if (req.method() === 'OPTIONS') return route.fallback();
    const body = (() => { try { return JSON.parse(req.postData() || '{}'); } catch { return {}; } })();
    const authed = /Bearer ey/.test(req.headers().authorization || '') && !(req.headers().authorization || '').includes(req.headers().apikey || '@@');
    if (p === '/rest/v1/rpc/pair_extension_device') {
      if (!authed) return json(route, { status: 'not_authenticated' });
      const token = 'cpd_' + [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join('');
      const d = { id: crypto.randomUUID(), label: body.p_label, ext_version: body.p_ext_version, created_at: new Date().toISOString(), last_seen_at: null, revoked_at: null, token };
      dev.devices.unshift(d);
      return json(route, { status: 'ok', device_id: d.id, token });
    }
    if (p === '/rest/v1/rpc/extension_whoami') {
      dev.whoami.push(body.p_token);
      const d = dev.devices.find(x => x.token && x.token === body.p_token && !x.revoked_at);
      if (d) d.last_seen_at = new Date().toISOString();
      return json(route, d ? { status: 'ok', profile: 'Pierre' } : { status: 'invalid_token' });
    }
    if (p === '/rest/v1/rpc/revoke_extension_device') {
      const d = dev.devices.find(x => x.id === body.p_device_id && !x.revoked_at);
      if (d) d.revoked_at = new Date().toISOString();
      return json(route, { status: d ? 'revoked' : 'not_found' });
    }
    if (p === '/rest/v1/rpc/extension_unpair') { dev.unpair.push(body.p_token); return json(route, { status: 'revoked' }); }
    if (p === '/rest/v1/extension_devices') return json(route, dev.devices.map(({ token, ...d }) => d));
    return route.fallback();
  });
});
after(async () => { await cdp?.close().catch(() => {}); await ctx?.close(); await server?.close(); fs.rmSync(profileDir, { recursive: true, force: true }); });

const extStorage = page => page.evaluate(() => new Promise(r => chrome.storage.local.get(null, r)));

test('appairage : extension -> site -> « Autoriser cet appareil » -> jeton remis à l\'extension, puis retrait', async () => {
  const errors = [];
  let popup = await ctx.newPage();
  await popup.setViewportSize({ width: 360, height: 600 });
  popup.on('pageerror', e => errors.push('popup: ' + e.message));
  await popup.goto('chrome-extension://' + extId + '/options.html');
  await popup.locator('#viewOff').waitFor();
  await popup.waitForTimeout(700);
  await shot(popup, '01-extension-non-reliee');

  const [site] = await Promise.all([ctx.waitForEvent('page'), popup.click('#pairBtn').catch(() => {})]);
  site.on('pageerror', e => errors.push('site: ' + e.message));
  await site.waitForLoadState('domcontentloaded');
  /* Onglet ouvert par l'extension (chrome.tabs.create) : rechargé par Playwright pour passer par le site local */
  await site.goto(site.url());
  const u = new URL(site.url());
  assert.equal(u.origin + u.pathname, 'https://cinepisode.com/');
  assert.equal(u.searchParams.get('pair'), '1');
  assert.equal(u.searchParams.get('ext'), extId);
  assert.equal(u.searchParams.get('v'), '0.8.0');
  assert.ok(!/token|cpd_/.test(site.url()), 'aucun jeton dans l\'adresse');

  await site.locator('#pairPage .pair-card h1').filter({ hasText: 'Connecte-toi' }).waitFor();
  await site.waitForTimeout(800);
  await shot(site, '02-site-connexion');
  await site.click('#pairPage .pair-btn');
  await site.fill('#authEmail', 'pierre@exemple.fr');
  await site.fill('#authPassword', 'Correct-Horse-42');
  await site.click('.auth-submit');
  await site.locator('#authViewTitle').filter({ hasText: 'Mon compte' }).waitFor();
  await site.evaluate(() => closeAuthModal());
  await site.locator('#pairPage h1').filter({ hasText: 'Autoriser l\'extension' }).waitFor();
  /* Extension non officielle (chargée en développement) : confirmation explicite obligatoire */
  assert.equal(await site.locator('#pairGo').isDisabled(), true, 'bouton bloqué tant que l\'extension inconnue n\'est pas confirmée');
  assert.match(await site.locator('.pair-warn').textContent(), new RegExp(extId));
  await site.check('#pairAck');
  assert.equal(await site.locator('#pairGo').isDisabled(), false);
  await site.waitForTimeout(600);
  await shot(site, '03-site-autoriser');
  await site.click('#pairGo');
  await site.locator('#pairPage h1').filter({ hasText: 'C\'est relié' }).waitFor({ timeout: 8000 });
  await site.locator('.dev-row').first().waitFor();
  await site.waitForTimeout(900);
  await shot(site, '04-site-relie-appareils');
  assert.equal(await site.locator('#toastWrap').isVisible(), false, 'aucune notification de l\'app par-dessus la page d\'appairage');

  /* L'extension a reçu un jeton d'appareil valide, vérifié auprès du serveur (la fenêtre s'est fermée au clic) */
  assert.ok(popup.isClosed(), 'la fenêtre de l\'extension se ferme en ouvrant le site');
  popup = await ctx.newPage();
  await popup.setViewportSize({ width: 360, height: 600 });
  popup.on('pageerror', e => errors.push('popup: ' + e.message));
  await popup.goto('chrome-extension://' + extId + '/options.html');
  const mine = dev.devices[0];
  const st = await extStorage(popup);
  assert.equal(st.wlToken, mine.token);
  assert.match(st.wlToken, /^cpd_[0-9a-f]{64}$/);
  assert.equal(st.wlDeviceId, mine.id);
  assert.ok(dev.whoami.includes(mine.token), 'jeton vérifié par extension_whoami avant enregistrement');
  assert.equal(await site.evaluate(() => localStorage.getItem('cp_device_id')), mine.id);
  assert.ok(!(await site.evaluate(() => JSON.stringify(localStorage))).includes(mine.token), 'le site ne garde pas le jeton');
  assert.equal(await site.locator('.dev-row').first().locator('.dev-tag').textContent(), 'Cet appareil');
  assert.equal(await site.locator('.dev-row').count(), 2);

  await popup.reload();
  await popup.locator('#viewMain').waitFor();
  await popup.waitForTimeout(700);
  await shot(popup, '05-extension-connectee');

  /* Un message d'une autre origine est refusé par l'extension */
  const forged = await ctx.newPage();
  await forged.route('https://evil.example/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><p>x</p>' }));
  await forged.goto('https://evil.example/');
  assert.equal(await forged.evaluate(() => !!(window.chrome && chrome.runtime && chrome.runtime.sendMessage)), false, 'extension injoignable hors du site');
  await forged.close();

  /* Retrait depuis le site -> l'extension constate le retrait à l'ouverture */
  await site.locator('.dev-row').first().locator('.dev-btn').click();
  await site.locator('.dev-confirm').waitFor();
  await site.waitForTimeout(400);
  await shot(site, '06-site-retirer-confirmation');
  await site.locator('.dev-confirm .dev-btn').click();
  await site.locator('.dev-row.revoked').first().waitFor();
  assert.ok(mine.revoked_at);
  await site.waitForTimeout(600);
  await shot(site, '07-site-appareil-retire');

  await popup.reload();
  await popup.locator('#viewOff').waitFor({ timeout: 8000 });
  await popup.locator('#status').filter({ hasText: 'retiré' }).waitFor();
  assert.equal((await extStorage(popup)).wlToken, undefined);
  await popup.waitForTimeout(500);
  await shot(popup, '08-extension-retiree');
  assert.deepEqual(errors, []);
  await site.close();
});

test('appairage : déconnexion depuis l\'extension -> jeton révoqué côté serveur (extension_unpair)', async () => {
  const popup = await ctx.newPage();
  await popup.goto('chrome-extension://' + extId + '/options.html');
  const tok = 'cpd_' + 'ab'.repeat(32);
  await popup.evaluate(t => new Promise(r => chrome.storage.local.set({ wlToken: t }, r)), tok);
  dev.devices.push({ id: crypto.randomUUID(), label: 'X', token: tok, created_at: new Date().toISOString(), revoked_at: null });
  await popup.reload();
  await popup.locator('#viewMain').waitFor();
  await popup.click('#openSettings');
  await popup.click('#logout');
  await popup.click('#logoutYes');
  await popup.locator('#viewOff').waitFor();
  assert.ok(dev.unpair.includes(tok));
  assert.equal((await extStorage(popup)).wlToken, undefined);
  await popup.close();
});

test('page d\'appairage sans identifiant d\'extension, téléphone, et fenêtre d\'accueil après inscription', async () => {
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('https://cinepisode.com/?pair=1');
  await page.locator('#pairPage h1').filter({ hasText: 'Lien incomplet' }).waitFor();
  await page.goto('https://cinepisode.com/?pair=1&ext=' + extId + '&v=0.8.0');
  await page.locator('#pairPage h1').filter({ hasText: 'Autoriser' }).waitFor();
  await page.check('#pairAck');
  await page.waitForTimeout(800);
  await shot(page, '09-mobile-autoriser');

  /* Fenêtre d'accueil : seulement pour un compte tout juste créé, et une seule fois */
  await page.goto('https://cinepisode.com/');
  await page.waitForFunction(() => typeof maybeShowOnboarding === 'function');
  const shown = await page.evaluate(() => {
    var old = { id: 'u-old', created_at: '2026-01-01T00:00:00Z' };
    maybeShowOnboarding(old);
    var r1 = !!document.getElementById('onbMbk');
    var fresh = { id: 'u-new-' + Date.now(), created_at: new Date().toISOString() };
    maybeShowOnboarding(fresh);
    var r2 = !!document.getElementById('onbMbk');
    onbClose();
    return [r1, r2, fresh.id];
  });
  assert.deepEqual(shown.slice(0, 2), [false, true]);
  await page.waitForTimeout(400);
  await page.evaluate(id => maybeShowOnboarding({ id, created_at: new Date().toISOString() }), shown[2]);
  assert.equal(await page.locator('#onbMbk').count(), 0, 'une seule fois par compte');
  await page.evaluate(() => showOnboarding());
  await page.waitForTimeout(1200);
  await shot(page, '10-mobile-accueil');
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.waitForTimeout(300);
  await shot(page, '11-accueil');
  await page.keyboard.press('Escape');
  await page.locator('#onbMbk').waitFor({ state: 'detached' });
  assert.deepEqual(errors, []);
  await page.close();
});
