/* Contenu des écrans (ordinateur, tablette, téléphone) dessiné en haute résolution dans des canvas,
   puis plaqué en 3D : l'écran reçoit ainsi lueur, reflets et profondeur de champ.
   Les affiches viennent d'un atlas unique : affiches de secours aux couleurs de la marque tant que
   les vraies (TMDB) ne sont pas chargées — chargées seulement au premier geste de défilement,
   comme sur la landing actuelle. */
import * as THREE from './three/three.module.min.js';
import { POSTERS } from './data.js';

const TOK = { text: '#ece7de', mute: 'rgba(236,231,222,.56)', faint: 'rgba(236,231,222,.30)', line: 'rgba(236,231,222,.10)', accent: '#2f8fd1' };
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const sm = (a, b, x) => { x = clamp((x - a) / (b - a)); return x * x * (3 - 2 * x); };
const SANS = (w, px) => w + ' ' + px + 'px Inter, system-ui, sans-serif';
const MONO = (w, px) => w + ' ' + px + 'px "IBM Plex Mono", ui-monospace, monospace';
function rr(c, x, y, w, h, r) { c.beginPath(); c.roundRect(x, y, w, h, r); }
function brand(c, x0, y0, x1, y1) { const g = c.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, '#5b4fe0'); g.addColorStop(0.5, '#2f8fd1'); g.addColorStop(1, '#1fb8a3'); return g; }
const PAL = [['#2a2166', '#5b4fe0'], ['#0b3a5c', '#2f8fd1'], ['#0a4a48', '#1fb8a3'], ['#3a2c7a', '#b9aeff'], ['#10263f', '#5aa9e0']];

/* ---------- Atlas d'affiches : 5 colonnes × 3 rangées de 256 × 384 ---------- */
export function createAtlas() {
  const CW = 256, CH = 384, COLS = 5, ROWS = 3, PAD = 6;
  const canvas = document.createElement('canvas'); canvas.width = CW * COLS; canvas.height = CH * ROWS;
  const c = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8; texture.generateMipmaps = true; texture.minFilter = THREE.LinearMipmapLinearFilter;
  const atlas = { canvas, texture, count: POSTERS.length, version: 0, real: 0, titles: POSTERS.map((p) => p[0]), types: POSTERS.map((p) => p[2]) };
  const cell = (i) => ({ x: (i % COLS) * CW, y: Math.floor(i / COLS) * CH });
  atlas.cellUv = (i) => { const p = cell(i); const ix = PAD / canvas.width, iy = PAD / canvas.height; return [p.x / canvas.width + ix, 1 - (p.y + CH) / canvas.height + iy, CW / canvas.width - 2 * ix, CH / canvas.height - 2 * iy]; };
  function fallback(i) {
    const p = cell(i), pal = PAL[i % PAL.length], g = c.createLinearGradient(p.x, p.y, p.x + CW, p.y + CH);
    g.addColorStop(0, pal[0]); g.addColorStop(1, pal[1]);
    c.fillStyle = g; c.fillRect(p.x, p.y, CW, CH);
    c.fillStyle = 'rgba(255,255,255,.07)'; c.beginPath(); c.arc(p.x + CW * (0.3 + 0.4 * ((i * 37) % 10) / 10), p.y + CH * 0.34, CW * 0.55, 0, 7); c.fill();
    const v = c.createLinearGradient(0, p.y + CH * 0.5, 0, p.y + CH); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.62)'); c.fillStyle = v; c.fillRect(p.x, p.y, CW, CH);
    c.fillStyle = TOK.text; c.font = SANS(700, 34); c.textBaseline = 'bottom';
    const words = atlas.titles[i].split(' '); let line = '', lines = [];
    for (const w of words) { const t = line ? line + ' ' + w : w; if (c.measureText(t).width > CW - 36 && line) { lines.push(line); line = w; } else line = t; }
    lines.push(line);
    lines.slice(-3).forEach((l, k, a) => c.fillText(l, p.x + 18, p.y + CH - 22 - (a.length - 1 - k) * 40));
  }
  for (let i = 0; i < atlas.count; i++) fallback(i);
  texture.needsUpdate = true;
  atlas.draw = (ctx, i, x, y, w, h, r = 0) => {
    const p = cell(i); ctx.save(); if (r) { rr(ctx, x, y, w, h, r); ctx.clip(); }
    ctx.drawImage(canvas, p.x + PAD, p.y + PAD, CW - 2 * PAD, CH - 2 * PAD, x, y, w, h); ctx.restore();
  };
  let started = false;
  atlas.loadReal = () => {
    if (started) return; started = true;
    POSTERS.forEach((p, i) => {
      const img = new Image(); img.crossOrigin = 'anonymous'; img.decoding = 'async';
      img.onload = () => {
        const q = cell(i), s = Math.max(CW / img.width, CH / img.height), w = img.width * s, h = img.height * s;
        c.save(); c.beginPath(); c.rect(q.x, q.y, CW, CH); c.clip(); c.drawImage(img, q.x + (CW - w) / 2, q.y + (CH - h) / 2, w, h); c.restore();
        texture.needsUpdate = true; atlas.version++; atlas.real++;
      };
      img.src = 'https://image.tmdb.org/t/p/w342' + p[1];
    });
  };
  return atlas;
}

