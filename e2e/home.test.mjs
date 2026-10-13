/* Accueil : carrousel 3D « En cours » (js/25-home.js) et pilule d'onglets.
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
  total_ep: null, anime_genre: '', deleted: false, updated_at: '2026-10-01T10:00:00Z', added_at: '2026-09-10T10:00:00Z', ...o });
function items() {
  n = 0;
  return [
    ...Array.from({ length: 14 }, (_, i) => item({ title: 'En cours ' + (i + 1), status: 'encours', saison: 1, episode: i + 1, updated_at: '2026-10-' + String(28 - i).padStart(2, '0') + 'T10:00:00Z' })),
    ...Array.from({ length: 8 }, (_, i) => item({ title: 'Film ' + (i + 1), type: 'film', tmdb_type: 'movie' })),
  ];
}
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="342" height="513"><rect width="342" height="513" fill="#345"/></svg>';

async function newPage(t, { viewport = { width: 1440, height: 900 }, mobile = false, reducedMotion = 'no-preference', keepStart = false } = {}) {
  server.config = { turnstileSiteKey: '', signupsOpen: true };
  const ctx = await browser.newContext({ locale: 'fr-FR', viewport, reducedMotion, ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', m => { const x = m.text(); if (m.type() === 'error' && !/^Failed to load resource: the server responded with a status of (4\d\d)/.test(x)) problems.push(x); });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  await installFakeSupabase(page, { items: items() });
  await page.route(u => u.pathname === '/api/tmdb', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"results":[],"page":1,"total_pages":1}' }));
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
  await page.locator('#authViewTitle').filter({ hasText: 'Mon compte' }).waitFor();
  await page.click('#authMbk .auth-close');
  await page.waitForFunction(() => memDB.filter(i => !i.deleted).length >= 20 && !syncInProgress);
  await page.locator('#cfRing .cf-card.on').waitFor();
  /* Le carrousel démarre au milieu ; les tests de navigation repartent du premier titre */
  if (!keepStart) await page.evaluate(() => { _heroIdx = 0; _showHeroItem(0); });
  return { page, problems };
}
const active = page => page.evaluate(() => _heroIdx);
const activeCard = page => page.evaluate(() => +document.querySelector('#cfRing .cf-card.on').getAttribute('data-i'));

test('molette sur le carrousel : verticale et horizontale changent le titre actif, un pas par ~180 ms', async t => {
  const { page, problems } = await newPage(t);
  const box = await page.locator('#cfStage').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  assert.equal(await active(page), 0);
  // Vrais événements de molette (passent par le navigateur, comme une souris)
  await page.mouse.wheel(0, 120);
  await page.waitForFunction(() => _heroIdx === 1);
  assert.equal(await activeCard(page), 1);
  assert.match(await page.textContent('#contCtr'), /^2 \/ 14$/);
  // Rafale : limitée à un pas
  await page.waitForTimeout(220);
  await page.evaluate(() => { const st = document.getElementById('cfStage'); for (let i = 0; i < 5; i++) st.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true })); });
  assert.equal(await active(page), 2, 'une rafale de 5 crans en < 180 ms = un seul pas');
  // Pavé tactile horizontal
  await page.waitForTimeout(220);
  await page.mouse.wheel(-80, 0);
  await page.waitForFunction(() => _heroIdx === 1);
  // Événement WheelEvent envoyé directement sur le carrousel : annulé (la page ne défile pas)
  await page.waitForTimeout(220);
  const r = await page.evaluate(() => {
    const st = document.getElementById('cfStage');
    const ev = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true });
    st.dispatchEvent(ev);
    return { prevented: ev.defaultPrevented, idx: _heroIdx };
  });
  assert.deepEqual(r, { prevented: true, idx: 2 });
  // Toute navigation manuelle arrête le balayage automatique
  assert.equal(await page.evaluate(() => _heroManual), true);
  // Hors du carrousel, la molette fait défiler la page normalement
  const r2 = await page.evaluate(() => {
    const ev = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true });
    document.getElementById('mc').dispatchEvent(ev);
    return ev.defaultPrevented;
  });
  assert.equal(r2, false);
  assert.deepEqual(problems, []);
});

