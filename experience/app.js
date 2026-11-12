/* Landing 3D de Cinepisode — prototype « voyage dans l'espace ».
   Un seul plan fixe : cinq étapes (ordinateur, extension, tablette, téléphone, compte), reliées par des
   sauts supraluminiques aux couleurs de la marque. Le défilement natif pilote tout :
   - dans une étape, la progression anime l'écran de l'appareil ;
   - entre deux étapes, la tension monte (assombrissement, recul, traînées) puis, passé ~60 %, le saut part
     tout seul (défilement verrouillé, inertie absorbée) ; on peut revenir en arrière avant le seuil.
   Le grand saut tablette ↔ téléphone traverse un tunnel d'affiches qui tournent autour de la caméra. */
import * as THREE from './three/three.module.min.js';
import { EffectComposer } from './three/addons/EffectComposer.js';
import { RenderPass } from './three/addons/RenderPass.js';
import { UnrealBloomPass } from './three/addons/UnrealBloomPass.js';
import { OutputPass } from './three/addons/OutputPass.js';
import { ShaderPass } from './three/addons/ShaderPass.js';
import { RoundedBoxGeometry } from './three/addons/RoundedBoxGeometry.js';
import { RoomEnvironment } from './three/addons/RoomEnvironment.js';
import { STEPS, SETUP, GRAND } from './data.js';
import { createNebula, createDust, createStreaks, PostShader, createPosterSet } from './fx.js';
import { createAtlas, createScreens, drawMonitorPlayer, drawMonitorList, drawTablet, drawPhone } from './screens.js';

const qs = new URLSearchParams(location.search);
const DEBUG = qs.has('debug');
const html = document.documentElement;
const $ = (id) => document.getElementById(id);
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const sm = (a, b, x) => { x = clamp((x - a) / (b - a)); return x * x * (3 - 2 * x); };
const frac = (x) => x - Math.floor(x);
const NS = STEPS.length, LAST = NS - 1;
const ldPct = $('ldPct'), ldBar = $('ldBar');
function setPct(n) { ldPct.textContent = String(Math.round(n)).padStart(3, '0'); ldBar.style.transform = 'scaleX(' + n / 100 + ')'; }
setPct(8);

/* ---------- Textes : un bloc par segment, mot par mot ---------- */
function words(src) {
  let i = 0, em = false, out = '';
  for (const tk of src.split(/(<\/?em>)/)) {
    if (tk === '<em>') { em = true; continue; }
    if (tk === '</em>') { em = false; continue; }
    for (const w of tk.split(/\s+/).filter(Boolean)) out += '<span class="w' + (em ? ' g' : '') + '" style="--i:' + (i++) + '"><span>' + w + '</span></span> ';
  }
  return out;
}
const titles = [];
STEPS.forEach((st, i) => st.segs.forEach((sg, k) => {
  const el = document.createElement('article');
  el.className = 'ttl' + (i === 0 && k === 0 ? ' hero' : ''); el.dataset.step = i; el.dataset.seg = k;
  el.innerHTML = '<p class="ttl-k">' + sg.k + '</p><h2 class="ttl-h">' + words(sg.title) + '</h2><p class="ttl-p">' + sg.phrase + '</p>';
  $('titles').appendChild(el);
  titles.push({ el, step: i, a: sg.a, b: sg.b, phrase: sg.phrase, on: false, ox: 0, oy: 0 });
}));
const joinPills = [];
SETUP.forEach((s, i) => {
  const li = document.createElement('li'); li.innerHTML = '<span class="n">' + (i + 1) + '</span><span class="t"><b>' + s[0] + '</b><i>' + s[1] + '</i></span>';
  $('joinList').appendChild(li); joinPills.push(li);
});

/* ---------- Repli sans scène : écran étroit (version visiteur mobile à part), GPU logiciel / trop lent, WebGL absent ---------- */
let dead = false;
function staticMode(why) {
  dead = true; html.classList.add('static', why); html.classList.remove('booting');
  $('loader').classList.add('done'); $('loader').hidden = true;
  setPct(100);
  window.__xp = Object.assign(window.__xp || {}, { ready: true, static: true, why });
  staticFigures();
}
/* Repli : les mêmes écrans (dessinés en 2D, sans aucun GPU) en vignettes d'appareil à côté de chaque texte */
async function staticFigures() {
  await Promise.race([Promise.all([document.fonts.load('600 40px Inter'), document.fonts.load('500 20px "IBM Plex Mono"')]).catch(() => {}), new Promise((r) => setTimeout(r, 1500))]);
  const atlas = createAtlas();
  const WH = { m: [1792, 1120], t: [1344, 1792], h: [900, 1850] };
  const DRAW = {
    '0-0': ['m', (c, w, h) => drawMonitorPlayer(c, w, h, 0.34, 0, 0)], '0-1': ['m', (c, w, h) => drawMonitorPlayer(c, w, h, 0.8, 1, 0)],
    '1-0': ['m', (c, w, h) => drawMonitorList(c, w, h, atlas, 5, 0)],
    '2-0': ['t', (c, w, h) => drawTablet(c, w, h, atlas, 0.5)], '2-1': ['t', (c, w, h) => drawTablet(c, w, h, atlas, 1.5)], '2-2': ['t', (c, w, h) => drawTablet(c, w, h, atlas, 2.9)],
    '3-0': ['h', (c, w, h) => drawPhone(c, w, h, atlas, 0.4)], '3-1': ['h', (c, w, h) => drawPhone(c, w, h, atlas, 1.95)],
  };
  const figs = [];
  for (const tt of titles) {
    const d = DRAW[tt.step + '-' + tt.el.dataset.seg]; if (!d) continue;
    const [w, h] = WH[d[0]], cv = document.createElement('canvas'); cv.width = w; cv.height = h; cv.className = 'fig fig-' + d[0]; cv.setAttribute('aria-hidden', 'true');
    d[1](cv.getContext('2d'), w, h); tt.el.appendChild(cv); figs.push([cv, d, w, h]);
  }
  const redraw = () => figs.forEach(([cv, d, w, h]) => d[1](cv.getContext('2d'), w, h));
  let loaded = false;
  addEventListener('scroll', () => { if (loaded || scrollY < 10) return; loaded = true; atlas.loadReal(); setTimeout(redraw, 2500); setTimeout(redraw, 6000); }, { passive: true });
}
const FORCE = qs.has('force3d');
if (qs.has('lite') || innerWidth < 820 || (matchMedia('(pointer:coarse)').matches && innerWidth < 1100)) { staticMode('small'); }
else boot().catch((e) => { console.warn('scène indisponible', e); staticMode('nogl'); });