/* ---------- Ordinateur (1792 × 1120) ---------- */
const ROWS = [
  { i: 8, t: 'Severance', m: 'Apple TV · S2 · E7' },
  { i: 1, t: 'Arcane', m: 'Netflix · S2 · E9' },
  { i: 10, t: 'The Bear', m: 'Disney+ · S3 · E10' },
  { i: 6, t: 'Frieren', m: 'Crunchyroll · E28' },
  { i: 9, t: 'The Boys', m: 'Prime Video · S4 · E8' },
];
function logoBars(c, x, y, s, lit) {
  const bars = [[3.5, 12, 7], [10, 8.5, 10.5], [16.5, 4, 14]];
  bars.forEach(([bx, by, bh], k) => { rr(c, x + bx * s, y + by * s, 4 * s, bh * s, 2 * s); c.fillStyle = lit ? brand(c, x, y + 24 * s, x + 24 * s, y) : 'rgba(236,231,222,' + (0.28 + k * 0.1) + ')'; c.fill(); });
}
function browserChrome(c, W, lit, glow) {
  c.fillStyle = '#0a0e17'; c.fillRect(0, 0, W, 64);
  [0, 1, 2].forEach((k) => { c.fillStyle = '#2b3140'; c.beginPath(); c.arc(40 + k * 30, 32, 7, 0, 7); c.fill(); });
  rr(c, W / 2 - 330, 14, 660, 36, 18); c.fillStyle = '#121826'; c.fill();
  c.fillStyle = TOK.faint; c.font = MONO(500, 17); c.textBaseline = 'middle'; c.textAlign = 'center'; c.fillText('lecteur  ·  Severance  ·  S2 · E7', W / 2, 33); c.textAlign = 'left';
  if (glow > 0) { const g = c.createRadialGradient(W - 66, 32, 2, W - 66, 32, 40); g.addColorStop(0, 'rgba(47,143,209,' + 0.55 * glow + ')'); g.addColorStop(1, 'rgba(47,143,209,0)'); c.fillStyle = g; c.fillRect(W - 120, 0, 110, 64); }
  logoBars(c, W - 82, 16, 1.35, lit);
}
function videoStill(c, x, y, w, h, t, dim) {
  const g = c.createRadialGradient(x + w * 0.56, y + h * 0.46, 10, x + w * 0.56, y + h * 0.46, w * 0.75);
  g.addColorStop(0, '#1d3556'); g.addColorStop(0.45, '#0d1830'); g.addColorStop(1, '#04060c'); c.fillStyle = g; c.fillRect(x, y, w, h);
  c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
  const vx = x + w * 0.56, vy = y + h * 0.46;
  for (let k = 0; k < 18; k++) { const a = (k / 18) * Math.PI * 2 + t * 0.02; c.strokeStyle = 'rgba(120,170,255,' + (0.05 + 0.04 * Math.sin(k)) + ')'; c.lineWidth = 2; c.beginPath(); c.moveTo(vx, vy); c.lineTo(vx + Math.cos(a) * w, vy + Math.sin(a) * w); c.stroke(); }
  const dg = c.createLinearGradient(0, vy - 150, 0, vy + 150); dg.addColorStop(0, 'rgba(180,215,255,.0)'); dg.addColorStop(0.5, 'rgba(190,225,255,.55)'); dg.addColorStop(1, 'rgba(180,215,255,0)');
  c.fillStyle = dg; c.fillRect(vx - 34, vy - 150, 68, 300);
  const fog = c.createLinearGradient(0, y + h * 0.6, 0, y + h); fog.addColorStop(0, 'rgba(0,0,0,0)'); fog.addColorStop(1, 'rgba(0,0,0,.6)'); c.fillStyle = fog; c.fillRect(x, y, w, h);
  c.restore();
  c.fillStyle = TOK.text; c.font = SANS(600, 40); c.textBaseline = 'alphabetic'; c.fillText('Severance', x + 48, y + 84);
  c.fillStyle = TOK.mute; c.font = MONO(500, 22); c.fillText('S2 · E7', x + 50, y + 118);
  if (dim) { c.fillStyle = 'rgba(2,4,9,' + dim + ')'; c.fillRect(x, y, w, h); }
}
function mmss(s) { s = Math.round(s); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }
export function drawMonitorPlayer(c, W, H, p, toast, t) {
  c.fillStyle = '#04060b'; c.fillRect(0, 0, W, H);
  const lit = p >= 0.8;
  browserChrome(c, W, lit, lit ? 1 : 0);
  videoStill(c, 0, 64, W, H - 64, t, 0);
  const cb = c.createLinearGradient(0, H - 150, 0, H); cb.addColorStop(0, 'rgba(0,0,0,0)'); cb.addColorStop(1, 'rgba(0,0,0,.82)'); c.fillStyle = cb; c.fillRect(0, H - 150, W, 150);
  c.fillStyle = TOK.text; c.beginPath(); c.moveTo(60, H - 78); c.lineTo(60, H - 42); c.lineTo(88, H - 60); c.closePath(); c.fill();
  const x0 = 130, x1 = W - 210, y = H - 62, w = x1 - x0;
  rr(c, x0, y - 3, w, 6, 3); c.fillStyle = 'rgba(236,231,222,.18)'; c.fill();
  if (p > 0.002) { rr(c, x0, y - 3, w * p, 6, 3); c.fillStyle = brand(c, x0, 0, x1, 0); c.fill(); }
  c.beginPath(); c.arc(x0 + w * p, y, 11, 0, 7); c.fillStyle = '#fff'; c.fill();
  const mx = x0 + w * 0.8; c.fillStyle = lit ? '#1fb8a3' : TOK.faint; c.fillRect(mx - 1, y - 16, 2, 32);
  c.fillStyle = lit ? '#1fb8a3' : TOK.faint; c.font = MONO(500, 17); c.textAlign = 'center'; c.fillText('80 %', mx, y - 26); c.textAlign = 'left';
  c.fillStyle = TOK.mute; c.font = MONO(500, 21); c.fillText(mmss(p * 2512) + ' / 41:52', x1 + 26, y + 8);
  if (toast > 0.01) {
    const ox = (1 - toast) * 90, X = W - 660 + ox, Y = H - 330;
    c.save(); c.globalAlpha = toast; rr(c, X, Y, 600, 150, 26); c.fillStyle = 'rgba(10,15,26,.94)'; c.fill(); c.strokeStyle = 'rgba(47,143,209,.55)'; c.lineWidth = 2; c.stroke();
    c.beginPath(); c.arc(X + 74, Y + 75, 34, 0, 7); c.fillStyle = brand(c, X + 40, Y + 110, X + 108, Y + 40); c.fill();
    c.strokeStyle = '#fff'; c.lineWidth = 7; c.lineCap = 'round'; c.lineJoin = 'round'; c.beginPath(); c.moveTo(X + 58, Y + 76); c.lineTo(X + 70, Y + 89); c.lineTo(X + 92, Y + 62); c.stroke();
    c.fillStyle = TOK.text; c.font = SANS(650, 38); c.fillText('Vu, automatiquement', X + 130, Y + 70);
    c.fillStyle = TOK.mute; c.font = SANS(500, 25); c.fillText('Severance · S2 · E7', X + 130, Y + 112); c.restore();
  }
}
export function drawMonitorList(c, W, H, atlas, rowsF, t) {
  c.fillStyle = '#04060b'; c.fillRect(0, 0, W, H);
  browserChrome(c, W, true, 0.8);
  const vw = Math.round(W * 0.55);
  videoStill(c, 0, 64, vw, H - 64, t, 0.45);
  const X = vw + 36, Y = 100, PW = W - X - 36, PH = H - Y - 40;
  rr(c, X, Y, PW, PH, 30); c.fillStyle = '#0b101c'; c.fill(); c.strokeStyle = 'rgba(47,143,209,.35)'; c.lineWidth = 2; c.stroke();
  c.fillStyle = TOK.text; c.font = SANS(650, 40); c.textBaseline = 'alphabetic'; c.fillText('Détectés', X + 40, Y + 76);
  const n = Math.min(ROWS.length, Math.round(rowsF + 0.4));
  rr(c, X + 232, Y + 42, 54, 42, 21); c.fillStyle = brand(c, X + 232, Y, X + 290, Y + 80); c.fill(); c.fillStyle = '#fff'; c.font = MONO(600, 24); c.textAlign = 'center'; c.fillText(String(n), X + 259, Y + 72); c.textAlign = 'left';
  ROWS.forEach((r, k) => {
    const a = sm(k - 0.1, k + 0.9, rowsF); if (a < 0.01) return;
    const ry = Y + 120 + k * 142 + (1 - a) * 26;
    c.save(); c.globalAlpha = a; rr(c, X + 24, ry, PW - 48, 128, 20); c.fillStyle = '#0f1626'; c.fill();
    atlas.draw(c, r.i, X + 44, ry + 14, 68, 100, 8);
    c.fillStyle = TOK.text; c.font = SANS(600, 32); c.fillText(r.t, X + 134, ry + 58);
    c.fillStyle = TOK.mute; c.font = MONO(500, 20); c.fillText(r.m, X + 134, ry + 94);
    const bw = 138; rr(c, X + PW - 48 - bw - 10, ry + 36, bw, 56, 28); c.fillStyle = brand(c, X, 0, X + PW, 0); c.fill();
    c.fillStyle = '#fff'; c.font = SANS(650, 24); c.textAlign = 'center'; c.fillText('Valider', X + PW - 48 - bw / 2 - 10, ry + 72); c.textAlign = 'left'; c.restore();
  });
}