test('flèches, boutons ‹ ›, clic sur une affiche ; seules ±5 affiches dans le DOM', async t => {
  const { page, problems } = await newPage(t);
  assert.equal(await page.locator('#cfRing .cf-card').count(), 6, 'actif 0 : affiches 0 à 5');
  await page.focus('#cfStage');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  assert.equal(await active(page), 2);
  await page.keyboard.press('End');
  assert.equal(await active(page), 13);
  assert.equal(await page.locator('#cfRing .cf-card').count(), 6, 'actif 13 : affiches 8 à 13');
  await page.keyboard.press('Home');
  await page.click('.cf-nav.next');
  assert.equal(await active(page), 1);
  await page.click('.cf-nav.prev');
  assert.equal(await active(page), 0);
  assert.equal(await page.locator('.cf-nav.prev').isDisabled(), true);
  await page.evaluate(() => { _heroManual = false; });
  await page.waitForTimeout(700); // fin de l'animation
  // clic sur la partie visible (coin haut droit, hors du bouton ›) de la 4e affiche, recouverte à gauche par la 3e
  const c3 = await page.locator('#cfRing .cf-card[data-i="3"]').boundingBox();
  await page.mouse.click(c3.x + c3.width - 6, c3.y + 40);
  await page.waitForFunction(() => _heroIdx === 3);
  assert.equal(await page.evaluate(() => _heroManual), true, 'clic sur une affiche : balayage arrêté');
  assert.equal(await page.textContent('#heroTitle'), 'En cours 4');
  assert.deepEqual(problems, []);
});

test('glisser à la souris fait défiler ; onglets en pilule avec surlignage', async t => {
  const { page, problems } = await newPage(t);
  const box = await page.locator('#cfStage').boundingBox();
  const y = box.y + 40, x = box.x + box.width / 2 + 200;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x - 100, y, { steps: 5 }); await page.mouse.move(x - 200, y, { steps: 5 });
  await page.mouse.up();
  assert.equal(await active(page), 2);
  const hl = () => page.evaluate(() => { const h = document.getElementById('segHl').getBoundingClientRect(), o = document.querySelector('#tabSeg .ntab.on').getBoundingClientRect(); return Math.abs(h.left - o.left) < 2 && Math.abs(h.width - o.width) < 2; });
  assert.equal(await hl(), true);
  await page.click('.ntab[data-tab="serie"]');
  await page.waitForTimeout(600);
  assert.equal(await hl(), true, 'surlignage sous Séries');
  await page.click('.ntab[data-tab="discover"]');
  assert.equal(await page.evaluate(() => document.getElementById('segHl').classList.contains('on')), false, 'Découvrir : pas de surlignage dans la pilule');
  assert.deepEqual(problems, []);
});

test('mouvement réduit : rangée à plat, sans rotation ; téléphone : fond flouté masqué, boutons visibles', async t => {
  const { page } = await newPage(t, { reducedMotion: 'reduce' });
  const tr = await page.evaluate(() => [...document.querySelectorAll('#cfRing .cf-card')].map(c => c.style.transform).join(' '));
  assert.doesNotMatch(tr, /rotate/);
  const m = await newPage(t, { viewport: { width: 390, height: 844 }, mobile: true });
  assert.equal(await m.page.locator('#heroBg').isVisible(), false);
  assert.equal(await m.page.locator('.cf-nav.next').isVisible(), true);
  await m.page.tap('.cf-nav.next');
  assert.equal(await active(m.page), 1);
  const w = await m.page.evaluate(() => [innerWidth, document.documentElement.scrollWidth]);
  assert.equal(w[0], w[1], 'pas de débordement horizontal');
});

/* Régression PR #23 : passage d'une affiche à l'autre animé (et non coupé sec), y compris en mouvement
   réduit (Windows « Effets d'animation » désactivés), nœuds réutilisés d'un pas à l'autre. */
