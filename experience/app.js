/* Cinepisode — prototype de landing 3D : « la bobine ».
   Une scène WebGL plein écran dont l'état est une fonction pure de la progression du défilement
   (lissée) : on peut remonter, tout rejoue à l'envers. Rien ne se lance tout seul.
   Chapitres (part de la course de défilement) :
     0 [0,.12]   bobine assemblée, caméra qui tourne lentement
     1 [.12,.36] éclatement : les blocs se détachent, la caméra prend de la hauteur, quadrillage au sol
     2 [.36,.58] réassemblage + travelling avant
     3 [.58,.80] intérieur : les blocs forment une salle-dôme autour du spectateur
     4 [.80,1]   sortie, la bobine se recompose, les sections classiques recouvrent la scène
   Aucune dépendance externe : Three.js r170 servi depuis /experience/three (CSP « self »). */
import * as THREE from './three/three.module.min.js';
import { RoundedBoxGeometry } from './three/addons/RoundedBoxGeometry.js';
import { RoomEnvironment } from './three/addons/RoomEnvironment.js';
import { EffectComposer } from './three/addons/EffectComposer.js';
import { RenderPass } from './three/addons/RenderPass.js';
import { UnrealBloomPass } from './three/addons/UnrealBloomPass.js';
import { OutputPass } from './three/addons/OutputPass.js';

const root = document.documentElement;
const $ = (id) => document.getElementById(id);
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const MOBILE = matchMedia('(max-width: 700px), (pointer: coarse)').matches;

/* ---------- Outils ---------- */
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const ramp = (x, a, b) => clamp01((x - a) / (b - a));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2); // power3 in-out
const lerp = (a, b, t) => a + (b - a) * t;
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rand = rng(7);

/* ---------- Chargement : progression réelle par étapes ---------- */
let loadP = 0;
function setLoad(p) {
  loadP = Math.max(loadP, p);
  $('ldPct').textContent = String(Math.round(loadP * 100)).padStart(3, '0');
  $('ldBar').style.transform = 'scaleX(' + loadP.toFixed(3) + ')';
}
setLoad(0.3); // ce module et Three.js sont chargés et analysés
try { history.scrollRestoration = 'manual'; } catch (e) { /* navigateurs anciens */ }
scrollTo(0, 0);

let renderer = null;
try { renderer = new THREE.WebGLRenderer({ canvas: $('scene'), antialias: !MOBILE, powerPreference: 'high-performance' }); } catch (e) { renderer = null; }
if (!renderer) {
  root.classList.add('nogl', 'static');
  setLoad(1); $('loader').classList.add('done'); root.classList.remove('booting');
} else {
  main().catch((e) => { console.error(e); root.classList.add('static'); $('loader').classList.add('done'); root.classList.remove('booting'); });
}