/* ---------- Tablette (1344 × 1792) ---------- */
function tabletHeader(c, W, title) {
  c.fillStyle = '#070a12'; c.fillRect(0, 0, W, 1792);
  c.fillStyle = TOK.mute; c.font = MONO(500, 26); c.textBaseline = 'alphabetic'; c.fillText('9:41', 70, 70);
  logoBars(c, W - 130, 36, 2.2, true);
  c.fillStyle = TOK.text; c.font = SANS(700, 76); c.fillText(title, 70, 190);
}
function tabletList(c, W, atlas, f) {
  tabletHeader(c, W, 'Ma liste');
  const chips = ['Tous', 'Films', 'Séries', 'Anime'], act = f < 0.2 ? 0 : f < 0.46 ? 1 : f < 0.72 ? 2 : 3, type = [null, 'f', 's', 'a'][act];
  let x = 70; chips.forEach((t, k) => {
    c.font = SANS(600, 34); const w = c.measureText(t).width + 70; rr(c, x, 240, w, 78, 39);
    if (k === act) { c.fillStyle = brand(c, x, 240, x + w, 318); c.fill(); c.fillStyle = '#fff'; } else { c.fillStyle = '#10172a'; c.fill(); c.fillStyle = TOK.mute; }
    c.fillText(t, x + 35, 291); x += w + 18;
  });
  const order = [0, 2, 1, 7, 3, 12, 4, 13, 5, 6, 14, 8], gw = (W - 140 - 2 * 28) / 3, gh = gw * 1.5;
  order.forEach((idx, k) => {
    const col = k % 3, row = Math.floor(k / 3), px = 70 + col * (gw + 28), py = 360 + row * (gh + 28);
    if (py > 1792) return; const on = !type || atlas.types[idx] === type;
    c.save(); c.globalAlpha = on ? 1 : 0.16; atlas.draw(c, idx, px, py, gw, gh, 22);
    if (on && type) { rr(c, px, py, gw, gh, 22); c.strokeStyle = 'rgba(47,143,209,.7)'; c.lineWidth = 4; c.stroke(); } c.restore();
  });
}
function tabletResume(c, W, atlas, f) {
  tabletHeader(c, W, 'Reprendre');
  const X = 70, Y = 250, CW = W - 140;
  rr(c, X, Y, CW, 640, 40); c.fillStyle = '#0d1424'; c.fill(); c.strokeStyle = TOK.line; c.lineWidth = 2; c.stroke();
  atlas.draw(c, 8, X + 36, Y + 36, 372, 568, 24);
  c.fillStyle = TOK.text; c.font = SANS(700, 62); c.fillText('Severance', X + 444, Y + 130);
  c.fillStyle = TOK.mute; c.font = MONO(500, 32); c.fillText('Saison 2 · Épisode 7', X + 446, Y + 186);
  const bx = X + 446, bw = CW - 446 - 56, p = 0.38 + 0.4 * sm(0, 1, f); rr(c, bx, Y + 262, bw, 14, 7); c.fillStyle = 'rgba(236,231,222,.16)'; c.fill();
  rr(c, bx, Y + 262, bw * p, 14, 7); c.fillStyle = brand(c, bx, 0, bx + bw, 0); c.fill();
  c.fillStyle = TOK.mute; c.font = MONO(500, 26); c.fillText(Math.round(p * 100) + ' %  ·  reste 27 min', bx, Y + 328);
  rr(c, bx, Y + 392, 370, 110, 55); c.fillStyle = brand(c, bx, 0, bx + 370, 0); c.fill();
  c.fillStyle = '#fff'; c.font = SANS(700, 42); c.textAlign = 'center'; c.fillText('▶  Reprendre', bx + 185, Y + 462); c.textAlign = 'left';
  c.fillStyle = TOK.text; c.font = SANS(650, 44); c.fillText('Nouveaux épisodes', X, Y + 760);
  [[1, 'Arcane', 'S2 · E10', 'Sorti aujourd’hui'], [9, 'The Boys', 'S4 · E8', 'Sorti hier'], [6, 'Frieren', 'E29', 'Demain']].forEach((r, k) => {
    const ry = Y + 810 + k * 168; rr(c, X, ry, CW, 148, 28); c.fillStyle = '#0d1424'; c.fill(); atlas.draw(c, r[0], X + 22, ry + 16, 76, 116, 10);
    c.fillStyle = TOK.text; c.font = SANS(600, 38); c.fillText(r[1], X + 126, ry + 66); c.fillStyle = TOK.mute; c.font = MONO(500, 26); c.fillText(r[2] + '  ·  ' + r[3], X + 128, ry + 112);
    rr(c, X + CW - 220, ry + 44, 176, 60, 30); c.fillStyle = 'rgba(47,143,209,.18)'; c.fill(); c.fillStyle = '#7fc0f0'; c.font = SANS(650, 26); c.textAlign = 'center'; c.fillText('Nouveau', X + CW - 132, ry + 82); c.textAlign = 'left';
  });
}
function tabletStats(c, W, atlas, f) {
  tabletHeader(c, W, 'Mes chiffres');
  const X = 70, CW = W - 140, k = sm(0, 0.6, f);
  c.fillStyle = brand(c, X, 250, X + 700, 480); c.font = SANS(800, 190); c.fillText(Math.round(1284 * k).toLocaleString('fr-FR'), X, 430);
  c.fillStyle = TOK.mute; c.font = SANS(500, 40); c.fillText('épisodes vus', X + 4, 490);
  [['48', 'titres'], ['612 h', 'de visionnage'], ['+31 %', 'cette année']].forEach((t, i) => {
    const tw = (CW - 2 * 24) / 3, tx = X + i * (tw + 24); rr(c, tx, 540, tw, 190, 30); c.fillStyle = '#0d1424'; c.fill();
    c.fillStyle = TOK.text; c.font = SANS(700, 62); c.fillText(t[0], tx + 30, 640); c.fillStyle = TOK.mute; c.font = MONO(500, 24); c.fillText(t[1], tx + 32, 690);
  });
  const bars = [0.4, 0.55, 0.35, 0.7, 0.62, 0.5, 0.8, 0.66, 0.9, 0.74, 0.95, 0.85], bw = (CW - 11 * 14) / 12;
  bars.forEach((b, i) => { const h = 330 * b * sm(i * 0.04, 0.55 + i * 0.04, f); rr(c, X + i * (bw + 14), 1060 - h, bw, h, 12); c.fillStyle = brand(c, X, 1060 - 330, X, 1060); c.fill(); });
  c.fillStyle = TOK.text; c.font = SANS(650, 44); c.fillText('Pour toi', X, 1180);
  [4, 11, 3, 5].forEach((idx, i) => { const w = (CW - 3 * 24) / 4; atlas.draw(c, idx, X + i * (w + 24), 1220, w, w * 1.5, 22); });
}
export function drawTablet(c, W, H, atlas, s) {
  const i = Math.min(2, Math.floor(s)), f = s - i, draws = [tabletList, tabletResume, tabletStats];
  c.clearRect(0, 0, W, H);
  draws[i](c, W, atlas, f);
  if (i < 2 && f > 0.82) { const a = sm(0.82, 1, f); c.save(); c.globalAlpha = a; draws[i + 1](c, W, atlas, 0); c.restore(); }
}

