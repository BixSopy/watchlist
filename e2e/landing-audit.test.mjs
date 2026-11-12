/* Garde-fous de l'audit visuel de la landing (12/11) : vrai Chrome, CSP de production, Supabase simulé. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { startServer } from './server.mjs';
import { installFakeSupabase } from './fake-supabase.mjs';

const CHROME = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
let browser, server;
before(async () => {
  if (!CHROME) throw new Error('Chrome introuvable : définis CHROME_PATH');
  browser = await chromium.launch({ executablePath: CHROME, headless: true });
  server = await startServer();
});
after(async () => { await browser?.close(); await server?.close(); });

async function open(t, opts) {
  server.config = { turnstileSiteKey: '', signupsOpen: true };
  const ctx = await browser.newContext({ locale: 'fr-FR', ...opts });
  const page = await ctx.newPage();
  await installFakeSupabase(page, { landing: true });
  t.after(() => ctx.close());
  await page.goto(server.url + '/');
  await page.waitForSelector('#landing [data-lp-j]', { state: 'attached', timeout: 30000 });
  await page.waitForTimeout(1500);
  return page;
}

/* Avant : un visiteur dont l'OS est en mode clair voyait des onglets blancs dans le formulaire (texte actif à 1,9:1),
   une liste de langues noire sur noir et « cin » invisible dans le logo. */