/* Sonde : un GPU « logiciel » (SwiftShader, llvmpipe, Basic Render Driver) rend cette scène à 1-3 i/s.
   Mieux vaut la page en lecture normale que 60 s d'attente puis un écran noir. */
function softwareGpu(gl) {
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    return /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic|mesa offscreen/i.test(name) ? name : '';
  } catch (e) { return ''; }
}

async function boot() {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: $('scene'), antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false });
  } catch (e) { return staticMode('nogl'); }
  const soft = softwareGpu(renderer.getContext());
  if (soft && !FORCE) { renderer.dispose(); return staticMode('soft'); }
  $('scene').addEventListener('webglcontextlost', (e) => { e.preventDefault(); fallback('lost'); });
  function fallback(why) { if (dead) return; try { renderer.dispose(); renderer.forceContextLoss(); } catch (e) { /* déjà perdu */ } staticMode(why); scrollTo(0, 0); }
  setPct(20);
  // les polices ne bloquent jamais plus de 1,2 s
  await Promise.race([Promise.all([document.fonts.load('600 40px Inter'), document.fonts.load('800 40px Inter'), document.fonts.load('500 20px "IBM Plex Mono"')]).catch(() => {}), new Promise((r) => setTimeout(r, 1200))]);
  setPct(40);

  /* ----- Niveaux de qualité : on DÉMARRE au plus léger, on monte seulement si la cadence le permet ----- */
  const TIERS = {
    low: { dpr: 1, samples: 2, post: false, dust: 0.22, streaks: 1400, rings: 48 },
    std: { dpr: 1.5, samples: 2, post: true, dust: 0.5, streaks: 2600, rings: 60 },
    high: { dpr: 2, samples: 4, post: true, dust: 1, streaks: 4200, rings: 72 },
  };
  const TORDER = ['low', 'std', 'high'];
  let tier = TIERS[qs.get('q')] ? qs.get('q') : 'low';
  const tierLocked = !!TIERS[qs.get('q')];

  renderer.setClearColor(0x000000, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x000000, 0.019);
  const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 700);
  scene.add(camera);
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.32;
  pm.dispose();

  const nebula = createNebula(); scene.add(nebula.mesh);
  const dust = createDust(1); scene.add(dust.group);
  const streaks = createStreaks(4200); camera.add(streaks.mesh);
  const atlas = createAtlas();
  const screens = createScreens(atlas);
  setPct(55);

  /* ----- Le monde : tout existe en même temps, très loin les uns des autres. Le brouillard cache ce qui est
     lointain : on découvre chaque appareil en arrivant, jamais avant. ----- */
  const POS = [[0, 0, 0], [0, 0, 0], [62, -24, -96], [-58, 30, -212], [4, -10, -336]];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const key = new THREE.DirectionalLight(0xdfe9ff, 2.4); key.position.set(4, 5, 7);
  const rim = new THREE.DirectionalLight(0x6a5cff, 3.4); rim.position.set(-6, 2, -4);
  const fill = new THREE.DirectionalLight(0x1fb8a3, 1.1); fill.position.set(1, -3, 4);
  scene.add(key, rim, fill);

  function roundedPlane(w, h, r) {
    const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
    s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
    s.lineTo(x + w, y + h - r); s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
    s.lineTo(x + r, y + h); s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
    s.lineTo(x, y + r); s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
    const g = new THREE.ShapeGeometry(s, 6), p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) - x) / w, (p.getY(i) - y) / h);
    return g;
  }
  const dimmables = [];
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x0d1017, metalness: 0.92, roughness: 0.3 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x1a1f2b, metalness: 0.95, roughness: 0.22 });
  dimmables.push({ m: bodyMat, c: bodyMat.color.clone(), e: 1 }, { m: trimMat, c: trimMat.color.clone(), e: 1 });
  const glassTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 128, 128);
    g.addColorStop(0, 'rgba(255,255,255,.085)'); g.addColorStop(0.28, 'rgba(255,255,255,.03)'); g.addColorStop(0.31, 'rgba(255,255,255,.07)'); g.addColorStop(0.36, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const glassMat = new THREE.MeshBasicMaterial({ map: glassTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false });
  const geoCache = {};
  function device(spec, tex) {
    const g = new THREE.Group(), { w, h, bez, depth, rad, srad } = spec, k = [w, h, bez, depth, rad].join();
    const gb = geoCache['b' + k] || (geoCache['b' + k] = new RoundedBoxGeometry(w + 2 * bez, h + 2 * bez, depth, 5, rad));
    const gs = geoCache['s' + k] || (geoCache['s' + k] = roundedPlane(w, h, srad));
    g.add(new THREE.Mesh(gb, bodyMat));
    const sc = new THREE.MeshBasicMaterial({ map: tex }); sc.color.setScalar(1.18);
    dimmables.push({ m: sc, c: sc.color.clone(), e: 0 });
    const screen = new THREE.Mesh(gs, sc); screen.position.z = depth / 2 + 0.003; g.add(screen);
    const glass = new THREE.Mesh(gs, glassMat); glass.position.z = depth / 2 + 0.008; g.add(glass);
    return g;
  }
  const SPEC = { m: { w: 3.84, h: 2.4, bez: 0.07, depth: 0.12, rad: 0.06, srad: 0.02 }, t: { w: 2.4, h: 3.2, bez: 0.12, depth: 0.1, rad: 0.2, srad: 0.09 }, h: { w: 1.6, h: 3.29, bez: 0.085, depth: 0.09, rad: 0.26, srad: 0.17 } };
  const TEX = { m: screens.dev.monitor.tex, t: screens.dev.tablet.tex, h: screens.dev.phone.tex };
  const neckGeo = new RoundedBoxGeometry(0.46, 1.0, 0.1, 3, 0.04), footGeo = new RoundedBoxGeometry(1.9, 0.07, 1.0, 3, 0.03);
  function make(kind, p, ry) {
    const d = device(SPEC[kind], TEX[kind]);
    if (kind === 'm') {
      const neck = new THREE.Mesh(neckGeo, trimMat); neck.position.set(0, -1.72, -0.06); d.add(neck);
      const foot = new THREE.Mesh(footGeo, trimMat); foot.position.set(0, -2.24, 0.1); d.add(foot);
    }
    d.position.set(p[0], p[1], p[2]); d.userData.ry = ry; d.userData.base = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry); d.quaternion.copy(d.userData.base);
    scene.add(d); return d;
  }
  /* un appareil par endroit ; à l'étape 5 les trois sont réunis */
  const monitor = make('m', add(POS[0], [0.7, 0, 0]), -0.12);
  const tablet = make('t', add(POS[2], [0.9, -0.1, 0]), -0.18);
  const phone = make('h', add(POS[3], [0.9, 0, 0]), -0.14);
  const aM = make('m', add(POS[4], [2.5, 0.25, -0.5]), -0.05), aT = make('t', add(POS[4], [5.6, -0.5, 0.8]), -0.4), aH = make('h', add(POS[4], [-0.5, -0.3, 1.5]), 0.3);
  const devList = [monitor, tablet, phone, aM, aT, aH];
  const assembly = [aM, aT, aH];
  setPct(70);

  /* Trajectoires locales de caméra (dans chaque étape) */
  const CAM = [
    (u) => [[-0.1 + 0.5 * u, 0.12 + 0.15 * u, 6.8 - 0.9 * u], [-0.75 + 0.3 * u, 0, 0]],
    (u) => [[-3.4 + 1.2 * u, 0.9 - 0.4 * u, 6.3 - 0.6 * u], [0.9, 0, 0]],
    (u) => [[-0.1 + 0.3 * u, 0.1, 6.6 - 0.6 * u], [-0.2, 0, 0]],
    (u) => [[0, 0.05, 6.5 - 0.8 * u], [-0.1, 0, 0]],
    (u) => [[0.2, 0.35, 11.8 - 1.2 * u], [-0.4 + 0.2 * u, 0, 0]],
  ];
  const ANCHOR = [[-3.1, 0.5, 0], [-1.4, 0.6, 0], [-2.6, 0.4, 0], [-2.2, 0.2, 0], [-4.2, 0.4, 0]];
  const poseOf = (st, u) => { const P = CAM[st](u); return [add(POS[st], P[0]), add(POS[st], P[1])]; };
  /* « détours » du voyage entre deux étapes : on part en arrière, en haut, en bas… avant de plonger vers la suivante */
  const DETOUR = { '0>1': [[0, 5, 17], [-7, 4, 15]], '1>0': [[-7, 4, 15], [0, 5, 17]], '1>2': [[16, 12, 12], [-6, 10, 8]], '2>1': [[-6, 10, 8], [16, 12, 12]], '2>3': [[10, -14, -10], [10, 12, 10]], '3>2': [[10, 12, 10], [10, -14, -10]], '3>4': [[-8, -12, 10], [-6, 8, 12]], '4>3': [[-6, 8, 12], [-8, -12, 10]] };

  /* ----- Affiches : vol vers la liste (étape 2) et tunnel / anneaux (étape 4) ----- */
  const flights = createPosterSet(15, atlas); scene.add(flights.mesh);
  const rings = createPosterSet(72, atlas); scene.add(rings.mesh);

  /* ----- Rendu : passe de base + lueur / passe finale selon le niveau ----- */
  let composer, bloom, post, dpr = 1;
  function buildComposer() {
    const T = TIERS[tier];
    dpr = Math.min(devicePixelRatio || 1, T.dpr);
    renderer.setPixelRatio(dpr); renderer.setSize(innerWidth, innerHeight, false);
    composer?.dispose?.();
    // cible demi-flottante seulement si le GPU sait la rendre ; sinon 8 bits (jamais d'écran noir par cible incomplète)
    const hdr = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
    const rt = new THREE.WebGLRenderTarget(innerWidth * dpr, innerHeight * dpr, { type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType, samples: T.samples });
    composer = new EffectComposer(renderer, rt); composer.setPixelRatio(dpr); composer.setSize(innerWidth, innerHeight);
    composer.addPass(new RenderPass(scene, camera));
    bloom = post = null;
    if (T.post) {
      bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth >> 1, innerHeight >> 1), 0.55, 0.5, 0.9); composer.addPass(bloom);
      post = new ShaderPass(PostShader); post.uniforms.uGrain.value = 0; composer.addPass(post);
    }
    composer.addPass(new OutputPass());
    dust.setDensity(T.dust); streaks.geo.instanceCount = T.streaks;
    html.dataset.tier = tier;
  }
  buildComposer();
  setPct(85);

  /* ----- Défilement : course = somme des étapes + un écran d'écart entre deux étapes ----- */
  let S = [], E = [], G = 1, courseH = 0;
  function layoutScroll() {
    const v = innerHeight; G = v; let y = 0;
    STEPS.forEach((st, i) => { S[i] = y; E[i] = y + st.P * v; y = E[i] + (i < LAST ? G : 0); });
    courseH = E[LAST] + v; $('course').style.height = courseH + 'px';
  }
  layoutScroll();
  history.scrollRestoration = 'manual'; scrollTo(0, 0);

  let cur = 0, ys = 0, t = 0, J = null, lockY = 0, absorbUntil = 0, mx = 0, my = 0, smx = 0, smy = 0, covered = false;
  const ST = { warp: 0, dim: 0, flash: 0, roll: 0, rec: 0, fovAdd: 0, tau: 0, ringAmt: 0, ringM: 0, ringSpd: 0.012, uView: 0, view: 0 };
  const _pa = new THREE.Vector3(), _pb = new THREE.Vector3(), _la = new THREE.Vector3(), _lb = new THREE.Vector3(), _tg = new THREE.Vector3(), _cp = new THREE.Vector3(), _cl = new THREE.Vector3();
  const lastLook = new THREE.Vector3(0, 0, -10);

  /* Saut = voyage continu : une courbe de caméra du point où l'on est jusqu'au début de l'étape visée.
     Pas de coupure : le brouillard fait apparaître la destination. Les traînées suivent la vitesse. */
  function startJump(from, to, o = {}) {
    if (J || dead) return;
    const grand = !REDUCED && GRAND(from, to) && from >= 0;
    const D = REDUCED ? 0.6 : o.intro ? 2.4 : grand ? 3.3 : 1.7;
    const tu = o.scrollU != null ? o.scrollU : to > from ? 0.0176 : 0.982;
    const B = poseOf(to, tu);
    const A = from < 0 ? [add(B[0], [-36, 22, 110]), add(B[1], [0, 0, 0])] : [_pa.copy(camera.position).toArray(), lastLook.toArray()];
    const det = DETOUR[from + '>' + to];
    const pts = [new THREE.Vector3(...A[0])];
    if (from < 0) pts.push(new THREE.Vector3(...add(B[0], [-10, 6, 34])));
    else if (det) { pts.push(new THREE.Vector3(...add(A[0], det[0]))); pts.push(new THREE.Vector3(...add(B[0], det[1]))); }
    else { const m = [(A[0][0] + B[0][0]) / 2 + (to > from ? 14 : -14), (A[0][1] + B[0][1]) / 2 + 12, (A[0][2] + B[0][2]) / 2 + 6]; pts.push(new THREE.Vector3(...m)); }
    pts.push(new THREE.Vector3(...B[0]));
    J = { from, to, dir: to > from ? 1 : -1, grand, D, t: o.t || 0, hold: !!o.hold, cut: false, intro: !!o.intro, targetU: tu,
      curve: new THREE.CatmullRomCurve3(pts, false, 'centripetal'), la: new THREE.Vector3(...A[1]), lb: new THREE.Vector3(...B[1]),
      w0: ST.warp, dim0: ST.dim, rec0: ST.rec, fov0: ST.fovAdd, seed: Math.random(), uFrom: ST.uView };
    lockY = scrollY; streaks.mesh.rotation.z = (J.seed - 0.5) * 0.9;
    if (!o.intro) whoosh(grand);
  }
  function doCut() { /* mi-parcours : on passe à l'étape visée (texte, compteur, position de défilement) */
    J.cut = true; cur = J.to; layoutScroll();
    const ty = Math.round(S[cur] + J.targetU * (E[cur] - S[cur]));
    scrollTo({ top: ty, behavior: 'instant' }); ys = ty; lockY = ty; ST.uView = J.targetU;
    resetTitles();
  }
  function endJump() { J = null; absorbUntil = performance.now() + 360; }

  const locked = () => !dead && (!!J || performance.now() < absorbUntil);
  addEventListener('wheel', (e) => { firstGesture(); if (locked()) e.preventDefault(); }, { passive: false });
  addEventListener('touchmove', (e) => { if (locked()) e.preventDefault(); }, { passive: false });
  addEventListener('touchstart', firstGesture, { passive: true });
  addEventListener('pointerdown', firstGesture, { passive: true });
  addEventListener('keydown', (e) => {
    if (dead) return;
    firstGesture();
    const nav = ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', ' ', 'Home', 'End'];
    if (!nav.includes(e.key) || e.target.closest?.('input,textarea,select,button,a')) return;
    if (covered && e.key !== 'Home') return;
    if (locked()) { e.preventDefault(); return; }
    if (e.key === 'PageDown' || (e.key === ' ' && !e.shiftKey)) { e.preventDefault(); if (cur < LAST) startJump(cur, cur + 1, { scrollU: 0.0176 }); }
    else if (e.key === 'PageUp' || (e.key === ' ' && e.shiftKey)) { e.preventDefault(); if (cur > 0) startJump(cur, cur - 1, { scrollU: 0.0176 }); }
    else if (e.key === 'Home') { e.preventDefault(); goStage(0); }
    else if (e.key === 'End') { e.preventDefault(); goStage(LAST); }
  });
  let gestured = false;
  function firstGesture() { if (gestured) return; gestured = true; atlas.loadReal(); }
  addEventListener('scroll', () => { if (scrollY > 2) firstGesture(); }, { passive: true });
  addEventListener('pointermove', (e) => { mx = (e.clientX / innerWidth) * 2 - 1; my = (e.clientY / innerHeight) * 2 - 1; }, { passive: true });
  function goStage(n) {
    if (J || n === cur) { if (!J && n === cur) scrollTo({ top: S[n] + 2, behavior: 'smooth' }); return; }
    if (covered) scrollTo({ top: 0, behavior: 'instant' });
    startJump(cur, n, { scrollU: 0.0176 });
  }
  document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => goStage(+b.dataset.go)));
  addEventListener('resize', () => {
    if (dead) return;
    const u = clamp((ys - S[cur]) / (E[cur] - S[cur]));
    layoutScroll(); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); buildComposer();
    const ny = Math.round(S[cur] + u * (E[cur] - S[cur])); scrollTo({ top: ny, behavior: 'instant' }); ys = ny;
  });

  /* ----- Son : désactivé par défaut ; ronronnement grave + souffle à chaque saut ----- */
  let ac = null, master = null, soundOn = false;
  function whoosh(grand) {
    if (!soundOn || !ac) return;
    const n = ac.sampleRate * 3.4, b = ac.createBuffer(1, n, ac.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = ac.createBufferSource(); src.buffer = b;
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.9;
    const g = ac.createGain(), T = ac.currentTime, dur = grand ? 3.3 : 1.9;
    bp.frequency.setValueAtTime(220, T); bp.frequency.exponentialRampToValueAtTime(grand ? 3600 : 2600, T + dur * 0.5); bp.frequency.exponentialRampToValueAtTime(260, T + dur);
    g.gain.setValueAtTime(0.0001, T); g.gain.exponentialRampToValueAtTime(0.5, T + dur * 0.5); g.gain.exponentialRampToValueAtTime(0.0001, T + dur);
    src.connect(bp); bp.connect(g); g.connect(master); src.start(T); src.stop(T + dur + 0.1);
  }
  $('soundBtn').addEventListener('click', () => {
    soundOn = !soundOn; const btn = $('soundBtn');
    btn.setAttribute('aria-pressed', String(soundOn)); btn.textContent = soundOn ? 'Son : activé' : 'Son : coupé';
    if (soundOn && !ac) {
      ac = new (window.AudioContext || window.webkitAudioContext)(); master = ac.createGain(); master.gain.value = 0; master.connect(ac.destination);
      [[55, 0.07], [82.4, 0.04], [110.3, 0.022]].forEach(([f, v], i) => { const o = ac.createOscillator(); o.type = i ? 'sine' : 'triangle'; o.frequency.value = f; const g = ac.createGain(); g.gain.value = v; const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420; o.connect(g); g.connect(lp); lp.connect(master); o.start(); });
    }
    if (ac) { ac.resume(); master.gain.setTargetAtTime(soundOn ? 0.55 : 0, ac.currentTime, 0.15); }
  });

  /* ----- Écrans, vols d'affiches, anneaux ----- */
  const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _s = new THREE.Vector3(), _m = new THREE.Matrix4(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _e = new THREE.Euler(), UP = new THREE.Vector3(0, 1, 0);
  const FLIGHT = Array.from({ length: 5 }, (_, i) => ({ s: 0.1 + 0.15 * i, d: 0.2, row: i }));
  function flightTarget(row, out) {
    const px = 1100, py = 284 + 142 * row;
    return monitor.localToWorld(out.set((px / 1792 - 0.5) * 3.84, (0.5 - py / 1120) * 2.4, 0.02));
  }
  function driveScreens(st, u) {
    let rowsF = 0;
    if (st === 0) screens.monitorPlayer(0.12 + 0.68 * sm(0.1, 0.7, u), sm(0.72, 0.8, u), 0);
    else if (st === 1) {
      for (const f of FLIGHT) rowsF += clamp(((u - f.s) / f.d - 0.78) / 0.22);
      screens.monitorList(rowsF, 0);
    } else if (st === 2) {
      const s = u < 0.36 ? u / 0.36 : u < 0.69 ? 1 + (u - 0.36) / 0.33 : 2 + Math.min(0.99, (u - 0.69) / 0.31);
      screens.tablet(s);
    } else if (st === 3) screens.phone(u < 0.5 ? u / 0.5 : 1 + Math.min(1, (u - 0.5) / 0.5));
    else { screens.monitorList(5, 0); screens.tablet(2.97); screens.phone(2); }
  }
  function updateFlights(st, u) {
    monitor.updateWorldMatrix(true, false);
    const mq = monitor.getWorldQuaternion(_q2);
    if (st === 1) {
      const camP = camera.position;
      FLIGHT.forEach((f, i) => {
        for (let g = 0; g < 3; g++) {
          const idx = i * 3 + g, lag = g * 0.014;
          const k = clamp((u - lag - f.s) / f.d);
          if (k <= 0 || k >= 1) { flights.hide(idx); continue; }
          flightTarget(f.row, _v3);
          const ease = 1 - Math.pow(1 - k, 2.2), tj = (i % 2 ? 1 : -1);
          const S0 = _x.set(14 + 3 * i, 3 - 1.2 * i, -34 - 4 * i).applyQuaternion(mq).add(_v3);
          const C0 = _y.set(9, 1.6 * tj, 7).applyQuaternion(mq).add(_v3);
          const a = (1 - ease) * (1 - ease), b = 2 * (1 - ease) * ease, c = ease * ease;
          _v.set(S0.x * a + C0.x * b + _v3.x * c, S0.y * a + C0.y * b + _v3.y * c, S0.z * a + C0.z * b + _v3.z * c);
          _m.lookAt(_v, camP, UP); _q.setFromRotationMatrix(_m);
          _q.slerp(mq, Math.pow(ease, 2));
          const sc = lerp(1.15, 0.146, Math.pow(ease, 0.8)) * (g ? 0.8 : 1);
          flights.set(idx, _v, _q, _s.set(sc, sc, 1), sm(0, 0.1, k) * (1 - sm(0.9, 1, k)) * (g ? 0.5 : 1), 1);
        }
      });
    } else for (let i = 0; i < 15; i++) flights.hide(i);
    flights.commit();
    flights.mat.uniforms.uFocus.value = 8; flights.mat.uniforms.uFogNear.value = 30; flights.mat.uniforms.uFogFar.value = 120;
    flights.mat.uniforms.uBright.value = 1 - ST.dim * 0.7;
  }
  const RING = [{ R: 2.9, w: 0.9, om: 0.55, lo: 0.4, hi: 3.6 }, { R: 4.1, w: 1.1, om: -0.42, lo: -0.5, hi: 6 }, { R: 5.6, w: 1.4, om: 0.34, lo: -1.5, hi: 9 }, { R: 7.4, w: 1.75, om: -0.26, lo: -2.5, hi: 12 }];
  const ringAng = [0, 1.3, 2.1, 0.7]; let ringPhase = 0;
  const hashN = (i) => frac(Math.sin(i * 127.1 + 311.7) * 43758.5453);
  function updateRings(dt) {
    const T = TIERS[tier], m = ST.ringM, amt = ST.ringAmt;
    ringPhase += dt * ST.ringSpd;
    for (let r = 0; r < 4; r++) ringAng[r] += dt * RING[r].om * lerp(1, 0.4, m);
    phone.getWorldPosition(_v2);
    const O = _v3.copy(camera.position).lerp(_v2, m), camQ = camera.quaternion;
    for (let r = 0; r < 4; r++) for (let k = 0; k < 18; k++) {
      const idx = r * 18 + k;
      if (amt < 0.004 || idx >= T.rings) { rings.hide(idx); continue; }
      const th = ringAng[r] + (k / 18) * Math.PI * 2 + r * 0.4;
      const dn = frac(hashN(idx) + ringPhase * (1 + r * 0.06));
      const dT = -8 + dn * 50, dO = RING[r].lo + dn * (RING[r].hi - RING[r].lo) + Math.sin(t * 0.3 + idx) * 0.25;
      const d = lerp(dT, dO, m), R = RING[r].R * lerp(1, 0.9, m);
      const ct = Math.cos(th), stt = Math.sin(th);
      _v.set(R * ct, R * stt, -d).applyQuaternion(camQ).add(O);
      _z.set(-ct * 0.55, -stt * 0.55, 0.83).normalize(); _x.set(-stt, ct, 0); _y.crossVectors(_z, _x).normalize();
      _m.makeBasis(_x, _y, _z); _q.setFromRotationMatrix(_m).premultiply(camQ);
      const edge = sm(0, 0.07, dn) * (1 - sm(0.93, 1, dn));
      const al = amt * edge * sm(-1, 2.5, d) * (1 - sm(34, 44, d)) * (idx % 3 === 0 ? 1 - m * 0.97 : 1);
      const sc = RING[r].w * (0.9 + 0.25 * hashN(idx + 9)) * lerp(1, 0.68, m);
      rings.set(idx, _v, _q, _s.set(sc, sc, 1), al, hashN(idx + 3));
    }
    rings.commit();
    rings.mat.uniforms.uFocus.value = lerp(12, 6.4, m); rings.mat.uniforms.uFocusRange.value = lerp(18, 12, m);
    rings.mat.uniforms.uFogNear.value = 10; rings.mat.uniforms.uFogFar.value = 60;
    rings.mat.uniforms.uGlowPos.value.copy(_v2); rings.mat.uniforms.uGlow.value = m * amt; rings.mat.uniforms.uBright.value = (1 - ST.dim * 0.6) * lerp(1.05, 0.66, m);
  }

  /* ----- Textes ----- */
  const tmpCam = new THREE.PerspectiveCamera(38, 1, 0.1, 700);
  function titleRef(st, vw, vh) {
    tmpCam.aspect = vw / vh; tmpCam.updateProjectionMatrix();
    const P = poseOf(st, 0.5); tmpCam.position.set(...P[0]); tmpCam.lookAt(...P[1]); tmpCam.updateMatrixWorld();
    _v.set(...add(POS[st], ANCHOR[st])).project(tmpCam);
    return [(_v.x * 0.5 + 0.5) * vw, (-_v.y * 0.5 + 0.5) * vh];
  }
  function resetTitles() { for (const tt of titles) { tt.on = false; tt.el.classList.remove('on'); } }
  let lastPhrase = '', phraseT = 0;
  const phraseEl = $('phrase');
  function updateTitles(st, u, visible) {
    let activeP = null;
    const ref = titleRef(st, innerWidth, innerHeight);
    _v.set(...add(POS[st], ANCHOR[st])).project(camera);
    const cx = (_v.x * 0.5 + 0.5) * innerWidth, cy = (-_v.y * 0.5 + 0.5) * innerHeight;
    const ox = REDUCED ? 0 : clamp((cx - ref[0]) * 0.6, -150, 150), oy = REDUCED ? 0 : clamp((cy - ref[1]) * 0.6, -90, 90);
    for (const tt of titles) {
      const act = visible && tt.step === st && u >= tt.a - 0.002 && u < tt.b + (tt.b >= 1 ? 1 : 0);
      if (act !== tt.on) { tt.on = act; tt.el.classList.toggle('on', act); }
      if (act) { activeP = tt.phrase; tt.el.style.transform = 'translate3d(' + ox.toFixed(1) + 'px,' + oy.toFixed(1) + 'px,0)'; }
    }
    if (activeP !== lastPhrase) {
      lastPhrase = activeP; phraseEl.classList.add('out');
      clearTimeout(phraseT); phraseT = setTimeout(() => { phraseEl.textContent = activeP || ''; phraseEl.classList.toggle('out', !activeP); }, 260);
    }
  }
  const joinEl = $('join'), flashEl = $('flash');
  const dots = [...document.querySelectorAll('.dots button')];
  const hud = { st: -1, bar: $('progBar'), n: $('chapN') };
  const hint = $('scrollHint');
  const easeIO = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

  function fxTension(tau) {
    const e = tau / 0.6, e2 = e * e * (3 - 2 * e);
    ST.warp = tau > 0 ? 0.3 * e2 : 0; ST.dim = tau * 0.55; ST.rec = tau * 1.5; ST.fovAdd = tau * 8; ST.roll = 0;
  }

  function update(dt) {
    t += dt;
    smx += (mx - smx) * (1 - Math.exp(-dt * 3)); smy += (my - smy) * (1 - Math.exp(-dt * 3));
    const y = scrollY;
    ys += (y - ys) * (1 - Math.exp(-dt * 9));
    if (Math.abs(y - ys) < 0.3) ys = y;

    /* décision : tension → saut */
    let tau = 0, dir = 0, rawTau = 0;
    if (!J) {
      if (cur < LAST && ys > E[cur]) { tau = (ys - E[cur]) / G; rawTau = (y - E[cur]) / G; dir = 1; }
      else if (cur > 0 && ys < S[cur]) { tau = (S[cur] - ys) / G; rawTau = (S[cur] - y) / G; dir = -1; }
      if (dir && (tau >= 0.6 || rawTau >= 0.95) && !(performance.now() < absorbUntil)) { fxTension(0.6); startJump(cur, cur + dir, {}); tau = 0; }
    } else if (Math.abs(scrollY - lockY) > 1) scrollTo({ top: lockY, behavior: 'instant' });
    if (!J && performance.now() < absorbUntil && Math.abs(scrollY - lockY) > 1) { scrollTo({ top: lockY, behavior: 'instant' }); ys = lockY; }
    if (!J) fxTension(REDUCED ? 0 : Math.min(tau, 0.6));
    ST.tau = tau;

    /* voyage en cours */
    let view = cur, uView = clamp((ys - S[cur]) / (E[cur] - S[cur]));
    let titleVis = !J && tau < 0.1, camMode = 'pose', s = 0;
    if (J) {
      if (!J.hold) J.t += dt;
      s = clamp(J.t / J.D);
      const mid = 0.5;
      if (s >= mid && !J.cut) doCut();
      view = J.cut ? cur : J.from; uView = J.cut ? ST.uView : J.uFrom;
      camMode = REDUCED ? 'pose' : 'travel';
      if (REDUCED) { view = J.cut ? cur : J.from; ST.warp = 0; ST.dim = Math.sin(Math.PI * s); ST.fovAdd = 0; ST.rec = 0; }
      else {
        const bell = Math.sin(Math.PI * s);
        ST.warp = Math.max(J.w0 * (1 - s), Math.pow(bell, 1.25));
        ST.dim = Math.max(J.dim0 * (1 - s * 2), 0.0) + 0.78 * Math.pow(bell, 1.6) * 0.5;
        ST.rec = J.rec0 * (1 - sm(0, 0.35, s)); ST.fovAdd = lerp(J.fov0, 0, s) + 22 * Math.pow(bell, 1.4);
        ST.roll = J.grand ? J.dir * 0.105 * bell : 0;
      }
      ST.flash = Math.pow(sm(0.38, 0.5, s) * (1 - sm(0.5, 0.64, s)), 1.4) * 0.1;
      titleVis = s > 0.8;
      if (s >= 1) { ST.warp = ST.dim = ST.fovAdd = ST.rec = ST.flash = ST.roll = 0; endJump(); camMode = 'pose'; }
    } else { ST.flash = 0; ST.roll *= 0.9; }
    ST.uView = uView; ST.view = view;

    /* anneaux : tunnel pendant le grand saut, orbite autour du téléphone à l'étape 4 */
    let amtT = 0, mT = 0, spdT = 0.012;
    if (!REDUCED) {
      if (J && J.grand) {
        const bell = Math.sin(Math.PI * s);
        spdT = 0.02 + 0.88 * Math.pow(bell, 1.2);
        if (J.to === 3) { amtT = sm(0.08, 0.32, s); mT = sm(0.6, 1, s); } else { amtT = 1 - sm(0.78, 0.98, s); mT = 0; }
      } else if (cur === 3 && !J) { amtT = 1; mT = 1; }
      else if (J && J.from === 3 && !J.grand) { amtT = 1 - sm(0, 0.5, s); mT = 1; }
    }
    const kA = 1 - Math.exp(-dt * (amtT > ST.ringAmt ? 2.5 : 3.5)), kM = 1 - Math.exp(-dt * 2.2), kS = 1 - Math.exp(-dt * 3);
    ST.ringAmt += (amtT - ST.ringAmt) * kA; ST.ringM += (mT - ST.ringM) * kM; ST.ringSpd += (spdT - ST.ringSpd) * kS;

    /* caméra */
    const par = REDUCED ? 0 : 1;
    if (camMode === 'travel' && J) {
      const e = easeIO(s);
      J.curve.getPointAt(e, _cp);
      J.curve.getTangentAt(Math.min(0.999, e), _tg);
      const Pb = poseOf(J.to, J.targetU);
      const sL = easeIO(clamp((s - 0.15) / 0.8));
      _cl.copy(J.la).lerp(Pb[1] && _lb.set(...Pb[1]), sL);
      _cl.lerp(_v.copy(_cp).addScaledVector(_tg, 18), Math.sin(Math.PI * s) * 0.75);
      camera.position.copy(_cp); camera.lookAt(_cl); lastLook.copy(_cl);
    } else if (view >= 0) {
      const Pz = poseOf(view, uView);
      _v.set(...Pz[0]); _v2.set(...Pz[1]);
      _v3.copy(_v2).sub(_v).normalize();
      _v.x += smx * 0.32 * par + Math.sin(t * 0.23) * 0.05 * par; _v.y += -smy * 0.2 * par + Math.sin(t * 0.31 + 1) * 0.035 * par;
      _v.addScaledVector(_v3, -ST.rec);
      camera.position.copy(_v); camera.lookAt(_v2); lastLook.copy(_v2);
    }
    camera.rotateZ(ST.roll + (REDUCED ? 0 : smx * 0.012));
    const fov = 38 + ST.fovAdd; if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld();

    /* appareils : léger flottement + visibilité par distance */
    for (let i = 0; i < devList.length; i++) {
      const d = devList[i], near = d.position.distanceTo(camera.position) < 140;
      d.visible = near && (i < 3 || view === 4 || (J && J.to === 4));
      if (!d.visible) continue;
      _e.set(Math.sin(t * 0.4 + i) * 0.012 + smy * 0.018 * par, smx * 0.05 * par + (uView - 0.5) * 0.06 * par, 0);
      d.quaternion.copy(d.userData.base).multiply(_q.setFromEuler(_e));
    }
    if (ST.dimK !== ST.dim) { ST.dimK = ST.dim; dimmables.forEach((d) => { d.m.color.copy(d.c).multiplyScalar(1 - ST.dim * 0.9); if (d.e) d.m.envMapIntensity = 1 - ST.dim * 0.8; }); }
    nebula.mesh.position.copy(camera.position); nebula.mesh.rotation.y = (J ? J.from + (J.to - J.from) * easeIO(s) : cur) * 0.7 + t * 0.003; nebula.setAmt(1 - ST.dim * 0.5);

    const dstage = J && J.cut ? cur : view;
    if (dstage >= 0 && dstage < NS) driveScreens(dstage, uView);
    updateFlights(dstage, uView);
    updateRings(dt);

    /* traînées, passe finale, lueur */
    const px = dpr * innerHeight / (2 * Math.tan((camera.fov * Math.PI) / 360));
    dust.update(camera.position, t, px);
    streaks.mat.uniforms.uTravel.value += dt * (2 + 46 * ST.warp);
    streaks.mat.uniforms.uWarp.value = ST.warp; streaks.mat.uniforms.uAlpha.value = clamp(ST.warp * 1.7 - 0.02);
    if (post) { post.uniforms.uWarp.value = ST.warp; post.uniforms.uFlash.value = ST.flash; post.uniforms.uTime.value = t; post.uniforms.uAspect.value = innerWidth / innerHeight; }
    if (bloom) bloom.strength = 0.55 + 0.2 * ST.warp + ST.flash * 0.45;
    flashEl.style.opacity = post ? 0 : (ST.flash * 0.6).toFixed(3);

    /* textes, bouton « Créer un compte », compteur */
    updateTitles(view >= 0 ? view : 0, uView, titleVis && view >= 0 && !covered);
    const showJoin = cur === LAST && !J && tau < 0.1 && !covered;
    joinEl.classList.toggle('on', showJoin);
    if (showJoin) {
      joinPills.forEach((li, i) => li.classList.toggle('on', uView > [0.1, 0.3, 0.5][i]));
      joinEl.classList.toggle('cta-on', uView > 0.6);
    }
    joinEl.style.opacity = covered ? 0 : '';
    if (hud.st !== cur) { hud.st = cur; hud.n.textContent = String(cur + 1).padStart(2, '0'); dots.forEach((b, i) => b.setAttribute('aria-current', i === cur ? 'step' : 'false')); }
    hud.bar.style.transform = 'scaleX(' + clamp(ys / Math.max(1, courseH - innerHeight)).toFixed(4) + ')';
    if (ys > 40) hint.classList.add('gone'); else hint.classList.remove('gone');
    html.classList.toggle('past', covered);
  }

  /* ----- Cadence : démarrage léger, montée de niveau seulement si la machine suit, repli si elle peine ----- */
  let total = 0, frames = 0, accT = 0, acc = 0, fps = 60, last = performance.now(), hidden = document.hidden, paused = false, lastChange = 0, slowWin = 0, born = performance.now();
  document.addEventListener('visibilitychange', () => { hidden = document.hidden; last = performance.now(); });
  const dbg = DEBUG ? Object.assign(document.body.appendChild(document.createElement('pre')), { id: 'dbg' }) : null;
  function updateCovered() { covered = scrollY >= courseH + 0.22 * innerHeight; }
  const WIN = 45;
  function adapt(avgMs) {
    if (tierLocked || FORCE) return;
    const i = TORDER.indexOf(tier), now = performance.now();
    if (now - lastChange < 2500) return;
    if (avgMs > 38 && i > 0) { tier = TORDER[i - 1]; lastChange = now; buildComposer(); slowWin = 0; }
    else if (avgMs > 55 && i === 0) { if (++slowWin >= 3) fallback('slow'); }
    else if (avgMs < 13.5 && i < 2) { tier = TORDER[i + 1]; lastChange = now; buildComposer(); }
    else if (avgMs <= 38) slowWin = 0;
  }
  function tick(now) {
    if (dead) return;
    requestAnimationFrame(tick);
    const dt = Math.min(0.05, (now - last) / 1000), raw = now - last; last = now;
    if (hidden || paused) return;
    updateCovered();
    if (covered) { if (!tick.wasCovered) update(dt); tick.wasCovered = true; return; }
    tick.wasCovered = false;
    update(dt); composer.render(dt); total++;
    if (raw < 500) { acc += raw; frames++; accT += dt; }
    if (frames >= WIN) { fps = (frames * 1000) / acc; adapt(acc / frames); frames = 0; acc = 0; accT = 0; }
    if (dbg) dbg.textContent = fps.toFixed(0) + ' i/s · ' + tier + ' · étape ' + (cur + 1) + ' · u ' + ST.uView.toFixed(2) + ' · τ ' + ST.tau.toFixed(2) + (J ? ' · saut ' + (J.t / J.D).toFixed(2) : '') + '\n' + renderer.info.render.calls + ' appels · ' + (renderer.info.render.triangles / 1000).toFixed(0) + ' k tri';
  }

  /* ----- Premier plan : pas d'attente, le décor existe déjà ; saut d'ouverture vers le premier appareil ----- */
  update(0.016); composer.render(0.016);
  setPct(100);
  $('loader').classList.add('done'); html.classList.remove('booting');
  cur = 0; layoutScroll(); startJump(-1, 0, { intro: true });
  window.__xp = {
    ready: true, static: false,
    get state() { return { cur, u: ST.uView, tau: ST.tau, jump: J ? { t: J.t / J.D, from: J.from, to: J.to, grand: J.grand, cut: J.cut } : null, tier, y: scrollY, S: S.slice(), E: E.slice(), courseH }; },
    get p() { return clamp(ys / Math.max(1, courseH - innerHeight)); },
    sim(sec) { for (let i = 0; i < Math.round(sec * 30); i++) update(1 / 30); composer.render(0.016); },
    goto(st, u = 0.5) {
      J = null; cur = st; layoutScroll();
      const ty = Math.round(S[st] + u * (E[st] - S[st])); scrollTo({ top: ty, behavior: 'instant' }); ys = ty; lockY = ty; absorbUntil = 0;
      Object.assign(ST, { warp: 0, dim: 0, flash: 0, roll: 0, rec: 0, fovAdd: 0, ringAmt: st === 3 ? 1 : 0, ringM: st === 3 ? 1 : 0 });
      resetTitles(); this.sim(1.2);
    },
    jumpAt(from, to, s) { this.goto(from, to > from ? 1 : 0); ST.uView = to > from ? 1 : 0; startJump(from, to, { hold: true, t: 0 }); J.t = s * J.D; this.sim(1.0); },
    release() { if (J) J.hold = false; },
    jump(to) { startJump(cur, to, {}); },
    pause(b) { paused = b; },
    render() { composer.render(0.016); },
    setTier(n) { tier = n; buildComposer(); },
    fallback,
    dbg: { scene, camera, monitor, tablet, phone, bloom: () => bloom, post: () => post, ST },
  };
  requestAnimationFrame((n) => { last = n; born = n; tick(n); });
  /* garde-fou : si au bout de ~6 s la scène n'a pas rendu au moins 12 images (GPU trop lent ou bloqué), lecture normale */
  if (!FORCE) setTimeout(() => { if (!dead && !hidden && total < 12) fallback('slow'); }, 6500);
}
