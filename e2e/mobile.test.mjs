/* Affichage mobile (audit du 8 octobre 2026) et synchro sans rechargement visuel de la grille.
   Téléphones émulés (tactile, isMobile) sous la CSP de production, Supabase et TMDB simulés.
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

before(async () => {
  if (!CHROME) throw new Error('Chrome introuvable : définis CHROME_PATH');
  browser = await chromium.launch({ executablePath: CHROME, headless: true });
  server = await startServer();
});
after(async () => { await browser?.close(); await server?.close(); });

let n = 0;
const item = (o) => ({ id: 'srv-' + (++n), local_id: 'l-' + n, profile_id: 'p-' + ME, tmdb_id: 1000 + n, tmdb_type: 'tv', type: 'serie', status: 'avoir',
  title: 'Titre ' + n, year: '2020', poster_path: '/p' + n + '.jpg', tmdb_score: 7.5, my_rating: 0, overview: '', tags: [], saison: null, episode: null,
  total_ep: null, anime_genre: '', deleted: false, updated_at: '2026-10-01T10:00:00Z', added_at: '2026-09-' + String(1 + (n % 28)).padStart(2, '0') + 'T10:00:00Z', ...o });
function items() {
  n = 0;
  return [
    item({ title: 'Breaking Bad', status: 'encours', saison: 2, episode: 3, total_ep: 62 }),
    item({ title: 'Dark', status: 'encours', saison: 1, episode: 4, total_ep: 26 }),
    item({ title: 'Inception', type: 'film', tmdb_type: 'movie', status: 'termine' }),
    ...Array.from({ length: 12 }, (_, i) => item({ title: 'Série numéro ' + (i + 1) + ' avec un titre assez long' })),
    ...Array.from({ length: 6 }, (_, i) => item({ title: 'Film ' + (i + 1), type: 'film', tmdb_type: 'movie', status: i % 2 ? 'termine' : 'avoir' })),
  ];
}
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="342" height="513"><rect width="342" height="513" fill="#345"/></svg>';
const PHONES = {
  m360: { width: 360, height: 740 },
  m390: { width: 390, height: 844 },
  m412: { width: 412, height: 915 },
  land: { width: 844, height: 390 },
};

async function newPage(t, { vp = 'm390', logged = true, mobile = true } = {}) {
  server.config = { turnstileSiteKey: '', signupsOpen: true };
  const ctx = await browser.newContext({ locale: 'fr-FR', viewport: PHONES[vp] || vp, ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', m => { const x = m.text(); if (m.type() === 'error' && !/^Failed to load resource: the server responded with a status of (4\d\d)/.test(x)) problems.push(x); if (/Content Security Policy/i.test(x)) problems.push(x); });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  page.on('dialog', d => d.accept());
  const db = await installFakeSupabase(page, { items: logged ? items() : [] });
  await page.route(u => u.pathname === '/api/tmdb', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"results":[],"page":1,"total_pages":1}' }));
  await page.route(u => /^\/api\/(omdb|releases)/.test(u.pathname), r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route(/kitsu\.(io|app)|api\.tvmaze\.com/, r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"data":[]}' }));
  await page.route('https://image.tmdb.org/**', r => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: SVG }));
  t.after(() => ctx.close());
  await page.goto(server.url + '/');
  await page.waitForFunction(() => typeof render === 'function' && typeof memDB !== 'undefined');
  if (logged) {
    await page.click('#syncStatusPill');
    await page.fill('#authEmail', 'pierre@exemple.fr');
    await page.fill('#authPassword', 'Correct-Horse-42');
    await page.click('.auth-submit');
    await page.locator('#authViewTitle').filter({ hasText: 'Mon compte' }).waitFor();
    await page.click('#authMbk .auth-close');
    await page.waitForFunction(() => memDB.filter(i => !i.deleted).length >= 20 && !syncInProgress);
    await page.locator('#mc .card').first().waitFor();
  }
  return { page, db, problems };
}
/* Largeur de mise en page : innerWidth s'élargit sur mobile quand un élément dépasse */
const widths = page => page.evaluate(() => ({ inner: window.innerWidth, scroll: document.documentElement.scrollWidth }));