test('OS en mode clair : la landing reste sombre (thème, onglets du formulaire, liste de langues, logo)', async t => {
  const page = await open(t, { viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
  const lum = c => { const m = c.match(/[\d.]+/g).map(Number); return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255; };
  const r = await page.evaluate(() => {
    const cs = e => getComputedStyle(e), q = s => document.querySelector(s);
    return { theme: document.documentElement.getAttribute('data-theme'), scheme: cs(document.documentElement).colorScheme,
      tabs: cs(q('#authView .auth-tabs')).backgroundColor, sel: cs(q('.lp-foot .lang-pick')).color, word: cs(q('.lp-brand .logo-word')).color };
  });
  assert.equal(r.theme, 'dark');
  assert.equal(r.scheme, 'dark');
  assert.ok(lum(r.tabs) < 0.25, 'fond des onglets sombre : ' + r.tabs);
  assert.ok(lum(r.sel) > 0.6, 'texte de la liste de langues clair : ' + r.sel);
  assert.ok(lum(r.word) > 0.6, 'logo lisible en entier : ' + r.word);
});

for (const [w, h] of [[1366, 768], [1280, 720], [1536, 864], [1440, 900]]) {
  test(`${w}×${h} : boutons d'accueil entièrement visibles, pied de l'écran dans le cadre`, async t => {
    const page = await open(t, { viewport: { width: w, height: h } });
    await page.waitForFunction(() => document.documentElement.classList.contains('lp-3don'), null, { timeout: 60000 });
    await page.waitForTimeout(1200);
    const r = await page.evaluate(() => {
      const cta = [...document.querySelectorAll('.lp-hero .lp-cta-row a')].map(e => e.getBoundingClientRect());
      const cv = document.getElementById('lpDv3d'), c = cv.getContext('2d'), cr = cv.getBoundingClientRect(), k = cv.width / cr.width;
      const scr = document.querySelector('.lp-dv-scr').getBoundingClientRect(), x = Math.round((scr.left + scr.width / 2) * k), col = c.getImageData(x, 0, 1, cv.height).data;
      let b = -1; for (let y = 0; y < cv.height; y++) if (col[y * 4 + 3] > 40) b = y;
      return { vh: innerHeight, ctaBottom: Math.max(...cta.map(q => q.bottom)), sameRow: Math.abs(cta[0].top - cta[1].top) < 2, devBottom: b / k + cr.top };
    });
    assert.ok(r.ctaBottom <= r.vh - 16, 'boutons visibles : ' + JSON.stringify(r));
    assert.ok(r.devBottom <= r.vh - 8, 'pied de l\'écran visible : ' + JSON.stringify(r));
  });
}

/* ---- Suite de l'audit (points 1 à 6 demandés par Pierre le 12/11) ---- */
const phone = (w, h) => ({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

for (const [w, h] of [[390, 844], [360, 640]]) {
  test(`mobile ${w}×${h} : au chargement l'appareil est visible, le texte d'accueil est dessous, les deux boutons tiennent à l'écran`, async t => {
    const page = await open(t, phone(w, h));
    const r = await page.evaluate(() => {
      const scr = document.querySelector('.lp-dv-scr').getBoundingClientRect(), h1 = document.querySelector('.lp-hero h1').getBoundingClientRect();
      const cta = [...document.querySelectorAll('.lp-hero .lp-cta-row a')].map(e => e.getBoundingClientRect());
      const cs = getComputedStyle(document.querySelector('.lp-hero .lp-ch-t'));
      return { vh: innerHeight, vw: innerWidth, scrTop: scr.top, scrBottom: scr.bottom, h1Top: h1.top, h1Left: h1.left, ctaBottom: Math.max(...cta.map(c => c.bottom)), padL: cs.paddingLeft, docW: document.documentElement.scrollWidth };
    });
    assert.ok(r.scrTop >= 64 && r.scrBottom <= r.h1Top, 'appareil au-dessus du titre, sans recouvrement : ' + JSON.stringify(r));
    assert.ok(r.h1Left >= 16, 'marge latérale : ' + r.h1Left);
    assert.ok(r.ctaBottom <= r.vh, 'boutons à l\'écran : ' + JSON.stringify(r));
    assert.ok(r.docW <= r.vw, 'pas de défilement horizontal');
  });
}

/* Régression du 12/11 : le bloc d'accueil ancré en bas par flex-end était compté comme décalé en entier (CLS 0,19) quand le
   texte français de la page était remplacé par la langue du visiteur (le second bouton remontait sur la première rangée).
   Scripts retardés = cas d'un réseau lent ; le français ne déclenche rien, d'où l'anglais ici. */
for (const [w, h] of [[412, 823], [390, 844], [360, 640]]) {
  test(`mobile ${w}×${h}, visiteur non francophone, scripts lents : pas de décalage de mise en page à l'arrivée de la langue`, async t => {
    server.config = { turnstileSiteKey: '', signupsOpen: true };
    const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    t.after(() => ctx.close());
    const page = await ctx.newPage();
    await installFakeSupabase(page, { landing: true });
    await page.route(/\/js\/.*\.js(\?|$)/, async r => { await new Promise(x => setTimeout(x, 500)); await r.fallback(); });
    await page.addInitScript(() => {
      window.__cls = 0; window.__src = [];
      new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) { window.__cls += e.value; for (const s of e.sources) if (s.node && s.node.className) window.__src.push(String(s.node.className)); } }).observe({ type: 'layout-shift', buffered: true });
    });
    await page.goto(server.url + '/');
    await page.waitForSelector('#landing [data-lp-j]', { state: 'attached', timeout: 30000 });
    await page.waitForFunction(() => /Everything/.test(document.querySelector('#lp-title').textContent), null, { timeout: 30000 });
    await page.waitForTimeout(1200);
    const r = await page.evaluate(() => ({ cls: window.__cls, src: window.__src, rows: new Set([...document.querySelectorAll('#lp-top .lp-cta-row .lp-btn')].map(b => Math.round(b.getBoundingClientRect().top))).size }));
    assert.ok(r.cls < 0.05, `CLS ${r.cls.toFixed(3)} (sources : ${r.src.join(', ')})`);
    assert.ok(!r.src.includes('lp-ch-t'), 'le bloc d\'accueil entier ne doit pas bouger');
    assert.equal(r.rows, 2, 'boutons empilés, quelle que soit la langue');
  });
}

test('mobile 390×844 : le bandeau de texte montre le paragraphe entier et ne touche pas l\'appareil ; contenu des écrans ≥ 6,5 px', async t => {
  const page = await open(t, phone(390, 844));
  const y = await page.evaluate(() => { const c = document.querySelectorAll('.lp-ch')[2], q = c.getBoundingClientRect(); return Math.round(scrollY + q.top + q.height * 0.3 - innerHeight * 0.38); });
  await page.evaluate(v => scrollTo(0, v), y);
  await page.waitForFunction(() => { const m = document.querySelector('.lp-j-mtext'); return m && m.classList.contains('on') && /Extension/i.test(m.textContent); }, null, { timeout: 30000 });
  await page.waitForTimeout(2500);
  const r = await page.evaluate(() => {
    const m = document.querySelector('.lp-j-mtext'), p = m.querySelector('.lp-p'), scr = document.querySelector('.lp-dv-scr'), sr = scr.getBoundingClientRect(), k = sr.width / scr.offsetWidth;
    let minF = 99; for (const e of document.querySelectorAll('.lp-s.vis *')) { const own = [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 1); if (!own || !e.getClientRects().length) continue; minF = Math.min(minF, parseFloat(getComputedStyle(e).fontSize) * k); }
    return { lines: Math.round(p.getBoundingClientRect().height / parseFloat(getComputedStyle(p).lineHeight)), clipped: p.scrollHeight > p.clientHeight + 1, cardTop: m.getBoundingClientRect().top, scrBottom: sr.bottom, minF };
  });
  assert.ok(r.lines >= 3 && !r.clipped, 'paragraphe entier : ' + JSON.stringify(r));
  assert.ok(r.cardTop >= r.scrBottom + 8, 'le bandeau ne recouvre pas l\'appareil : ' + JSON.stringify(r));
  assert.ok(r.minF >= 6.5, 'texte des écrans (il était à 4,6 px) : ' + r.minF);
});

test('ordinateur : aucune police web téléchargée pour la liste des langues ; texte des écrans ≥ 9,5 px en 1440×900', async t => {
  const fonts = [];
  server.config = { turnstileSiteKey: '', signupsOpen: true };
  const ctx = await browser.newContext({ locale: 'fr-FR', viewport: { width: 1440, height: 900 } });
  t.after(() => ctx.close());
  const page = await ctx.newPage();
  page.on('request', r => { if (r.resourceType() === 'font') fonts.push(r.url().split('/').pop()); });
  await installFakeSupabase(page, { landing: true });
  await page.goto(server.url + '/');
  await page.waitForFunction(() => document.documentElement.classList.contains('lp-3don'), null, { timeout: 60000 });
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight)); await page.waitForTimeout(1500);
  assert.deepEqual(fonts.filter(f => /noto|cyrillic|arabic|devanagari|bengali/i.test(f)), [], 'polices : ' + fonts.join(', '));
  await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(2500);
  const minF = await page.evaluate(() => { const scr = document.querySelector('.lp-dv-scr'), k = scr.getBoundingClientRect().width / scr.offsetWidth; let m = 99;
    for (const e of document.querySelectorAll('.lp-s.vis *')) { const own = [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 1); if (!own || !e.getClientRects().length) continue; m = Math.min(m, parseFloat(getComputedStyle(e).fontSize) * k); } return m; });
  assert.ok(minF >= 9.5, 'texte du lecteur : ' + minF);
});

