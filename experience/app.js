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
import { createAtlas, createScreens } from './screens.js';

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

/* ---------- Repli sans scène : écran étroit (version visiteur mobile à part) ou WebGL absent ---------- */
function staticMode(why) {
  html.classList.add('static', why); html.classList.remove('booting');
  $('loader').classList.add('done'); $('loader').hidden = true;
  setPct(100);
  window.__xp = { ready: true, static: true };
}
if (innerWidth < 820 || matchMedia('(pointer:coarse)').matches && innerWidth < 1100) { staticMode('small'); }
else boot().catch((e) => { console.warn('scène indisponible', e); staticMode('nogl'); });

async function boot() {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: $('scene'), antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false });
  } catch (e) { return staticMode('nogl'); }
  setPct(14);
  await Promise.all([document.fonts.load('600 40px Inter'), document.fonts.load('800 40px Inter'), document.fonts.load('500 20px "IBM Plex Mono"'), document.fonts.ready]).catch(() => {});
  setPct(30);

  /* ----- Niveaux de qualité : on part du maximum, on ne descend que si la cadence reste sous ~50 i/s ----- */
  const TIERS = { max: { dpr: 2, samples: 4, dust: 1, streaks: 4200, rings: 72 }, high: { dpr: 1.5, samples: 4, dust: 0.7, streaks: 3200, rings: 72 }, std: { dpr: 1, samples: 0, dust: 0.4, streaks: 2000, rings: 48 } };
  let tier = TIERS[qs.get('q')] ? qs.get('q') : 'max';
  const tierLocked = !!TIERS[qs.get('q')];

  renderer.setClearColor(0x000000, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 700);
  scene.add(camera);
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.32;

  const nebula = createNebula(); scene.add(nebula.mesh);
  const dust = createDust(1); scene.add(dust.group);
  const streaks = createStreaks(4200); camera.add(streaks.mesh);
  const atlas = createAtlas();
  const screens = createScreens(atlas);
  setPct(42);

  /* ----- Repères : chaque étape a son propre décor (origine + orientation) ----- */
  const FR = [
    { o: [0, 0, 0], yaw: 0, pitch: 0 }, { o: [60, 8, -40], yaw: 0.9, pitch: 0.12 }, { o: [-70, -6, -90], yaw: -1.25, pitch: -0.18 },
    { o: [30, 14, -150], yaw: 2.3, pitch: 0.1 }, { o: [-40, 2, -210], yaw: -2.55, pitch: 0.22 },
  ].map((f) => ({ o: new THREE.Vector3(...f.o), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(f.pitch, f.yaw, 0, 'YXZ')) }));
  const W = (st, v, out = new THREE.Vector3()) => out.set(v[0], v[1], v[2]).applyQuaternion(FR[st].q).add(FR[st].o);

  /* ----- Lumières (suivent le repère de l'étape) ----- */
  const rig = new THREE.Group(); scene.add(rig);
  const key = new THREE.DirectionalLight(0xdfe9ff, 2.4); key.position.set(4, 5, 7);
  const rim = new THREE.DirectionalLight(0x6a5cff, 3.4); rim.position.set(-6, 2, -4);
  const fill = new THREE.PointLight(0x1fb8a3, 22, 20, 2); fill.position.set(1, -2.6, 4);
  const tgt = new THREE.Object3D(); rig.add(key, rim, fill, tgt); key.target = tgt; rim.target = tgt;

  /* ----- Appareils : formes PBR provisoires (remplaçables par des modèles GLB, voir brief) ----- */
  function roundedPlane(w, h, r) {
    const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
    s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
    s.lineTo(x + w, y + h - r); s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
    s.lineTo(x + r, y + h); s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
    s.lineTo(x, y + r); s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
    const g = new THREE.ShapeGeometry(s, 8), p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) - x) / w, (p.getY(i) - y) / h);
    return g;
  }
  const dimmables = [];
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x0d1017, metalness: 0.92, roughness: 0.3 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x1a1f2b, metalness: 0.95, roughness: 0.22 });
  dimmables.push({ m: bodyMat, c: bodyMat.color.clone(), e: 1 }, { m: trimMat, c: trimMat.color.clone(), e: 1 });
  /* Reflet de vitre : dégradé en diagonale dessiné une fois (pas de réflexion d'environnement, qui ferait
     « bloomer » tout l'écran) */
  const glassTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 256, 256);
    g.addColorStop(0, 'rgba(255,255,255,.085)'); g.addColorStop(0.28, 'rgba(255,255,255,.03)'); g.addColorStop(0.31, 'rgba(255,255,255,.07)'); g.addColorStop(0.36, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const glassMat = new THREE.MeshBasicMaterial({ map: glassTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  function device(spec, tex) {
    const g = new THREE.Group(), { w, h, bez, depth, rad, srad } = spec;
    g.add(new THREE.Mesh(new RoundedBoxGeometry(w + 2 * bez, h + 2 * bez, depth, 6, rad), bodyMat));
    const sc = new THREE.MeshBasicMaterial({ map: tex });
    sc.color.setScalar(1.18);
    dimmables.push({ m: sc, c: sc.color.clone(), e: 0 });
    const screen = new THREE.Mesh(roundedPlane(w, h, srad), sc); screen.position.z = depth / 2 + 0.003; g.add(screen);
    const glass = new THREE.Mesh(roundedPlane(w, h, srad), glassMat);
    glass.position.z = depth / 2 + 0.008; g.add(glass);
    g.userData.screen = screen;
    return g;
  }
  const monitor = device({ w: 3.84, h: 2.4, bez: 0.07, depth: 0.12, rad: 0.06, srad: 0.02 }, screens.dev.monitor.tex);
  const neck = new THREE.Mesh(new RoundedBoxGeometry(0.46, 1.0, 0.1, 4, 0.04), trimMat); neck.position.set(0, -1.72, -0.06); monitor.add(neck);
  const foot = new THREE.Mesh(new RoundedBoxGeometry(1.9, 0.07, 1.0, 4, 0.03), trimMat); foot.position.set(0, -2.24, 0.1); monitor.add(foot);
  const tablet = device({ w: 2.4, h: 3.2, bez: 0.12, depth: 0.1, rad: 0.2, srad: 0.09 }, screens.dev.tablet.tex);
  const phone = device({ w: 1.6, h: 3.29, bez: 0.085, depth: 0.09, rad: 0.26, srad: 0.17 }, screens.dev.phone.tex);
  const devs = { m: monitor, t: tablet, h: phone };
  const devGroup = new THREE.Group(); devGroup.add(monitor, tablet, phone); scene.add(devGroup);
  const glowLight = new THREE.PointLight(0x4aa8ff, 0, 14, 2); scene.add(glowLight);

  /* Poses locales de chaque appareil selon l'étape */
  const LAYOUT = [
    { m: { p: [1.0, 0, 0], ry: -0.12 } },
    { m: { p: [1.0, 0, 0], ry: -0.1 } },
    { t: { p: [0.9, -0.1, 0], ry: -0.18 } },
    { h: { p: [0.9, 0, 0], ry: -0.14 } },
    { m: { p: [2.5, 0.25, -0.5], ry: -0.05 }, t: { p: [5.6, -0.5, 0.8], ry: -0.4 }, h: { p: [-0.5, -0.3, 1.5], ry: 0.3 } },
  ];
  const baseRy = {};
  function layoutDevices(st) {
    for (const k in devs) devs[k].visible = false;
    if (st < 0) return;
    const L = LAYOUT[st];
    rig.position.copy(FR[st].o); rig.quaternion.copy(FR[st].q);
    for (const k in L) {
      const d = devs[k]; d.visible = true;
      W(st, L[k].p, d.position); baseRy[k] = L[k].ry;
      d.quaternion.copy(FR[st].q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), L[k].ry));
      d.userData.base = d.quaternion.clone();
    }
    glowLight.position.copy(W(st, st === 4 ? [0, 0, 3] : [LAYOUT[st].m ? 1 : 0.9, 0, 3.4]));
  }

  /* ----- Trajectoires de caméra par étape (repère local) ----- */
  const CAM = [
    (u) => [[-0.1 + 0.5 * u, 0.12 + 0.15 * u, 6.8 - 0.9 * u], [-0.85 + 0.3 * u, 0, 0]],
    (u) => [[-3.4 + 1.2 * u, 0.9 - 0.4 * u, 6.3 - 0.6 * u], [0.9, 0, 0]],
    (u) => [[-0.1 + 0.3 * u, 0.1, 6.6 - 0.6 * u], [-0.2, 0, 0]],
    (u) => [[0, 0.05, 6.5 - 0.8 * u], [-0.1, 0, 0]],
    (u) => [[0.4, 0.35, 11.8 - 1.2 * u], [0.9 + 0.2 * u, 0, 0]],
  ];
  const ANCHOR = [[-3.1, 0.5, 0], [-1.4, 0.6, 0], [-2.6, 0.4, 0], [-2.2, 0.2, 0], [-4.2, 0.4, 0]];

  /* ----- Affiches : vol vers la liste (étape 2) et tunnel / anneaux (étape 4) ----- */
  const flights = createPosterSet(15, atlas); scene.add(flights.mesh);
  const rings = createPosterSet(72, atlas); scene.add(rings.mesh);
  setPct(58);

  /* ----- Rendu : cible demi-flottante multi-échantillonnée → lueur → passe finale → ton ----- */
  let composer, bloom, post, dpr = 1;
  function buildComposer() {
    const T = TIERS[tier];
    dpr = Math.min(devicePixelRatio || 1, T.dpr);
    renderer.setPixelRatio(dpr); renderer.setSize(innerWidth, innerHeight, false);
    composer?.dispose?.();
    const rt = new THREE.WebGLRenderTarget(innerWidth * dpr, innerHeight * dpr, { type: THREE.HalfFloatType, samples: T.samples });
    composer = new EffectComposer(renderer, rt); composer.setPixelRatio(dpr); composer.setSize(innerWidth, innerHeight);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.5, 0.9); composer.addPass(bloom);
    post = new ShaderPass(PostShader); composer.addPass(post);
    composer.addPass(new OutputPass());
    dust.setDensity(T.dust); streaks.geo.instanceCount = T.streaks;
  }
  buildComposer();
  setPct(70);
  try { await renderer.compileAsync(scene, camera); } catch (e) { /* compilation à la première image */ }
  setPct(84);

  /* ----- Défilement : course = somme des étapes + un écran d'écart entre deux étapes ----- */
  let S = [], E = [], G = 1, courseH = 0;
  function layoutScroll() {
    const v = innerHeight; G = v; let y = 0;
    STEPS.forEach((st, i) => { S[i] = y; E[i] = y + st.P * v; y = E[i] + (i < LAST ? G : 0); });
    courseH = E[LAST] + v; $('course').style.height = courseH + 'px';
  }
  layoutScroll();
  history.scrollRestoration = 'manual'; scrollTo(0, 0);

  let cur = 0, ys = 0, t = 0, J = null, lockY = 0, absorbUntil = 0, mx = 0, my = 0, smx = 0, smy = 0, covered = false, over = 0;
  const ST = { warp: 0, dim: 0, flash: 0, roll: 0, rec: 0, dolly: 0, fovAdd: 0, tau: 0, ringAmt: 0, ringM: 0, ringSpd: 0.012, uView: 0, view: 0 };

  /* Saut : pré-coupure (traînées, recul, tension) → coupure (flash, décor change) → arrivée (décélération) */
  function startJump(from, to, o = {}) {
    if (J) return;
    const grand = !REDUCED && GRAND(from, to) && from >= 0;
    J = { from, to, dir: to > from ? 1 : -1, grand, D: REDUCED ? 0.55 : o.intro ? 1.9 : grand ? 2.6 : 1.05, jc: REDUCED ? 0.5 : o.intro ? 0.2 : grand ? 0.66 : 0.58, t: o.t || 0, hold: !!o.hold, cut: false, intro: !!o.intro,
      w0: ST.warp, dim0: ST.dim, rec0: ST.rec, fov0: ST.fovAdd, seed: Math.random(), uFrom: ST.uView, anchorScroll: o.scrollU };
    lockY = scrollY; streaks.mesh.rotation.z = (J.seed - 0.5) * 0.9;
    if (!o.intro) whoosh(grand);
  }
  function doCut() {
    J.cut = true; cur = J.to; layoutDevices(cur); layoutScroll();
    const targetU = J.anchorScroll != null ? J.anchorScroll : J.dir > 0 ? 0.0176 : 0.982;
    const ty = Math.round(S[cur] + targetU * (E[cur] - S[cur]));
    scrollTo({ top: ty, behavior: 'instant' }); ys = ty; lockY = ty; ST.uView = targetU;
    resetTitles();
  }
  function endJump() { J = null; absorbUntil = performance.now() + 360; }

  const locked = () => !!J || performance.now() < absorbUntil;
  addEventListener('wheel', (e) => { firstGesture(); if (locked()) e.preventDefault(); }, { passive: false });
  addEventListener('touchmove', (e) => { if (locked()) e.preventDefault(); }, { passive: false });
  addEventListener('touchstart', firstGesture, { passive: true });
  addEventListener('pointerdown', firstGesture, { passive: true });
  addEventListener('keydown', (e) => {
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
    const u = clamp((ys - S[cur]) / (E[cur] - S[cur]));
    layoutScroll(); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); buildComposer();
    const ny = Math.round(S[cur] + u * (E[cur] - S[cur])); scrollTo({ top: ny, behavior: 'instant' }); ys = ny;
  });

  /* ----- Son : désactivé par défaut ; ronronnement grave + souffle à chaque saut ----- */
  let ac = null, master = null, soundOn = false;
  function whoosh(grand) {
    if (!soundOn || !ac) return;
    const n = ac.sampleRate * 2.8, b = ac.createBuffer(1, n, ac.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = ac.createBufferSource(); src.buffer = b;
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.9;
    const g = ac.createGain(), T = ac.currentTime, dur = grand ? 2.6 : 1.1;
    bp.frequency.setValueAtTime(220, T); bp.frequency.exponentialRampToValueAtTime(grand ? 3600 : 2600, T + dur * 0.62); bp.frequency.exponentialRampToValueAtTime(260, T + dur);
    g.gain.setValueAtTime(0.0001, T); g.gain.exponentialRampToValueAtTime(0.5, T + dur * 0.6); g.gain.exponentialRampToValueAtTime(0.0001, T + dur);
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
  const mkv = () => new THREE.Vector3(), mkq = () => new THREE.Quaternion();
  const _v = mkv(), _v2 = mkv(), _v3 = mkv(), _q = mkq(), _q2 = mkq(), _s = mkv(), _m = new THREE.Matrix4(), _x = mkv(), _y = mkv(), _z = mkv();
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
    let n = 0;
    if (st === 1 && monitor.visible) {
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
          _m.lookAt(_v, camP, new THREE.Vector3(0, 1, 0)); _q.setFromRotationMatrix(_m);
          _q.slerp(mq, Math.pow(ease, 2));
          const sc = lerp(1.15, 0.146, Math.pow(ease, 0.8)) * (g ? 0.8 : 1);
          flights.set(idx, _v, _q, _s.set(sc, sc, 1), sm(0, 0.1, k) * (1 - sm(0.9, 1, k)) * (g ? 0.5 : 1), 1);
          n++;
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
    const T = TIERS[tier];
    const m = ST.ringM, amt = ST.ringAmt;
    ringPhase += dt * ST.ringSpd;
    for (let r = 0; r < 4; r++) ringAng[r] += dt * RING[r].om * lerp(1, 0.4, m);
    phone.getWorldPosition(_v2);
    const O = _v3.copy(camera.position).lerp(_v2, m);
    const camQ = camera.quaternion;
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

  /* ----- Boucle ----- */
  const tmpCam = new THREE.PerspectiveCamera(38, 1, 0.1, 700);
  const ttlRef = [];
  function titleRef(st, vw, vh) {
    tmpCam.aspect = vw / vh; tmpCam.fov = 38; tmpCam.updateProjectionMatrix();
    const P = CAM[st](0.5); W(st, P[0], tmpCam.position); tmpCam.lookAt(W(st, P[1], _v)); tmpCam.updateMatrixWorld();
    _v.copy(W(st, ANCHOR[st], _v2)).project(tmpCam);
    return [(_v.x * 0.5 + 0.5) * vw, (-_v.y * 0.5 + 0.5) * vh];
  }
  function resetTitles() { for (const tt of titles) { tt.on = false; tt.el.classList.remove('on'); } }
  let lastPhrase = '', phraseT = 0;
  const phraseEl = $('phrase');
  function updateTitles(st, u, visible) {
    let activeP = null;
    const ref = titleRef(st, innerWidth, innerHeight);
    _v.copy(W(st, ANCHOR[st], _v2)).project(camera);
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
  const joinEl = $('join');
  const dots = [...document.querySelectorAll('.dots button')];
  const hud = { st: -1, bar: $('progBar'), n: $('chapN') };
  const hint = $('scrollHint');

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
      if (dir && (tau >= 0.6 || rawTau >= 0.95) && !(performance.now() < absorbUntil)) { ST.tau = Math.min(tau, 0.6); fxTension(ST.tau, true); startJump(cur, cur + dir, {}); tau = 0; }
    } else if (locked()) { if (Math.abs(scrollY - lockY) > 1) scrollTo({ top: lockY, behavior: 'instant' }); }
    if (!J && performance.now() < absorbUntil && Math.abs(scrollY - lockY) > 1) { scrollTo({ top: lockY, behavior: 'instant' }); ys = lockY; }
    if (!J) fxTension(REDUCED ? 0 : Math.min(tau, 0.6), false);
    ST.tau = tau;

    /* saut en cours */
    let view = cur, uView = clamp((ys - S[cur]) / (E[cur] - S[cur]));
    let arrive = 0, q = -1, titleVis = !J && tau < 0.1;
    if (J) {
      if (!J.hold) J.t += dt;
      const s = J.t / J.D;
      if (s < J.jc) {
        const p = s / J.jc, pe = p * p;
        view = J.from < 0 ? -1 : J.from; uView = J.uFrom;
        if (REDUCED) { ST.warp = 0; ST.dim = p; ST.fovAdd = 0; ST.rec = 0; }
        else { ST.warp = lerp(J.w0, 1, pe); ST.dim = lerp(J.dim0, 1, Math.min(1, p * 1.6)); ST.rec = lerp(J.rec0, 1.6, pe); ST.fovAdd = lerp(J.fov0, 28, pe); }
        ST.flash = 0; ST.roll = J.grand ? J.dir * 0.105 * Math.sin(Math.PI * s) : 0;
      } else {
        if (!J.cut) doCut();
        q = clamp((s - J.jc) / (1 - J.jc)); view = cur; uView = ST.uView;
        arrive = 14 * Math.pow(1 - q, 3) * (J.grand ? 1.25 : 1);
        if (REDUCED) { ST.warp = 0; ST.dim = 1 - q; ST.fovAdd = 0; ST.rec = 0; ST.flash = 0; arrive = 0; }
        else { ST.warp = Math.pow(1 - q, 2.4); ST.dim = 1 - sm(0, 0.55, q); ST.fovAdd = 30 * Math.pow(1 - q, 2.5); ST.rec = lerp(1.6, 0, sm(0, 0.5, q)); ST.flash = q < 0.3 ? Math.pow(1 - q / 0.3, 2) : 0; }
        ST.roll = J.grand ? J.dir * 0.105 * Math.sin(Math.PI * clamp(s)) : 0;
        titleVis = q > 0.72;
        if (s >= 1) { ST.warp = 0; ST.dim = 0; ST.fovAdd = 0; ST.rec = 0; ST.flash = 0; ST.roll = 0; endJump(); }
      }
    } else { ST.flash = 0; ST.roll *= 0.9; ST.rec = lerp(ST.rec, 0, 1 - Math.exp(-dt * 6)); }
    ST.uView = uView; ST.view = view;

    /* anneaux : tunnel pendant le grand saut, orbite autour du téléphone à l'étape 4 */
    let amtT = 0, mT = 0, spdT = 0.012;
    if (!REDUCED) {
      if (J && J.grand) {
        const s = J.t / J.D, pre = s < J.jc;
        if (pre) { amtT = sm(0.1, 0.5, s / J.jc); mT = J.from === 3 ? 0 : 0; spdT = lerp(0.02, 0.9, sm(0.15, 0.7, s / J.jc)); if (J.from === 3) { mT = 0; } }
        else { const qq = (s - J.jc) / (1 - J.jc); spdT = lerp(0.9, 0.02, sm(0, 0.8, qq)); if (J.to === 3) { amtT = 1; mT = sm(0.35, 1, qq); } else { amtT = qq < 0.45 ? 1 : 0; mT = 0; } }
      } else if (cur === 3 && !J) { amtT = 1; mT = 1; spdT = 0.012; }
      else if (J && J.from === 3 && !J.grand) { amtT = 1 - sm(0, 0.9, J.t / (J.D * J.jc)); mT = 1; }
    }
    const kA = 1 - Math.exp(-dt * (amtT > ST.ringAmt ? 2.5 : 3.5)), kM = 1 - Math.exp(-dt * 2.2), kS = 1 - Math.exp(-dt * 3);
    ST.ringAmt += (amtT - ST.ringAmt) * kA; ST.ringM += (mT - ST.ringM) * kM; ST.ringSpd += (spdT - ST.ringSpd) * kS;

    /* caméra */
    if (view >= 0) {
      const Pz = CAM[view](uView);
      W(view, Pz[0], _v); W(view, Pz[1], _v2);
      _v3.copy(_v2).sub(_v).normalize();
      _x.set(1, 0, 0).applyQuaternion(FR[view].q); _y.set(0, 1, 0).applyQuaternion(FR[view].q);
      const par = REDUCED ? 0 : 1;
      _v.addScaledVector(_x, smx * 0.32 * par + Math.sin(t * 0.23) * 0.05 * par).addScaledVector(_y, -smy * 0.2 * par + Math.sin(t * 0.31 + 1) * 0.035 * par);
      _v.addScaledVector(_v3, -(ST.rec + arrive + ST.dolly));
      camera.position.copy(_v); camera.lookAt(_v2);
    } else { camera.position.set(0, 0, 8).add(FR[0].o); camera.lookAt(FR[0].o.x, FR[0].o.y, FR[0].o.z - 20); }
    camera.rotateZ(ST.roll + (REDUCED ? 0 : smx * 0.012));
    const fov = 38 + ST.fovAdd; if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld();

    /* appareils : léger flottement + oscillation à la souris */
    for (const k in devs) {
      const d = devs[k]; if (!d.visible || !d.userData.base) continue;
      _q.setFromEuler(new THREE.Euler(Math.sin(t * 0.4 + k.length) * 0.012 + smy * 0.018, smx * 0.05 + (uView - 0.5) * 0.06, 0));
      d.quaternion.copy(d.userData.base).multiply(_q);
    }
    glowLight.intensity = (view >= 0 ? 7 : 0) * (1 - ST.dim) + (view === 0 && uView > 0.7 ? 2 : 0);
    dimmables.forEach((d) => { d.m.color.copy(d.c).multiplyScalar(1 - ST.dim * 0.9); if (d.e) d.m.envMapIntensity = 1 - ST.dim * 0.8; });
    nebula.mesh.position.copy(camera.position); nebula.mat.uniforms.uTime.value = t; nebula.mat.uniforms.uAmt.value = 1 - ST.dim * 0.55;

    if (view >= 0 && view < NS) driveScreens(view, uView);
    updateFlights(view, uView);
    updateRings(dt);

    /* traînées, passe finale, lueur */
    const px = dpr * innerHeight / (2 * Math.tan((camera.fov * Math.PI) / 360));
    dust.update(camera.position, t, px);
    streaks.mat.uniforms.uTravel.value += dt * (2 + 46 * ST.warp);
    streaks.mat.uniforms.uWarp.value = ST.warp; streaks.mat.uniforms.uAlpha.value = clamp(ST.warp * 1.7 - 0.02);
    post.uniforms.uWarp.value = ST.warp; post.uniforms.uFlash.value = ST.flash; post.uniforms.uTime.value = t; post.uniforms.uAspect.value = innerWidth / innerHeight;
    bloom.strength = 0.55 + 0.2 * ST.warp + ST.flash * 0.45;

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
  function fxTension(tau, snap) {
    const e = tau / 0.6, e2 = e * e * (3 - 2 * e);
    ST.warp = 0.32 * e2 * (tau > 0 ? 1 : 0); ST.dim = tau * 0.55; ST.rec = tau * 1.5; ST.fovAdd = tau * 8; ST.roll = 0;
    if (tau <= 0) { ST.warp = 0; ST.dim = 0; ST.rec = 0; ST.fovAdd = 0; }
  }

  /* ----- Cadence et dégradation progressive ----- */
  let frames = 0, accT = 0, lowWin = 0, fps = 60, last = performance.now(), hidden = document.hidden, paused = false;
  document.addEventListener('visibilitychange', () => { hidden = document.hidden; last = performance.now(); });
  const dbg = DEBUG ? Object.assign(document.body.appendChild(document.createElement('pre')), { id: 'dbg' }) : null;
  function updateCovered() { covered = scrollY >= courseH + 0.22 * innerHeight; }
  function tick(now) {
    requestAnimationFrame(tick);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (hidden || paused) return;
    updateCovered();
    if (covered) { if (!tick.wasCovered) { update(dt); } tick.wasCovered = true; return; }
    tick.wasCovered = false;
    update(dt); composer.render(dt);
    frames++; accT += dt;
    if (accT >= 2) {
      fps = frames / accT; frames = 0; accT = 0;
      if (!tierLocked && t > 6 && !J) { lowWin = fps < 50 ? lowWin + 1 : 0; if (lowWin >= 3 && tier !== 'std') { tier = tier === 'max' ? 'high' : 'std'; lowWin = 0; buildComposer(); } }
    }
    if (dbg) dbg.textContent = fps.toFixed(0) + ' i/s · ' + tier + ' · étape ' + (cur + 1) + ' · u ' + ST.uView.toFixed(2) + ' · τ ' + ST.tau.toFixed(2) + (J ? ' · saut ' + (J.t / J.D).toFixed(2) : '') + '\n' + renderer.info.render.calls + ' appels · ' + (renderer.info.render.triangles / 1000).toFixed(0) + ' k tri';
  }

  /* ----- Premier plan : fond noir, saut d'ouverture vers le premier appareil ----- */
  layoutDevices(-1);
  setPct(96);
  update(0.016); composer.render(0.016);
  setPct(100);
  /* ouverture : le chargement s'efface, puis un premier saut amène le regard sur l'ordinateur */
  await new Promise((r) => setTimeout(r, 350));
  $('loader').classList.add('done'); html.classList.remove('booting');
  cur = 0; layoutScroll(); startJump(-1, 0, { intro: true });
  window.__xp = {
    ready: true, static: false,
    get state() { return { cur, u: ST.uView, tau: ST.tau, jump: J ? { t: J.t / J.D, from: J.from, to: J.to, grand: J.grand, cut: J.cut } : null, tier, y: scrollY, S: S.slice(), E: E.slice(), courseH }; },
    get p() { return clamp(ys / Math.max(1, courseH - innerHeight)); },
    sim(sec) { for (let i = 0; i < Math.round(sec * 30); i++) update(1 / 30); composer.render(0.016); },
    goto(st, u = 0.5) {
      J = null; cur = st; layoutScroll(); layoutDevices(st);
      const ty = Math.round(S[st] + u * (E[st] - S[st])); scrollTo({ top: ty, behavior: 'instant' }); ys = ty; lockY = ty; absorbUntil = 0; Object.assign(ST, { warp: 0, dim: 0, flash: 0, roll: 0, rec: 0, fovAdd: 0, ringAmt: st === 3 ? 1 : 0, ringM: st === 3 ? 1 : 0 });
      resetTitles(); this.sim(1.2);
    },
    jumpAt(from, to, s) {
      this.goto(from, to > from ? 1 : 0); ST.uView = to > from ? 1 : 0;
      startJump(from, to, { hold: true, t: 0 }); J.D = J.D; J.t = s * J.D; this.sim(1.0);
    },
    release() { if (J) J.hold = false; },
    jump(to) { startJump(cur, to, {}); },
    pause(b) { paused = b; },
    render() { composer.render(0.016); },
    dbg: { scene, camera, monitor, tablet, phone, bloom: () => bloom, post: () => post, ST },
  };

  requestAnimationFrame((n) => { last = n; tick(n); });
}