const sampleStep = (page, how) => page.evaluate(async how => {
  const st = document.getElementById('cfStage'), i0 = _heroIdx;
  const c = document.querySelector('#cfRing .cf-card[data-i="' + (i0 + 1) + '"]');
  const ids = [...document.querySelectorAll('#cfRing .cf-card')].map(e => e);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  if (how === 'wheel') st.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }));
  else if (how === 'key') st.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  else if (how === 'button') document.querySelector('#heroBand .cf-nav.next').click();
  else cfGo(i0 + 1);
  await wait(90); const mid = getComputedStyle(c).transform;
  await wait(800); const end = getComputedStyle(c).transform;
  const still = ids.filter(e => e.isConnected).length, total = ids.length;
  return { tr: getComputedStyle(c).transition, moved: _heroIdx === i0 + 1, mid, end, same: c.isConnected && c === document.querySelector('#cfRing .cf-card.on'), still, total };
}, how);
for (const rm of ['no-preference', 'reduce']) test('carrousel animé (' + rm + ') : molette, flèches, boutons ; nœuds réutilisés', async t => {
  const { page } = await newPage(t, { reducedMotion: rm });
  await page.evaluate(() => { _heroManual = true; clearTimeout(_heroTimer); });
  for (const how of ['wheel', 'key', 'button']) {
    const r = await sampleStep(page, how);
    assert.ok(r.moved, how + ' avance');
    assert.notEqual(r.mid, r.end, JSON.stringify(r) + ' : la transformation évolue (pas de coupure sèche)');
    assert.ok(r.same, how + ' : la même affiche devient active (nœud réutilisé)');
    assert.ok(r.still >= r.total - 1, how + ' : les autres affiches restent dans le DOM');
    if (rm === 'reduce') assert.doesNotMatch(r.end, /matrix3d/, 'pas de 3D en mouvement réduit');
  }
});
test('glisser : la rangée suit le pointeur en temps réel puis se recale', async t => {
  const { page } = await newPage(t);
  const b = await page.locator('#cfStage').boundingBox();
  const x = b.x + b.width / 2, y = b.y + 120;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x - 40, y, { steps: 4 });
  const during = await page.evaluate(() => document.getElementById('cfRing').style.transform);
  assert.match(during, /translateX\(-2\d/, 'la rangée suit le pointeur');
  await page.mouse.move(x - 130, y, { steps: 6 }); await page.mouse.up();
  assert.equal(await active(page), 1);
  assert.equal(await page.evaluate(() => document.getElementById('cfRing').style.transform), '');
});

/* ===== Accueil « Cinéma » : À suivre, Cette semaine, ambiance, compact ===== */
test('Accueil Cinéma : « À suivre » (4 titres), bouton épisode suivant, « Cette semaine », masqué en compact et dans Calendrier', async t => {
  const { page, problems } = await newPage(t);
  const rows = page.locator('#homeNext .hn-row');
  await rows.first().waitFor();
  assert.equal(await rows.count(), 4);
  assert.match(await rows.first().textContent(), /En cours 1.*Prochain : S01 · E02/);
  // bouton ✓ = épisode suivant existant (quickNextEp), sans ouvrir la fiche
  const id = await page.evaluate(() => _heroItems[0].id);
  await page.click('#homeNext .hn-row:first-child .hn-ck');
  await page.waitForFunction(id => memDB.find(i => i.id == id).episode === 2, id);
  assert.equal(await page.locator('#plexMbk.on').count(), 0);
  // « Cette semaine » : calendrier chargé en différé, ici sans sortie
  await page.locator('#homeNext .hn-empty', { hasText: 'Rien de prévu' }).waitFor({ timeout: 8000 });
  // clic sur une ligne = fiche
  await page.click('#homeNext .hn-row:nth-child(2) .hn-tx');
  await page.locator('#plexMbk.on').waitFor();
  await page.keyboard.press('Escape');
  // mode compact : sections masquées, grille dense
  await page.evaluate(() => { compactOn = true; render(); });
  assert.equal(await page.locator('#homeNext').isVisible(), false);
  assert.equal(await page.locator('#mc .grid.cpt').count() > 0, true);
  await page.evaluate(() => { compactOn = false; render(); });
  assert.equal(await page.locator('#homeNext').isVisible(), true);
  // Calendrier : masqué
  await page.click('.ntab[data-tab="calendar"]');
  assert.equal(await page.locator('#homeNext').isVisible(), false);
  assert.deepEqual(problems, []);
});