/* ---------- Téléphone (900 × 1850) ---------- */
function phoneList(c, W, atlas, f) {
  c.fillStyle = '#070a12'; c.fillRect(0, 0, W, 1850);
  c.fillStyle = TOK.text; c.font = SANS(600, 34); c.textBaseline = 'alphabetic'; c.fillText('9:41', 70, 92); c.fillStyle = TOK.mute; c.font = MONO(500, 24); c.textAlign = 'right'; c.fillText('5G', W - 70, 90); c.textAlign = 'left';
  c.fillStyle = TOK.text; c.font = SANS(700, 76); c.fillText('Ma liste', 60, 250);
  const pulse = 0.5 + 0.5 * Math.sin(f * 12);
  rr(c, W - 330, 196, 270, 62, 31); c.fillStyle = 'rgba(31,184,163,' + (0.14 + 0.1 * pulse) + ')'; c.fill(); c.fillStyle = '#5fe0cc'; c.font = SANS(650, 26); c.textAlign = 'center'; c.fillText('✓ Synchronisé', W - 195, 237); c.textAlign = 'left';
  const order = [8, 1, 10, 6, 9, 0, 11, 13, 4, 5], gw = (W - 120 - 24) / 2, gh = gw * 1.5;
  order.forEach((idx, k) => { const px = 60 + (k % 2) * (gw + 24), py = 310 + Math.floor(k / 2) * (gh + 24); if (py < 1850) atlas.draw(c, idx, px, py, gw, gh, 24); });
  const nb = c.createLinearGradient(0, 1620, 0, 1850); nb.addColorStop(0, 'rgba(7,10,18,0)'); nb.addColorStop(0.4, 'rgba(7,10,18,.96)'); c.fillStyle = nb; c.fillRect(0, 1620, W, 230);
  ['Liste', 'Calendrier', 'Stats'].forEach((t, i) => { c.fillStyle = i === 0 ? TOK.text : TOK.faint; c.font = SANS(600, 28); c.textAlign = 'center'; c.fillText(t, 150 + i * 300, 1760); });
  c.textAlign = 'left';
}
function phoneRecap(c, W, atlas, f) {
  const g = c.createLinearGradient(0, 0, W, 1850); g.addColorStop(0, '#1a1260'); g.addColorStop(0.55, '#0b3a6a'); g.addColorStop(1, '#0a5a52'); c.fillStyle = g; c.fillRect(0, 0, W, 1850);
  c.fillStyle = 'rgba(255,255,255,.07)'; c.beginPath(); c.arc(W * 0.8, 380, 420, 0, 7); c.fill();
  c.textBaseline = 'alphabetic'; c.fillStyle = TOK.text; c.font = SANS(800, 52); c.fillText('cin', 70, 190); const w1 = c.measureText('cin').width; c.fillStyle = 'rgba(236,231,222,.66)'; c.fillText('episode', 70 + w1, 190);
  c.fillStyle = TOK.mute; c.font = MONO(500, 28); c.fillText('MON RÉCAP · NOVEMBRE', 70, 270);
  const k = sm(0, 0.7, f); c.fillStyle = '#fff'; c.font = SANS(800, 250); c.fillText(Math.round(1284 * k).toLocaleString('fr-FR'), 60, 640);
  c.fillStyle = TOK.text; c.font = SANS(500, 50); c.fillText('épisodes vus', 70, 710);
  [['48', 'titres'], ['612', 'heures']].forEach((t, i) => { const tx = 70 + i * 360; rr(c, tx, 790, 330, 220, 34); c.fillStyle = 'rgba(255,255,255,.12)'; c.fill(); c.fillStyle = '#fff'; c.font = SANS(750, 100); c.fillText(t[0], tx + 36, 920); c.fillStyle = TOK.mute; c.font = MONO(500, 28); c.fillText(t[1], tx + 38, 972); });
  [[8, -9, 0], [1, 0, -34], [10, 9, 0]].forEach((p, i) => { c.save(); c.translate(130 + i * 240 + 110, 1500 + p[2]); c.rotate(p[1] * Math.PI / 180); atlas.draw(c, p[0], -110, -165, 220, 330, 18); c.restore(); });
  c.fillStyle = TOK.mute; c.font = SANS(500, 30); c.fillText('Tes données restent chez toi.', 70, 1780);
}
export function drawPhone(c, W, H, atlas, s) {
  c.clearRect(0, 0, W, H);
  const a = sm(0.78, 1, s);
  phoneList(c, W, atlas, s);
  if (a > 0.001) { c.save(); c.globalAlpha = a; phoneRecap(c, W, atlas, clamp(s - 1)); c.restore(); }
  c.fillStyle = '#000'; rr(c, W / 2 - 100, 34, 200, 58, 29); c.fill();
}