for (const vp of ['m360', 'm390', 'm412']) {
  test(`B1/B2 ${vp} : pas de page plus large que l'écran (filtre « En cours », recherche) et onglet « Tout » visible`, async t => {
    const { page, problems } = await newPage(t, { vp });
    const W = PHONES[vp].width;
    assert.deepEqual(await widths(page), { inner: W, scroll: W }, 'accueil');
    // « Tout » visible, dans la grille d'onglets
    const all = page.locator('.ntab[data-tab="all"]');
    assert.equal(await all.isVisible(), true, 'onglet Tout visible');
    await page.tap('.ntab[data-tab="serie"]');
    await page.tap('.csel.stat-sel-mobile .csel-btn');
    await page.locator('.csel.stat-sel-mobile.open .csel-opt', { hasText: 'En cours' }).tap();
    await page.tap('#qinput');
    await page.keyboard.type('Dark');
    await page.waitForTimeout(150);
    assert.deepEqual(await widths(page), { inner: W, scroll: W }, 'après filtre + saisie');
    // Retour à l'accueil par « Tout » (bande « En cours » de nouveau là)
    await page.fill('#qinput', '');
    await page.tap('.ntab[data-tab="all"]');
    assert.equal(await page.evaluate(() => activeTab), 'all');
    await page.locator('.ec-strip').waitFor();
    // Fenêtre de connexion / ajout : rien ne dépasse à droite
    await page.tap('.add-btn[data-click="openAdd"]');
    const box = await page.locator('#addMbk .modal-add').boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= W + 0.5, 'fenêtre d\'ajout dans l\'écran');
    assert.equal(await page.locator('#addMbk .modal-x').isVisible(), true, '× en haut de l\'ajout plein écran');
    // G2 : 16 px dans les champs (pas de zoom iOS)
    const fs16 = await page.evaluate(() => ['#qinput', '#tinput', '#fsai', '#searchModalInput'].map(s => parseFloat(getComputedStyle(document.querySelector(s)).fontSize)));
    assert.ok(fs16.every(x => x >= 16), 'champs ≥ 16 px : ' + fs16);
    // G1 : la loupe ne recouvre plus le logo
    await page.tap('#addMbk .modal-x');
    const logo = await page.locator('.hdr .logo').boundingBox(), sb = await page.locator('.hdr .search-bar').boundingBox();
    assert.ok(logo.x + logo.width <= sb.x, 'logo entier, avant la loupe');
    assert.ok(sb.width >= 44 && sb.height >= 44, 'loupe de 44 px');
    assert.deepEqual(problems, []);
  });
}

test('G3 : le menu Réglages reste ouvert (et à sa place) après Mode compact, Sons, Section Suivi repliée et Config avancée Tautulli', async t => {
  const { page, db, problems } = await newPage(t, { vp: 'm390' });
  db.profiles[0].plex_webhook_token = 'a'.repeat(48);
  await page.tap('button.hbtn[data-click="toggleMenu"]');
  await page.tap('#optMenuMain [data-click="openSettings"]');
  await page.waitForTimeout(300);
  for (const sel of ['[data-args*="toggleCompact"]', '[data-args*="toggleSound"]', '[data-args*="toggleSuiviSection"]', '[data-click="toggleWebhookAdvanced"]']) {
    const el = page.locator('#settingsBody ' + sel).first();
    await el.waitFor();
    // Le panneau peut être redessiné juste après l'ouverture (jeton webhook chargé) : on vise le nœud courant
    await page.evaluate(s => document.querySelector('#settingsBody ' + s).scrollIntoView({ block: 'center' }), sel);
    await page.waitForTimeout(100);
    const before = await page.evaluate(() => document.getElementById('optMenu').scrollTop);
    await el.tap();
    await page.waitForTimeout(150);
    const st = await page.evaluate(() => ({ open: document.getElementById('optMenu').classList.contains('on'), settings: getComputedStyle(document.getElementById('optMenuSettings')).display !== 'none', top: document.getElementById('optMenu').scrollTop }));
    assert.equal(st.open && st.settings, true, 'menu ouvert après ' + sel);
    assert.ok(Math.abs(st.top - before) < 2, 'défilement conservé après ' + sel);
  }
  // C3 : pas de raccourcis clavier ni de réglages « au survol » en tactile
  const txt = await page.locator('#settingsBody').textContent();
  assert.doesNotMatch(txt, /Raccourcis clavier|Lueur au survol|Pause au survol/);
  // Un tap en dehors ferme toujours le menu
  await page.touchscreen.tap(195, 838);
  assert.equal(await page.evaluate(() => document.getElementById('optMenu').classList.contains('on')), false);
  assert.deepEqual(problems, []);
});