async function main() {
  const W = () => innerWidth, H = () => innerHeight;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, MOBILE ? 1.5 : 2));
  renderer.setSize(W(), H(), false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0e16);
  scene.fog = new THREE.FogExp2(0x0c111b, MOBILE ? 0.05 : 0.043);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.22;

  const camera = new THREE.PerspectiveCamera(MOBILE ? 50 : 36, W() / H(), 0.05, 140);

  /* Lumières : un projecteur blanc chaud (la clé), une lumière intérieure ambrée, un contre-jour froid */
  const PROJ = new THREE.Vector3(-8.5, 5.2, 7.5);
  scene.add(new THREE.HemisphereLight(0x8fa3c8, 0x0a0e16, 0.32));
  const key = new THREE.SpotLight(0xffe7c8, 170, 0, 0.3, 0.75, 2);
  key.position.copy(PROJ); scene.add(key); scene.add(key.target);
  const rim = new THREE.DirectionalLight(0x7090cc, 0.9); rim.position.set(5, 4, -7); scene.add(rim);
  const inner = new THREE.PointLight(0xffc78a, 5, 10, 2); scene.add(inner);

  /* ---------- La bobine ---------- */
  const N = MOBILE
    ? { fl: 14, hub: 6, spk: 4, coil: 16, fr: 10 }
    : { fl: 20, hub: 8, spk: 5, coil: 26, fr: 16 };
  const R = 2.2, FZ = 0.42, FLOOR = -2.6;
  const reel = new THREE.Object3D();
  reel.position.set(0, 0.15, 0);
  const blocks = [];
  const lineBase = new THREE.LineBasicMaterial({ color: 0xece7de, transparent: true, opacity: 1, depthWrite: false, fog: true });

  function frost(glow) {
    return new THREE.MeshPhysicalMaterial({ color: 0xb9c1cf, roughness: 0.52, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.4,
      emissive: 0xffcf98, emissiveIntensity: glow, transparent: true, opacity: 0 });
  }
  function addBlock(geom, edges, mat, local, opts) {
    const mesh = new THREE.Mesh(geom, mat);
    const edge = new THREE.LineSegments(edges, lineBase.clone());
    mesh.add(edge);
    scene.add(mesh);
    blocks.push(Object.assign({ mesh, edge, local, spin: true, glowBase: mat.emissiveIntensity, homeP: new THREE.Vector3(), homeQ: new THREE.Quaternion(),
      scatP: new THREE.Vector3(), scatQ: new THREE.Quaternion(), domeP: new THREE.Vector3(), domeQ: new THREE.Quaternion(), delay: 0, order: 0 }, opts || {}));
  }
  const loc = (x, y, z, rz) => ({ p: new THREE.Vector3(x, y, z), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, rz)) });
  const glow = () => (rand() < 0.12 ? 0.35 + rand() * 0.4 : 0.02 + rand() * 0.06);

  // Flasques : anneaux de blocs arrondis givrés
  const gFl = new RoundedBoxGeometry((2 * Math.PI * R) / N.fl * 0.9, 0.34, 0.14, 3, 0.06), eFl = new THREE.EdgesGeometry(gFl, 30);
  for (const z of [-FZ, FZ]) for (let i = 0; i < N.fl; i++) { const a = (i / N.fl) * Math.PI * 2; addBlock(gFl, eFl, frost(glow()), loc(Math.cos(a) * R, Math.sin(a) * R, z, a + Math.PI / 2), { kind: 'fl' }); }
  // Moyeu
  const rH = 0.62, gHub = new RoundedBoxGeometry((2 * Math.PI * rH) / N.hub * 0.86, 0.22, 2 * FZ + 0.12, 3, 0.05), eHub = new THREE.EdgesGeometry(gHub, 30);
  for (let i = 0; i < N.hub; i++) { const a = (i / N.hub) * Math.PI * 2; addBlock(gHub, eHub, frost(0.1 + rand() * 0.25), loc(Math.cos(a) * rH, Math.sin(a) * rH, 0, a + Math.PI / 2), { kind: 'hub' }); }
  // Rayons
  const gSp = new RoundedBoxGeometry(0.2, 1.12, 0.1, 3, 0.045), eSp = new THREE.EdgesGeometry(gSp, 30);
  for (const z of [-FZ, FZ]) for (let i = 0; i < N.spk; i++) { const a = (i / N.spk) * Math.PI * 2 + 0.3; addBlock(gSp, eSp, frost(glow()), loc(Math.cos(a) * 1.3, Math.sin(a) * 1.3, z, a - Math.PI / 2), { kind: 'spk' }); }
  // Pellicule enroulée (tambour sombre)
  const filmMat = () => new THREE.MeshStandardMaterial({ color: 0x15171d, roughness: 0.28, metalness: 0.55, transparent: true, opacity: 0 });
  const rC = 1.5, gCo = new RoundedBoxGeometry((2 * Math.PI * rC) / N.coil * 0.98, 0.05, 2 * FZ - 0.08, 2, 0.02), eCo = new THREE.EdgesGeometry(gCo, 30);
  for (let i = 0; i < N.coil; i++) { const a = (i / N.coil) * Math.PI * 2; addBlock(gCo, eCo, filmMat(), loc(Math.cos(a) * rC, Math.sin(a) * rC, 0, a + Math.PI / 2), { kind: 'coil' }); }

  // Pellicule déroulée : des images-épisodes qui descendent jusqu'au sol (hors rotation de la bobine)
  const strip = new THREE.CatmullRomCurve3([[1.45, -1.0, 0.25], [2.55, -1.95, 0.7], [2.75, -2.55, 1.6], [1.6, -2.58, 2.35], [0, -2.58, 2.7], [-1.7, -2.58, 2.6], [-3.4, -2.58, 2.0], [-5.0, -2.58, 1.0], [-6.4, -2.58, -0.4], [-7.4, -2.58, -2.0]].map((v) => new THREE.Vector3(...v)));
  const sLen = strip.getLength(), FRW = 0.8;
  const gFr = new RoundedBoxGeometry(FRW * 0.97, 0.6, 0.035, 2, 0.02), eFr = new THREE.EdgesGeometry(gFr, 30);
  const NOW = 4; // épisode « en cours »
  for (let i = 0; i < N.fr; i++) {
    const u = Math.min(0.999, (i * FRW + 0.4) / sLen);
    const P = strip.getPointAt(u), T = strip.getTangentAt(u).normalize();
    const S = new THREE.Vector3().crossVectors(T, new THREE.Vector3(0, 1, 0)).normalize();
    const Nn = new THREE.Vector3().crossVectors(S, T).normalize();
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(T, S.clone().negate(), Nn));
    const tex = frameTexture(i, i < NOW ? 'seen' : i === NOW ? 'now' : 'next');
    const mat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: i === NOW ? 1.6 : i < NOW ? 0.55 : 0.22, roughness: 0.5, metalness: 0.1, transparent: true, opacity: 0 });
    addBlock(gFr, eFr, mat, { p: P, q }, { kind: 'fr', spin: false, frame: i });
  }

  /* Cibles de l'éclatement et de la salle-dôme, calculées une fois à partir de la bobine au repos */
  updateReel(0, 0);
  const center = new THREE.Vector3(0, 0.15, 0), domeC = new THREE.Vector3(0, -0.5, 0), RD = MOBILE ? 4.0 : 4.4;
  const dummy = new THREE.Object3D(), tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
  const others = blocks.filter((b) => b.kind !== 'fr'), frames = blocks.filter((b) => b.kind === 'fr');
  blocks.forEach((b, i) => {
    homeOf(b, b.homeP, b.homeQ);
    const dir = tmpV.copy(b.homeP).sub(center).normalize().add(new THREE.Vector3(rand() - 0.5, rand() * 0.8, rand() - 0.5).multiplyScalar(0.9)).normalize();
    b.scatP.copy(b.homeP).addScaledVector(dir, 2.6 + rand() * 4.6); b.scatP.y += rand() * 1.6; if (b.scatP.z > 3.5) b.scatP.z = 3.5 - rand() * 2;
    b.scatQ.setFromEuler(new THREE.Euler(rand() * 6.28, rand() * 6.28, rand() * 6.28));
    b.delay = 0.35 * rand(); b.order = i;
  });
  // Dôme : rangées de briques serrées (comme un igloo), les images-épisodes en bandeau d'écrans à hauteur d'yeux
  const ROWS = [0.04, 0.3, 0.58, 0.86, 1.12];
  const wsum = ROWS.reduce((s, e) => s + Math.cos(e), 0);
  let left = others.length, idx = 0;
  ROWS.forEach((el, r) => {
    const cnt = r === ROWS.length - 1 ? left : Math.max(3, Math.round(others.length * Math.cos(el) / wsum));
    left -= cnt;
    for (let j = 0; j < cnt && idx < others.length; j++, idx++) {
      const b = others[idx], az = (j / cnt) * Math.PI * 2 + r * 0.37;
      b.domeP.set(Math.cos(az) * Math.cos(el) * RD, Math.sin(el) * RD * 0.92, Math.sin(az) * Math.cos(el) * RD).add(domeC);
      dummy.position.copy(b.domeP); dummy.lookAt(domeC); b.domeQ.copy(dummy.quaternion);
      b.domeS = 1.25 + 0.55 * Math.cos(el);
    }
  });
  frames.forEach((b, i) => {
    const a = (i / frames.length) * Math.PI * 2 + 0.6;
    b.domeP.set(Math.cos(a) * RD * 0.62, 0.3, Math.sin(a) * RD * 0.62);
    dummy.position.copy(b.domeP); dummy.lookAt(0, 0.3, 0); b.domeQ.copy(dummy.quaternion);
    b.domeS = 1.5;
  });

  function updateReel(t, p) {
    reel.position.y = 0.15 + Math.sin(t * 0.4) * 0.05;
    reel.rotation.set(-0.08, 0.42, t * 0.035 + p * 1.8);
    reel.updateMatrixWorld(true);
  }
  function homeOf(b, outP, outQ) {
    if (!b.spin) { outP.copy(b.local.p); outQ.copy(b.local.q); return; }
    outP.copy(b.local.p).applyMatrix4(reel.matrixWorld);
    outQ.copy(reel.quaternion).multiply(b.local.q);
  }

  /* ---------- Vocabulaire « plan d'architecte » : quadrillage, cubes filaires numérotés, polyligne ---------- */
  const gridMat = new THREE.LineBasicMaterial({ color: 0xece7de, transparent: true, opacity: 0.06, depthWrite: false });
  const gp = [];
  for (let i = -30; i <= 30; i++) { gp.push(-30, FLOOR, i, 30, FLOOR, i, i, FLOOR, -30, i, FLOOR, 30); }
  const grid = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(gp, 3)), gridMat);
  scene.add(grid);
  const cubeMat = new THREE.LineBasicMaterial({ color: 0xece7de, transparent: true, opacity: 0.2, depthWrite: false });
  const cubes = [[-4.6, 0.9, -1.8], [4.9, 0.6, -2.6], [-6.2, 0.5, 2.6], [5.6, 1.1, 2.0], [-2.4, 0.4, -5.2], [2.8, 0.7, -6.0], [7.2, 0.45, -0.4]].map(([x, s, z], i) => {
    const m = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(s, s, s)), cubeMat);
    m.position.set(x, FLOOR + s / 2, z); m.rotation.y = rand() * 1.4; scene.add(m);
    return { m, top: new THREE.Vector3(x - s / 2, FLOOR + s, z - s / 2), n: String(i + 1).padStart(2, '0') };
  });
  const polyIdx = [0, 3, 6, 9, 12, 15, 18].map((k) => Math.round((k / 20) * N.fl));
  const polyGeom = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(polyIdx.length * 3), 3));
  const polyMat = new THREE.LineBasicMaterial({ color: 0xece7de, transparent: true, opacity: 0.3, depthWrite: false });
  const poly = new THREE.Line(polyGeom, polyMat); poly.frustumCulled = false; scene.add(poly);

  /* Numéros posés sur la scène (DOM, projetés à chaque image) */
  const labelsEl = $('labels');
  const mkLabel = (txt) => { const s = document.createElement('span'); s.className = 'lbl'; s.textContent = txt; labelsEl.appendChild(s); return { el: s, o: -1 }; };
  const cubeLabels = cubes.map((c) => mkLabel(c.n));
  const polyLabels = polyIdx.map((k) => mkLabel(String(k * 7 + 3).padStart(3, '0')));

  /* ---------- Poussière dans le faisceau et faisceau du projecteur ---------- */
  const DN = MOBILE ? 260 : 800, dPos = new Float32Array(DN * 3), dSpd = new Float32Array(DN);
  for (let i = 0; i < DN; i++) { dPos[i * 3] = (rand() - 0.5) * 24; dPos[i * 3 + 1] = FLOOR + rand() * 9.5; dPos[i * 3 + 2] = (rand() - 0.5) * 18; dSpd[i] = 0.04 + rand() * 0.12; }
  const dGeom = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(dPos, 3));
  const dMat = new THREE.PointsMaterial({ size: MOBILE ? 0.05 : 0.035, map: dotTexture(), color: 0xf3e6cf, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
  const dust = new THREE.Points(dGeom, dMat); dust.frustumCulled = false; scene.add(dust);

  const beamLen = PROJ.length() + 2.5;
  const beamMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(0xf3e6cf) }, uOpacity: { value: 0 } },
    vertexShader: 'varying vec2 vUv;varying vec3 vN;varying vec3 vV;void main(){vUv=uv;vec4 mv=modelViewMatrix*vec4(position,1.);vN=normalize(normalMatrix*normal);vV=normalize(-mv.xyz);gl_Position=projectionMatrix*mv;}',
    fragmentShader: 'uniform vec3 uColor;uniform float uOpacity;varying vec2 vUv;varying vec3 vN;varying vec3 vV;void main(){float f=abs(dot(vN,vV));float a=uOpacity*pow(f,2.2)*(.18+.82*vUv.y)*smoothstep(0.,.12,vUv.y)*smoothstep(0.,.2,1.-vUv.y+.02);gl_FragColor=vec4(uColor*a,a);}',
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const beam = new THREE.Mesh(new THREE.ConeGeometry(3.3, beamLen, 48, 1, true), beamMat);
  const bDir = new THREE.Vector3().subVectors(PROJ, new THREE.Vector3(0, -0.4, 0)).normalize();
  beam.position.copy(PROJ).addScaledVector(bDir, -beamLen / 2);
  beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), bDir);
  scene.add(beam);

  /* ---------- Post-traitement : lueur (bureau seulement) ---------- */
  let composer = null, bloom = null;
  if (!MOBILE) {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(W(), H()), 0.4, 0.5, 0.9);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
  }
  setLoad(0.55);

  /* ---------- Caméra : images clés le long de la course ---------- */
  const K = [
    { p: 0, pos: [0.4, 1.0, 9.6], tgt: [0, 0.1, 0] },
    { p: 0.12, pos: [1.2, 1.6, 9.3], tgt: [0, 0.05, 0] },
    { p: 0.3, pos: [4.4, 7.0, 12.6], tgt: [0, -0.7, 0] },
    { p: 0.36, pos: [4.1, 6.5, 11.8], tgt: [0, -0.6, 0] },
    { p: 0.52, pos: [1.0, 1.1, 7.2], tgt: [0, 0.1, 0] },
    { p: 0.58, pos: [0.35, 0.55, 4.6], tgt: [0, 0.2, 0] },
    { p: 0.68, pos: [0, 0.25, 0.2], tgt: [-0.6, 0.55, -3] },
    { p: 0.8, pos: [0, 0.25, 0.2], tgt: [3, 0.6, 0.6] },
    { p: 0.9, pos: [1.1, 1.4, 8.6], tgt: [0, 0.1, 0] },
    { p: 1, pos: [0.6, 2.8, 11.8], tgt: [0, -0.9, 0] },
  ].map((k) => ({ p: k.p, pos: new THREE.Vector3(...k.pos), tgt: new THREE.Vector3(...k.tgt) }));
  const camPos = new THREE.Vector3(), camTgt = new THREE.Vector3();
  function cameraAt(p, t, inside) {
    let i = 0; while (i < K.length - 2 && p > K[i + 1].p) i++;
    const a = K[i], b = K[i + 1], u = ease(ramp(p, a.p, b.p));
    camPos.lerpVectors(a.pos, b.pos, u); camTgt.lerpVectors(a.tgt, b.tgt, u);
    // accueil : lente rotation autour de la bobine
    const idle = 1 - ramp(p, 0, 0.12), ang = Math.sin(t * 0.13) * 0.16 * idle;
    camPos.sub(camTgt).applyAxisAngle(new THREE.Vector3(0, 1, 0), ang).add(camTgt);
    // écran étroit (portrait) : reculer pour garder la bobine entière, sauf à l'intérieur
    const aspect = W() / H(), fit = aspect < 1.3 ? Math.min(1.9, (MOBILE ? 0.72 : 1.05) / aspect) : 1;
    if (fit > 1) camPos.sub(camTgt).multiplyScalar(lerp(fit, 1, inside)).add(camTgt);
  }

  /* ---------- Textes, compteur, progression ---------- */
  const chapEls = [...document.querySelectorAll('.chap')];
  const SL = [[0.12, 0.36], [0.36, 0.58], [0.58, 0.8], [0.8, 0.97]];
  const chapState = chapEls.map(() => ({ o: -1, y: 0 }));
  const progBar = $('progBar'), chapN = $('chapN'), hint = $('scrollHint');
  let lastChap = -1, lastProg = -1;
  function ui(p) {
    chapEls.forEach((el, i) => {
      const [a, b] = SL[i], u = (p - a) / (b - a);
      const tin = ease(ramp(u, 0, 0.2)), tout = 1 - ease(ramp(u, 0.8, 1));
      const o = u < 0 || u > 1 ? 0 : tin * tout, y = 18 * (1 - tin) - 14 * (1 - tout);
      const s = chapState[i];
      if (Math.abs(s.o - o) > 0.004 || Math.abs(s.y - y) > 0.1) { el.style.opacity = o.toFixed(3); el.style.transform = 'translate3d(0,' + y.toFixed(1) + 'px,0)'; s.o = o; s.y = y; }
    });
    const c = p < 0.12 ? 0 : p < 0.36 ? 1 : p < 0.58 ? 2 : p < 0.8 ? 3 : 4;
    if (c !== lastChap) { chapN.textContent = String(c).padStart(2, '0'); lastChap = c; }
    if (Math.abs(p - lastProg) > 0.001) { progBar.style.transform = 'scaleX(' + p.toFixed(4) + ')'; lastProg = p; }
    hint.classList.toggle('gone', p > 0.015);
  }

  /* ---------- Défilement lissé ---------- */
  const course = $('course');
  let courseH = course.offsetHeight, sTarget = scrollY, sCur = scrollY;
  addEventListener('scroll', () => { sTarget = scrollY; }, { passive: true });
  const ptr = { x: 0, y: 0, cx: 0, cy: 0 };
  addEventListener('pointermove', (e) => { ptr.x = (e.clientX / W()) * 2 - 1; ptr.y = (e.clientY / H()) * 2 - 1; }, { passive: true });

  /* ---------- Une image de la scène pour une progression p ---------- */
  const vA = new THREE.Vector3(), qA = new THREE.Quaternion(), camRight = new THREE.Vector3(), camUp = new THREE.Vector3();
  let matT0 = -1; const MAT_STEP = MOBILE ? 18 : 13, MAT_DUR = 450;
  function frame(p, t, now) {
    updateReel(t, p);
    const E = ease(ramp(p, 0.12, 0.3)) - ease(ramp(p, 0.36, 0.52));
    const D = ease(ramp(p, 0.58, 0.68)) * (1 - ease(ramp(p, 0.8, 0.9)));
    for (const b of blocks) {
      homeOf(b, vA, qA);
      const ei = ease(clamp01(E * 1.35 - b.delay)), di = ease(clamp01(D * 1.35 - b.delay));
      b.mesh.position.copy(vA).lerp(b.scatP, ei).lerp(b.domeP, di);
      b.mesh.quaternion.copy(qA).slerp(b.scatQ, ei).slerp(b.domeQ, di);
      b.mesh.scale.setScalar(lerp(1, b.domeS || 1, di));
      // matérialisation au chargement, puis arêtes discrètes (plus visibles pendant l'éclatement)
      let m = 1;
      if (matT0 >= 0) m = ease(clamp01((now - matT0 - b.order * MAT_STEP) / MAT_DUR));
      else if (matT0 === -1) m = 0;
      if (b.mesh.material.opacity !== m) { b.mesh.material.opacity = m; if (m >= 1) { b.mesh.material.transparent = false; } }
      b.edge.material.opacity = (1 - m) * 0.9 + m * (0.05 + 0.3 * ei) * (1 - di);
      if (b.kind !== 'coil') b.mesh.material.emissiveIntensity = b.kind === 'fr' ? b.glowBase + 0.5 * di : b.glowBase * (1 + 0.5 * di);
    }
    inner.position.copy(reel.position).lerp(new THREE.Vector3(0, 0.6, 0), D);
    inner.intensity = 5 + 16 * D;
    gridMat.opacity = (0.04 + 0.11 * E) * (1 - D);
    cubeMat.opacity = (0.1 + 0.3 * E) * (1 - D);
    const pa = polyGeom.attributes.position;
    polyIdx.forEach((k, j) => { const bp = blocks[k].mesh.position; pa.setXYZ(j, bp.x, bp.y, bp.z); });
    pa.needsUpdate = true;
    polyMat.opacity = (0.18 + 0.3 * E) * (1 - D);
    beamMat.uniforms.uOpacity.value = (MOBILE ? 0.07 : 0.1) * (1 - 0.8 * D) * (matT0 >= 0 ? 1 : 0.4);
    dMat.opacity = (0.55 + 0.25 * D) * (matT0 >= 0 ? 1 : 0.3);
    if (bloom) bloom.strength = 0.4 + 0.15 * D;
    const fov = (MOBILE ? 50 : 36) + 26 * D;
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }

    cameraAt(p, t, D);
    ptr.cx += (ptr.x - ptr.cx) * 0.05; ptr.cy += (ptr.y - ptr.cy) * 0.05;
    camera.position.copy(camPos);
    camera.lookAt(camTgt);
    camRight.setFromMatrixColumn(camera.matrixWorld, 0); camUp.setFromMatrixColumn(camera.matrixWorld, 1);
    const par = REDUCED ? 0 : 0.32 * (1 - 0.7 * D);
    camera.position.addScaledVector(camRight, ptr.cx * par).addScaledVector(camUp, -ptr.cy * par * 0.6);
    camera.lookAt(camTgt);
    labels(E, D);
  }
  function labels(E, D) {
    const w = W(), h = H(), show = (1 - D) * (matT0 === -1 ? 1 : 0.55 + 0.45 * E);
    const place = (L, v, o) => {
      tmpV.copy(v).project(camera);
      const vis = tmpV.z < 1 && Math.abs(tmpV.x) < 1.1 && Math.abs(tmpV.y) < 1.1 ? o : 0;
      const x = (tmpV.x * 0.5 + 0.5) * w, y = (-tmpV.y * 0.5 + 0.5) * h;
      L.el.style.transform = 'translate3d(' + (x + 6).toFixed(1) + 'px,' + (y - 12).toFixed(1) + 'px,0)';
      if (Math.abs(L.o - vis) > 0.01) { L.el.style.opacity = vis.toFixed(2); L.o = vis; }
    };
    cubes.forEach((c, i) => place(cubeLabels[i], c.top, show * (0.5 + 0.5 * E)));
    polyIdx.forEach((k, j) => place(polyLabels[j], blocks[k].mesh.position, show * 0.85));
  }

  /* ---------- Poussière ---------- */
  function drift(dt) {
    for (let i = 0; i < DN; i++) { let y = dPos[i * 3 + 1] + dSpd[i] * dt; if (y > FLOOR + 9.5) y = FLOOR; dPos[i * 3 + 1] = y; dPos[i * 3] += Math.sin((y + i) * 0.7) * 0.0015; }
    dGeom.attributes.position.needsUpdate = true;
  }

  function render() { if (composer) composer.render(); else renderer.render(scene, camera); }
  function resize() {
    renderer.setSize(W(), H(), false); camera.aspect = W() / H(); camera.updateProjectionMatrix();
    if (composer) composer.setSize(W(), H());
    courseH = course.offsetHeight;
    if (REDUCED) { frame(0, 0, performance.now()); render(); }
  }
  addEventListener('resize', resize);

  /* ---------- Chargement : polices, compilation des shaders, première image en fil de fer ---------- */
  await document.fonts.ready.catch(() => {}); setLoad(0.7);
  frame(0, 0, 0);
  if (renderer.compileAsync) await renderer.compileAsync(scene, camera).catch(() => {});
  setLoad(0.95);
  render(); setLoad(1);

  /* Mesures (lecture seule) pour les tests : images par seconde, temps d'image */
  const metrics = (window.__xp = { frames: 0, avgMs: 0, blocks: blocks.length, bloom: !!composer, p: 0 });

  if (REDUCED) {
    root.classList.add('static');
    matT0 = 0; frame(0, 0, 1e9); render();
    $('loader').classList.add('done'); root.classList.remove('booting');
    return;
  }

  // La scène se matérialise bloc par bloc, puis l'interface apparaît et le défilement se libère
  await new Promise((r) => setTimeout(r, 350));
  matT0 = performance.now();
  $('loader').classList.add('done');
  setTimeout(() => root.classList.remove('booting'), blocks.length * MAT_STEP * 0.6);

  let last = performance.now(), running = true, acc = 0, n = 0;
  document.addEventListener('visibilitychange', () => { running = !document.hidden; if (running) { last = performance.now(); requestAnimationFrame(loop); } });
  function loop(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    sCur += (sTarget - sCur) * (1 - Math.exp(-dt * 6.5));
    if (Math.abs(sTarget - sCur) < 0.1) sCur = sTarget;
    const p = clamp01(sCur / Math.max(1, courseH));
    metrics.p = p;
    ui(p);
    // les sections classiques recouvrent tout l'écran : plus besoin de dessiner
    const covered = scrollY > courseH + H() * 1.25;
    const past = scrollY > courseH + H() * 0.15;
    if (past !== loop.past) { root.classList.toggle('past', past); loop.past = past; }
    if (!covered) { drift(dt); frame(p, now / 1000, now); render(); }
    acc += now - (loop.prev || now); loop.prev = now; n++;
    if (n >= 60) { metrics.avgMs = acc / n; metrics.frames += n; acc = 0; n = 0; }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  initSound(() => ramp(sCur / Math.max(1, courseH), 0.58, 0.68));
}