/* ---------- Écrans prêts à plaquer en 3D ---------- */
export function createScreens(atlas) {
  const mk = (w, h) => { const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h; const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; return { canvas, ctx: canvas.getContext('2d'), tex: t, w, h, key: '' }; };
  const dev = { monitor: mk(1792, 1120), tablet: mk(1344, 1792), phone: mk(900, 1850) };
  const draw = (d, key, fn) => { if (d.key === key) return; d.key = key; fn(d.ctx, d.w, d.h); d.tex.needsUpdate = true; };
  const q = (x, n = 400) => Math.round(x * n);
  return {
    dev,
    monitorPlayer(p, toast, t) { draw(dev.monitor, 'P' + q(p) + '|' + q(toast, 100) + '|' + atlas.version, (c, w, h) => drawMonitorPlayer(c, w, h, p, toast, t)); },
    monitorList(rows, t) { draw(dev.monitor, 'L' + q(rows, 60) + '|' + atlas.version, (c, w, h) => drawMonitorList(c, w, h, atlas, rows, t)); },
    tablet(s) { draw(dev.tablet, 'T' + q(s, 300) + '|' + atlas.version, (c, w, h) => drawTablet(c, w, h, atlas, s)); },
    phone(s) { draw(dev.phone, 'H' + q(s, 300) + '|' + atlas.version, (c, w, h) => drawPhone(c, w, h, atlas, s)); },
  };
}