test('ordinateur : en plein chapitre « Tu regardes. Il coche. », le texte est toujours là (il disparaissait à mi-chapitre)', async t => {
  const page = await open(t, { viewport: { width: 1440, height: 900 } });
  const y = await page.evaluate(() => { const c = document.querySelectorAll('.lp-ch')[1], q = c.getBoundingClientRect(); return Math.round(scrollY + q.top + q.height * 0.65 - innerHeight * 0.38); });
  await page.evaluate(v => scrollTo(0, v), y);
  await page.waitForTimeout(3500);
  const r = await page.evaluate(() => [...document.querySelectorAll('.lp-ch')].map(c => { const e = c.querySelector('.lp-ch-t').getBoundingClientRect(); return c.classList.contains('on') && e.top >= 64 && e.bottom <= innerHeight; }));
  assert.ok(r.some(Boolean), 'un texte de chapitre entièrement visible à g ≈ 1,65');
});

/* ---- Textes des chapitres : un seul à la fois, sur son écran (retour de Pierre du 12/11) ---- */
const goG = async (page, g, settled = true) => {
  await page.evaluate(g => { const c = Math.floor(g), el = document.querySelectorAll('.lp-ch')[c], r = el.getBoundingClientRect(); scrollTo(0, Math.round(scrollY + r.top + r.height * (g - c) - innerHeight * 0.38)); }, g);
  /* la valeur affichée rejoint la cible en douceur : on attend que le chapitre visé soit devenu le chapitre courant */
  if (settled) await page.waitForFunction(c => document.querySelectorAll('.lp-ch')[c].classList.contains('on'), Math.floor(g), { timeout: 30000 });
  else await page.waitForTimeout(3000);
  await page.waitForTimeout(1800);   /* fondu des scènes et des textes (0,2 s de sortie, puis entrée) */
};
const state = page => page.evaluate(() => ({
  html: document.documentElement.className,
  scenes: [...document.querySelectorAll('.lp-s')].filter(e => +getComputedStyle(e).opacity > .5).map(e => +e.getAttribute('data-s')),
  texts: [...document.querySelectorAll('.lp-ch-t')].map((t, i) => { const b = t.getBoundingClientRect(), o = Math.max(...[...t.children].map(k => +getComputedStyle(k).opacity)); return o > .1 && b.bottom > 73 && b.top < innerHeight ? { i, top: Math.round(b.top), bottom: Math.round(b.bottom) } : null; }).filter(Boolean),
  thumbs: [...document.querySelectorAll('.lp-ex-row .lp-po')].map(p => +getComputedStyle(p).opacity),
}));