test('G4/G5 : boutons de carte, × et Supprimer dans la fiche, bouton retour qui ferme la fenêtre', async t => {
  const { page, problems } = await newPage(t, { vp: 'm390' });
  await page.tap('.ntab[data-tab="serie"]');
  const card = page.locator('#mc .card', { hasText: 'Breaking Bad' });
  // Seul « épisode suivant » est affiché (et visible) ; modifier / supprimer ne sont plus touchables par erreur
  const acts = await card.evaluate(c => Array.from(c.querySelectorAll('.cact .ibtn')).map(b => ({ next: b.classList.contains('ibtn-next'), shown: getComputedStyle(b).display !== 'none' && getComputedStyle(b.parentElement).opacity === '1' })));
  assert.deepEqual(acts, [{ next: true, shown: true }, { next: false, shown: false }, { next: false, shown: false }]);
  // Fiche : bouton ×, puis « retour » du téléphone qui ferme la fiche sans quitter le site
  const url = page.url();
  await card.locator('.card-title').tap();
  await page.locator('#plexMbk.on').waitFor();
  assert.equal(await page.locator('#plexMbk .plex-close').isVisible(), true, '× visible');
  assert.equal(await page.locator('#plexActs .btn-del-plex').isVisible(), true, 'Supprimer dans la fiche');
  await page.goBack();
  await page.waitForFunction(() => !document.getElementById('plexMbk').classList.contains('on'));
  assert.equal(page.url(), url, 'toujours sur le site');
  // × puis retour : le retour ne rouvre rien et ne quitte pas la page à cause d'une entrée en trop
  await card.locator('.card-title').tap();
  await page.locator('#plexMbk.on').waitFor();
  await page.tap('#plexMbk .plex-close');
  await page.waitForFunction(() => !document.getElementById('plexMbk').classList.contains('on'));
  await page.waitForTimeout(150);
  assert.deepEqual(await page.evaluate(() => window._modalHistory.stack()), []);
  // Fiche → Modifier → retour : l'édition se ferme
  await card.locator('.card-title').tap();
  await page.locator('#plexMbk.on').waitFor();
  await page.locator('#plexActs .btn', { hasText: 'Modifier' }).tap();
  await page.locator('#addMbk.on').waitFor();
  await page.waitForTimeout(150);
  await page.goBack();
  await page.waitForFunction(() => !document.getElementById('addMbk').classList.contains('on'));
  assert.equal(page.url(), url);
  // Supprimer depuis la fiche (confirmation acceptée)
  await card.locator('.card-title').tap();
  await page.locator('#plexMbk.on').waitFor();
  await page.tap('#plexActs .btn-del-plex');
  await page.waitForFunction(() => !document.getElementById('plexMbk').classList.contains('on'));
  assert.equal(await page.locator('#mc .card', { hasText: 'Breaking Bad' }).count(), 0);
  assert.deepEqual(problems, []);
});

test('B3 : en paysage, la fiche défile d\'un bloc jusqu\'au bas (Modifier, progression)', async t => {
  const { page, problems } = await newPage(t, { vp: 'land' });
  await page.evaluate(() => openPlex(memDB.find(i => i.title === 'Dark').id));
  await page.locator('#plexMbk.on').waitFor();
  const r = await page.evaluate(() => { const w = document.querySelector('#plexMbk .plex-wrap'); w.scrollTo(0, 1e5); return { scrollable: w.scrollHeight > w.clientHeight + 100, top: w.scrollTop }; });
  assert.ok(r.scrollable && r.top > 100, 'la fiche défile');
  const btn = await page.locator('#plexNextBtn').boundingBox();
  assert.ok(btn && btn.y + btn.height <= 390, '« + Épisode suivant » atteignable');
  assert.equal(await page.locator('#plexMbk .plex-close').isVisible(), true);
  assert.deepEqual(problems, []);
});

