/* lp3d — appareils de la landing (écran Studio Display XDR, iPad Pro, iPhone Pro Max) rendus par BLENDER.
   Les images viennent des fichiers .blend de Pierre (Cycles, AgX, ses 4 lumières « Studio »), vues de face, fond
   transparent, écran noir : l'appareil reste FIXE (pas d'inclinaison, pas de flottement). Le HTML de l'écran (.lp-dv, vrai
   texte, cliquable) est posé sur la dalle dont les 4 coins ont été mesurés dans Blender (translation + échelle, pas de
   perspective : texte net). Pendant les transitions, les images se fondent l'une dans l'autre.
   Un 2ᵉ canvas, au-dessus du HTML en mélange « screen », y repose très légèrement les reflets du verre.
   Rien d'externe (CSP) ; si quoi que ce soit échoue, js/23-landing.js garde l'appareil CSS d'origine. */
const BASE = new URL('./img/', import.meta.url);
const KEYS = ['pc', 'tab', 'ph'];

export async function start(cv, fx, opts) {
  opts = opts || {};
  const man = await (await fetch(new URL('manifest.json', BASE))).json();
  const ctx = cv.getContext('2d', { alpha: true });
  const cfx = fx ? fx.getContext('2d', { alpha: true }) : null;
  if (!ctx) throw new Error('no-2d');
  const dpr = Math.min(window.devicePixelRatio || 1, opts.maxDpr || 2);
  const dev = KEYS.map(k => {
    const m = man[k], f = m.front;
    /* dalle de référence dans l'image : centre et demi-largeur / demi-hauteur en pixels d'image */
    return { k, m, cx: (f[0][0] + f[2][0]) / 2, cy: (f[0][1] + f[2][1]) / 2, hwpx: (f[1][0] - f[0][0]) / 2, hhpx: (f[3][1] - f[0][1]) / 2, bmp: null, p: null };
  });

  function load(d) {
    if (d.p) return d.p;
    d.p = fetch(new URL(d.m.file, BASE)).then(r => { if (!r.ok) throw new Error('img ' + r.status); return r.blob(); })
      .then(b => createImageBitmap(b)).then(bmp => { d.bmp = bmp; }).catch(e => { d.p = null; throw e; });
    return d.p;
  }
  /* le PC (appareil de départ) doit être là avant d'annoncer « prêt » ; les autres arrivent derrière */
  await load(dev[0]);
  dev.slice(1).forEach(d => load(d).catch(() => {}));

  let cw = 0, ch = 0, last = '';
  function size(vw, vh) {
    cw = vw; ch = vh;
    for (const c of [cv, fx]) { if (!c) continue; c.width = Math.round(vw * dpr); c.height = Math.round(vh * dpr); }
  }

  const api = {
    ratio: dev.map(d => d.hwpx / d.hhpx),
    rad: dev.map(d => d.m.rad),
    /* étendue de l'appareil sous / au-dessus du centre de l'écran, en fraction de la hauteur d'écran */
    ext(w) {
      let dn = 0, up = 0, t = 0;
      for (let i = 0; i < 3; i++) { dn += dev[i].m.down * w[i]; up += dev[i].m.up * w[i]; t += w[i]; }
      return t > 0 ? { down: dn / t, up: up / t } : { down: 0.5, up: 0.5 };
    },
    ready(w) { for (let i = 0; i < 3; i++) if (w[i] > 0.004 && !dev[i].bmp) return false; return true; },
    /* st : vw, vh, cx, cy (centre de l'écran), iw, ih (zone d'écran DOM), s (échelle), w[3] (poids PC / tablette / téléphone),
       glass (0..1, force des reflets). */
    draw(st) {
      /* rien n'a changé depuis la dernière image (appareil fixe) : on ne redessine pas */
      const key = [st.vw, st.vh, st.cx.toFixed(2), st.cy.toFixed(2), st.iw.toFixed(2), st.ih.toFixed(2), st.s.toFixed(4), st.w.map(v => v.toFixed(3)).join('/'), st.glass, dev.map(d => d.bmp ? 1 : 0).join('')].join('|');
      if (key === last) return;
      last = key;
      if (st.vw !== cw || st.vh !== ch) size(st.vw, st.vh);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, cw, ch);
      if (cfx) { cfx.setTransform(dpr, 0, 0, dpr, 0, 0); cfx.clearRect(0, 0, cw, ch); }
      const x0 = st.cx - st.iw * st.s / 2, y0 = st.cy - st.ih * st.s / 2, x1 = st.cx + st.iw * st.s / 2, y1 = st.cy + st.ih * st.s / 2;
      if (cfx && st.glass > 0.001) { cfx.save(); cfx.beginPath(); cfx.rect(x0, y0, x1 - x0, y1 - y0); cfx.clip(); cfx.globalCompositeOperation = 'lighter'; }
      ctx.globalCompositeOperation = 'lighter';
      for (let k = 0; k < 3; k++) {
        const wk = st.w[k]; if (wk <= 0.004 || !dev[k].bmp) continue;
        const d = dev[k], kx = st.iw * st.s / (2 * d.hwpx), ky = st.ih * st.s / (2 * d.hhpx);
        const ox = st.cx - kx * d.cx, oy = st.cy - ky * d.cy;
        ctx.globalAlpha = wk; ctx.drawImage(d.bmp, ox, oy, kx * d.m.W, ky * d.m.H);
        if (cfx && st.glass > 0.001) { cfx.globalAlpha = wk * st.glass; cfx.drawImage(d.bmp, ox, oy, kx * d.m.W, ky * d.m.H); }
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      if (cfx && st.glass > 0.001) cfx.restore();
    },
    dispose() { for (const d of dev) { try { d.bmp && d.bmp.close(); } catch (e) { /* ignore */ } d.bmp = null; } ctx.clearRect(0, 0, cv.width, cv.height); if (cfx) cfx.clearRect(0, 0, fx.width, fx.height); }
  };
  return api;
}