/* ---------- Textures dessinées (aucun fichier à télécharger) ---------- */
function frameTexture(i, state) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 192;
  const g = c.getContext('2d');
  g.fillStyle = '#101218'; g.fillRect(0, 0, 256, 192);
  // perforations
  g.fillStyle = state === 'next' ? '#2a2d36' : '#d9d2c4';
  for (let k = 0; k < 9; k++) { g.fillRect(10 + k * 28, 8, 14, 10); g.fillRect(10 + k * 28, 174, 14, 10); }
  // image
  const grd = g.createLinearGradient(0, 28, 0, 164);
  if (state === 'now') { grd.addColorStop(0, '#f6ead2'); grd.addColorStop(1, '#c9a978'); }
  else if (state === 'seen') { grd.addColorStop(0, '#6f7a90'); grd.addColorStop(1, '#2a3142'); }
  else { grd.addColorStop(0, '#22262f'); grd.addColorStop(1, '#14171d'); }
  g.fillStyle = grd; g.fillRect(14, 28, 228, 136);
  g.font = '500 22px "IBM Plex Mono", monospace'; g.textBaseline = 'middle';
  g.fillStyle = state === 'now' ? '#0a0e16' : state === 'seen' ? '#ece7de' : '#5b6170';
  g.fillText('S01 · E' + String(i + 1).padStart(2, '0'), 30, 96);
  if (state === 'now') { g.fillStyle = '#2f8fd1'; g.fillRect(30, 128, 120, 4); g.fillStyle = '#0a0e16'; g.globalAlpha = .25; g.fillRect(150, 128, 70, 4); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function dotTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d'), r = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.4, 'rgba(255,255,255,.35)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

/* ---------- Son : ronronnement de projecteur, synthétisé (aucun fichier, désactivé par défaut) ---------- */
function initSound(insideAmt) {
  const btn = $('soundBtn'); let ctx = null, master = null, on = false, raf = 0;
  function build() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320; lp.connect(master);
    for (const [f, a] of [[50, 0.5], [100, 0.22], [150, 0.06]]) { const o = ctx.createOscillator(), gn = ctx.createGain(); o.frequency.value = f; gn.gain.value = a; o.connect(gn).connect(lp); o.start(); }
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0); let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2; }
    const noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true;
    const room = ctx.createBiquadFilter(); room.type = 'lowpass'; room.frequency.value = 520;
    const roomG = ctx.createGain(); roomG.gain.value = 0.5; noise.connect(room).connect(roomG).connect(master);
    const clat = ctx.createBiquadFilter(); clat.type = 'bandpass'; clat.frequency.value = 1900; clat.Q.value = 3;
    const clatG = ctx.createGain(); clatG.gain.value = 0;
    const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 18; const lfoG = ctx.createGain(); lfoG.gain.value = 0.09;
    lfo.connect(lfoG).connect(clatG.gain); noise.connect(clat).connect(clatG).connect(master); lfo.start(); noise.start();
  }
  function follow() { if (!on || !ctx) return; master.gain.setTargetAtTime(0.045 + 0.035 * insideAmt(), ctx.currentTime, 0.4); raf = setTimeout(follow, 250); }
  btn.addEventListener('click', () => {
    on = !on;
    btn.textContent = on ? 'Son : activé' : 'Son : coupé'; btn.setAttribute('aria-pressed', String(on));
    if (on) { if (!ctx) build(); ctx.resume(); follow(); }
    else if (ctx) { clearTimeout(raf); master.gain.setTargetAtTime(0, ctx.currentTime, 0.15); setTimeout(() => { if (!on) ctx.suspend(); }, 700); }
  });
}