test('C7 : filtre de statut qui suit d\'un onglet à l\'autre, expliqué avec un bouton pour l\'enlever', async t => {
  const { page, problems } = await newPage(t, { vp: 'm390' });
  await page.tap('.ntab[data-tab="anime"]');
  await page.evaluate(() => { const m = document.getElementById('statSelMobile'); m.value = 'encours'; m.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.locator('#mc .empty-clear').waitFor();
  assert.match(await page.locator('#mc .empty-state').textContent(), /Filtre actif : En cours/);
  await page.evaluate(() => { const m = document.getElementById('statSelMobile'); m.value = 'all'; m.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.tap('.ntab[data-tab="film"]');
  await page.evaluate(() => { const m = document.getElementById('statSelMobile'); m.value = 'encours'; m.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.tap('#mc .empty-clear');
  assert.equal(await page.evaluate(() => activeStat), 'all');
  assert.equal(await page.locator('.csel.stat-sel-mobile .csel-lbl').textContent(), 'Tous');
  assert.ok(await page.locator('#mc .card').count() > 0);
  assert.deepEqual(problems, []);
});

test('C4 : sur téléphone, points du bandeau masqués et glisser le doigt change de titre', async t => {
  const { page, problems } = await newPage(t, { vp: 'm360' });
  await page.locator('#heroBand.on').waitFor();
  assert.equal(await page.locator('#heroDots').isVisible(), false, 'points masqués');
  const title = () => page.locator('#heroTitle').textContent();
  const first = await title();
  const cdp = await page.context().newCDPSession(page);
  const swipe = async (x0, x1) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: 200 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: (x0 + x1) / 2, y: 202 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  await swipe(300, 80);
  await page.waitForFunction(f => document.getElementById('heroTitle').textContent !== f, first);
  await swipe(80, 300);
  await page.waitForFunction(f => document.getElementById('heroTitle').textContent === f, first);
  assert.deepEqual(problems, []);
});

test('Point 20 : une synchro sans changement ne redessine pas la grille ; un vrai changement, une seule fois et sans recharger les affiches', async t => {
  const { page, db, problems } = await newPage(t, { vp: { width: 1280, height: 900 }, mobile: false });
  await page.waitForFunction(() => Array.from(document.querySelectorAll('#mc img.card-poster')).some(i => i.complete && i.naturalWidth));
  await page.evaluate(() => {
    window.__renders = 0; const o = window.render; window.render = function () { window.__renders++; return o.apply(this, arguments); };
    window.__mut = 0; new MutationObserver(l => { window.__mut += l.length; }).observe(document.getElementById('mc'), { childList: true, subtree: true, attributes: true });
    window.__poster = document.querySelector('#mc img.card-poster');
    window.__syncDone = () => new Promise(res => { const w = () => (syncInProgress ? setTimeout(w, 30) : res()); setTimeout(w, 30); });
  });
  // Synchro « à vide » (cas du polling de 30 s)
  await page.evaluate(async () => { syncNow(); await window.__syncDone(); });
  assert.deepEqual(await page.evaluate(() => ({ r: window.__renders, m: window.__mut })), { r: 0, m: 0 }, 'aucun rendu, aucun nœud de la grille touché');
  // Changement distant : Dark passe à S01E05
  const dark = db.items.find(x => x.title === 'Dark');
  dark.episode = 5; dark.updated_at = new Date(Date.now() + 60000).toISOString();
  await page.evaluate(async () => { window.__renders = 0; syncNow(); await window.__syncDone(); });
  const after1 = await page.evaluate(() => ({ r: window.__renders, sameNode: document.contains(window.__poster), anim: getComputedStyle(document.querySelector('#mc .card')).animationName, txt: document.querySelector('#mc').textContent.includes('S01 E05') }));
  assert.equal(after1.r, 1, 'un seul rendu pour la synchro');
  assert.equal(after1.txt, true, 'nouvelle progression affichée');
  assert.equal(after1.sameNode, true, 'affiche déjà chargée réutilisée (pas de clignotement)');
  assert.equal(after1.anim, 'none', 'pas d\'animation d\'entrée rejouée');
  // Un rendu identique (même vue, mêmes données) ne touche pas au DOM
  await page.evaluate(() => { window.__mut = 0; render(); });
  assert.equal(await page.evaluate(() => window.__mut), 0);
  // Un changement d'onglet garde l'animation normale
  await page.click('.ntab[data-tab="serie"]');
  assert.notEqual(await page.evaluate(() => getComputedStyle(document.querySelector('#mc .card')).animationName), 'none');
  assert.deepEqual(problems, []);
});