test('Accueil Cinéma : couleur d\'ambiance tirée de l\'affiche active', async t => {
  const { page, problems } = await newPage(t);
  await page.route('https://image.tmdb.org/**', r => r.fulfill({ status: 200, contentType: 'image/svg+xml', headers: { 'access-control-allow-origin': '*' },
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="92" height="138"><rect width="92" height="138" fill="#c03020"/></svg>' }));
  await page.evaluate(() => cfGo(3));
  await page.waitForFunction(() => /^\d+,\d+,\d+$/.test(document.getElementById('heroBand').style.getPropertyValue('--amb')));
  const [r, g, b] = (await page.evaluate(() => document.getElementById('heroBand').style.getPropertyValue('--amb'))).split(',').map(Number);
  assert.ok(r > g * 2 && r > b * 2, 'rouge de l\'affiche');
  assert.deepEqual(problems, []);
});

test('Accueil Cinéma sur téléphone (390) : pas de débordement horizontal, 3 lignes « À suivre », grille 2 colonnes', async t => {
  const { page, problems } = await newPage(t, { viewport: { width: 390, height: 844 }, mobile: true });
  await page.locator('#homeNext .hn-row').first().waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await page.locator('#homeNext .hn-row:visible').count(), 3);
  const cols = await page.evaluate(() => { const g = document.querySelector('#mc .grid:not(.cpt)'); return g ? getComputedStyle(g).gridTemplateColumns.split(' ').length : 2; });
  assert.equal(cols, 2);
  assert.deepEqual(problems, []);
});

test('carrousel : démarre sur le titre du milieu (rempli des deux côtés), sans recentrer après un choix ni un épisode suivant', async t => {
  const { page, problems } = await newPage(t, { keepStart: true });
  assert.equal(await page.evaluate(() => _heroIdx), 6, '14 titres : index 6');
  const sides = await page.evaluate(() => { const on = +document.querySelector('#cfRing .cf-card.on').getAttribute('data-i');
    const v = [...document.querySelectorAll('#cfRing .cf-card')].filter(c => c.style.opacity !== '0').map(c => +c.getAttribute('data-i'));
    return { left: v.filter(i => i < on).length, right: v.filter(i => i > on).length }; });
  assert.ok(sides.left >= 3 && sides.right >= 3, JSON.stringify(sides));
  await page.evaluate(() => cfGo(2));
  await page.evaluate(() => { quickNextEp(_heroItems[5].id); });
  await page.waitForTimeout(300);
  await page.evaluate(() => render());
  assert.equal(await page.evaluate(() => _heroIdx), 2, 'choix manuel conservé');
  assert.deepEqual(problems, []);
});

test('progression : nombre d\'épisodes demandé au proxy TMDB, vrai % ; sinon barre indéterminée puis masquée, jamais 0 % trompeur', async t => {
  const { page, problems } = await newPage(t, { keepStart: true });
  // fond du bandeau sans saisons (route par défaut) : la barre active finit masquée (introuvable)
  await page.waitForFunction(() => document.querySelector('.cf-bar').classList.contains('none'));
  // nouvelle réponse avec les saisons : 10 épisodes en saison 1
  await page.route(u => u.pathname === '/api/tmdb', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ seasons: [{ season_number: 1, episode_count: 10 }], images: { backdrops: [] } }) }));
  const id = await page.evaluate(() => { const it = memDB.find(i => i.title === 'En cours 9'); delete it.seasonEpCount; return it.id; });
  await page.evaluate(() => { _scFailed = Object.create(null); cache = typeof cache !== 'undefined' ? cache : {}; for (const k in cache) delete cache[k]; });
  await page.evaluate(id => { cfGo(_heroItems.findIndex(i => i.id == id)); }, id);
  await page.waitForFunction(id => memDB.find(i => i.id == id).seasonEpCount === 10, id);
  await page.waitForFunction(() => document.getElementById('cfBar').style.width === '90%');
  assert.equal(await page.evaluate(() => document.querySelector('.cf-bar').className), 'cf-bar');
  assert.deepEqual(problems, []);
});