for (const [w, h] of [[1440, 900], [2560, 1300], [1280, 600]]) {
  test(`ordinateur ${w}×${h} : un seul texte de chapitre à la fois, celui de l'écran affiché, épinglé au centre`, async t => {
    const page = await open(t, { viewport: { width: w, height: h } });
    for (const g of [1.6, 2.5, 2.97, 3.05, 5.9, 5.97, 6.05, 7.5]) {
      await goG(page, g);
      const r = await state(page), c = Math.floor(g);
      assert.deepEqual(r.texts.map(x => x.i), [c], `g=${g} : textes visibles ${JSON.stringify(r.texts)}`);
      assert.ok(r.scenes.includes(c <= 1 ? 0 : c), `g=${g} : écran affiché ${r.scenes}`);
      /* épinglé : même place en début et en fin de chapitre (en sticky, il était déjà sorti par le haut à g = i + 0,9) */
      const mid = (r.texts[0].top + r.texts[0].bottom) / 2;
      assert.ok(Math.abs(mid - h / 2) <= 2, `g=${g} : centre du texte à ${mid} px pour un écran de ${h} px`);
    }
  });
}

test('accueil atteint après une session (déconnexion, session expirée — cas des prévisualisations) : animations actives, un seul texte, vignettes de « Détectés » vides avant l\'arrivée des affiches', async t => {
  server.config = { turnstileSiteKey: '', signupsOpen: true };
  const ctx = await browser.newContext({ locale: 'fr-FR', viewport: { width: 1440, height: 900 } });
  t.after(() => ctx.close());
  const page = await ctx.newPage();
  await installFakeSupabase(page);   /* sans { landing: true } : l'application s'ouvre d'abord */
  await page.goto(server.url + '/');
  await page.waitForFunction(() => document.documentElement.classList.contains('lp-member'), null, { timeout: 30000 });
  await page.evaluate(() => lpEnter('login'));
  await page.waitForSelector('#landing [data-lp-j]', { state: 'visible', timeout: 30000 });
  await page.waitForTimeout(1500);
  const cls = await page.evaluate(() => document.documentElement.className);
  assert.ok(/\blp-guest\b/.test(cls) && /\blp-anim\b/.test(cls) && /\blp-pin\b/.test(cls), 'classes de <html> : ' + cls);
  await goG(page, 2.05);
  let r = await state(page);
  assert.ok(r.thumbs.length === 6 && r.thumbs.every(o => o < .05), 'vignettes vides au début du chapitre : ' + r.thumbs.join(' '));
  await goG(page, 2.97);
  r = await state(page);
  assert.ok(r.thumbs.every(o => o > .95), 'toutes les affiches sont arrivées en fin de chapitre');
  await goG(page, 5.9);
  r = await state(page);
  assert.deepEqual(r.texts.map(x => x.i), [5], 'un seul texte (avant : chapitres 5 et 6 superposés) : ' + JSON.stringify(r.texts));
});

test('mobile 390×844 : le bandeau de texte suit l\'écran affiché (même chapitre), et n\'apparaît qu\'une fois le texte d\'accueil sorti', async t => {
  const page = await open(t, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const titles = await page.evaluate(() => [...document.querySelectorAll('.lp-ch')].map(c => (c.querySelector('h2') || {}).textContent || ''));
  const card = () => page.evaluate(() => { const m = document.querySelector('.lp-j-mtext'); return m.classList.contains('on') ? m.querySelector('h2').textContent : ''; });
  await goG(page, 1.05, false);
  assert.equal(await card(), '', 'pas de bandeau tant que le texte d\'accueil est à l\'écran');
  for (const g of [1.5, 2.05, 2.6, 2.97, 3.05, 6.97, 7.05]) {
    await goG(page, g);
    assert.equal(await card(), titles[Math.floor(g)], `g=${g}`);
  }
});

