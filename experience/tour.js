/* Voyage entre trois appareils : Studio Display, iPad Pro, téléphone (tes modèles Blender, allégés).
   La page boucle : on reste sur un appareil (8 s par défaut, l'écran de l'appli s'anime), puis un saut en
   hyperespace (traits fins aux couleurs de la marque, déformation de sortie) emmène la caméra vers le suivant.
   Les appareils sont très loin les uns des autres, cachés par le brouillard : on ne voit chacun qu'en arrivant.
   Tout le rendu de scène passe dans une cible, puis une seule passe plein écran ajoute traits, déformation,
   aberration de couleur, vignette. */
import * as THREE from './three/three.module.min.js';
import { RoomEnvironment } from './three/addons/RoomEnvironment.js';
import { GLTFLoader } from './three/addons/GLTFLoader.js';
import { createAtlas, drawMonitorPlayer, drawTablet, drawPhone } from './screens.js';

const $ = (id) => document.getElementById(id);
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const sm = (a, b, x) => { x = clamp((x - a) / (b - a)); return x * x * (3 - 2 * x); };
const lerp = (a, b, t) => a + (b - a) * t;
const easeIO = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas: $('gl'), antialias: false, powerPreference: 'high-performance' }); if (!renderer.capabilities.isWebGL2) throw new Error('webgl2'); }
catch (e) { $('nogl').hidden = false; $('panel').hidden = true; throw e; }

/* ---------- Réglages (hash de l'adresse) ---------- */
const P = { pause: 8, duree: 1.5, densite: 0.55, longueur: 0.7, vitesse: 1.0, deformation: 0.3, rebond: 3.2, lueur: 0.35, aberration: 0.25, etoiles: 1.5 };
const DEF = {
  pause: ['Pause sur l’appareil (s)', 2, 20, 0.5], duree: ['Durée du voyage (s)', 0.8, 3, 0.05], densite: ['Densité des traits', 0.1, 1, 0.01], longueur: ['Longueur des traits', 0.2, 2, 0.05],
  vitesse: ['Vitesse des traits', 0.3, 3, 0.05], deformation: ['Déformation sortie', 0, 1, 0.01], rebond: ['Rebond (osc./s)', 0, 8, 0.1],
  lueur: ['Lueur des traits', 0, 1, 0.01], aberration: ['Aberration couleur', 0, 1, 0.01], etoiles: ['Étoiles', 0, 3, 0.05],
};
try { Object.assign(P, JSON.parse(decodeURIComponent(location.hash.slice(1) || '{}'))); } catch (e) { /* hash libre */ }

const dpr = Math.min(devicePixelRatio || 1, 1.5);
renderer.setPixelRatio(dpr); renderer.setClearColor(0x000000, 1);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x000000, 0.021);
const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 1500);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.55; pmrem.dispose();
const key = new THREE.DirectionalLight(0xdfe9ff, 2.2); key.position.set(4, 6, 8); scene.add(key);
const rimL = new THREE.DirectionalLight(0x6a5cff, 3.0); rimL.position.set(-8, 3, -4); scene.add(rimL);
const rimR = new THREE.DirectionalLight(0x1fb8a3, 1.6); rimR.position.set(8, -2, -3); scene.add(rimR);

/* ---------- Étoiles fines, sans scintillement, tout autour de la caméra (volume qui boucle) ---------- */
const SU = { uAmt: { value: P.etoiles }, uPx: { value: 1 }, uCam: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(560, 360, 560) } };
(() => {
  let seed = 9; const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const n = 900, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), sz = new Float32Array(n);
  const pal = [[1, 0.97, 0.92], [0.7, 0.8, 1], [0.7, 1, 0.92], [0.85, 0.78, 1]];
  for (let i = 0; i < n; i++) {
    pos[i * 3] = rnd() * 560; pos[i * 3 + 1] = rnd() * 360; pos[i * 3 + 2] = rnd() * 560;
    const c = pal[(rnd() * (rnd() < 0.7 ? 1 : 4)) | 0], b = (0.35 + rnd() * 0.65) * 0.9;
    col[i * 3] = c[0] * b; col[i * 3 + 1] = c[1] * b; col[i * 3 + 2] = c[2] * b; sz[i] = 0.45 * (0.5 + Math.pow(rnd(), 3) * 2.2);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aCol', new THREE.BufferAttribute(col, 3)); g.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: SU, fog: false,
    vertexShader: `attribute vec3 aCol;attribute float aSize;uniform float uPx,uAmt;uniform vec3 uCam,uBox;varying vec3 vC;varying float vA;
void main(){vec3 p=uCam+mod(position-uCam+uBox*.5,uBox)-uBox*.5;vec4 mv=viewMatrix*vec4(p,1.);float d=max(length(p-uCam),.5);
float edge=smoothstep(0.,26.,d)*(1.-smoothstep(uBox.x*.38,uBox.x*.5,d));
gl_PointSize=clamp(max(uPx*aSize*300./d,3.4*uPx),3.4*uPx,60.*uPx);vC=aCol;vA=edge*uAmt;gl_Position=projectionMatrix*mv;}`,
    fragmentShader: 'varying vec3 vC;varying float vA;void main(){float r=length(gl_PointCoord-.5)*2.;if(r>1.)discard;gl_FragColor=vec4(vC*exp(-r*r*3.4)*vA*2.1,1.);}',
  });
  const pts = new THREE.Points(g, m); pts.frustumCulled = false; scene.add(pts);
})();

/* ---------- Écrans de l'appli, dessinés en 2D puis plaqués sur la dalle de chaque appareil ---------- */
const atlas = createAtlas();
function screenTex(w, h, redraw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  let key = '';
  return { tex: t, set(k, ...args) { if (k === key) return; key = k; redraw(x, w, h, ...args); t.needsUpdate = true; } };
}
const SCR = {
  m: screenTex(1920, 1080, (x, w, h, p, toast) => drawMonitorPlayer(x, w, h, p, toast, 0)),
  t: screenTex(1344, 1792, (x, w, h, s) => drawTablet(x, w, h, atlas, s)),
  h: screenTex(900, 1850, (x, w, h, s) => drawPhone(x, w, h, atlas, s)),
};
const q = (v, n = 200) => Math.round(v * n);
function driveScreen(kind, u) {
  if (kind === 'm') { const p = lerp(0.1, 0.8, sm(0, 0.85, u)); SCR.m.set('P' + q(p) + '|' + q(sm(0.8, 0.9, u), 20), p, sm(0.8, 0.9, u)); }
  else if (kind === 't') { const s = u < 0.34 ? u / 0.34 : u < 0.67 ? 1 + (u - 0.34) / 0.33 : 2 + Math.min(0.99, (u - 0.67) / 0.33); SCR.t.set('T' + q(s, 150), s); }
  else { const s = u < 0.5 ? u / 0.5 : 1 + Math.min(1, (u - 0.5) / 0.5); SCR.h.set('H' + q(s, 150), s); }
}

/* ---------- Appareils (modèles GLB allégés) ---------- */
const loader = new GLTFLoader();
const _b = new THREE.Box3(), _v = new THREE.Vector3(), _c = new THREE.Vector3();
async function device(file, kind, place, yaw) {
  const g = (await loader.loadAsync('/experience/models/' + file)).scene; g.updateMatrixWorld(true);
  let ecran = null; g.traverse((o) => { if (o.isMesh && o.name === 'Ecran') ecran = o; });
  _b.setFromObject(ecran); const es = _b.getSize(new THREE.Vector3()), ec = _b.getCenter(new THREE.Vector3()), emax = _b.max.clone();
  ecran.visible = false;
  const mat = new THREE.MeshBasicMaterial({ map: SCR[kind].tex }); mat.color.setScalar(1.25);
  let plane;
  if (kind === 'm') { plane = new THREE.Mesh(new THREE.PlaneGeometry(es.x, es.y), mat); plane.position.set(ec.x, ec.y, emax.z + 0.08); }
  else {
    plane = new THREE.Mesh(new THREE.PlaneGeometry(es.x, es.z), mat); plane.rotation.x = -Math.PI / 2; plane.position.set(ec.x, emax.y + 0.08, ec.z);
    if (kind === 'h') { // le canvas du téléphone est un peu plus large que la dalle : on recadre les côtés plutôt que de déformer
      const ca = 900 / 1850, da = es.x / es.z; SCR.h.tex.repeat.x = da / ca; SCR.h.tex.offset.x = (1 - da / ca) / 2;
    }
  }
  g.add(plane);
  const wrap = new THREE.Group(); wrap.add(g); if (kind !== 'm') wrap.rotation.x = Math.PI / 2; // ces deux modèles sont à plat : on les redresse
  wrap.scale.setScalar(0.01); wrap.updateMatrixWorld(true);
  _b.setFromObject(wrap); _b.getCenter(_c); const size = _b.getSize(new THREE.Vector3());
  wrap.position.sub(_c); // centre le modèle sur son origine
  const root = new THREE.Group(); root.add(wrap); root.position.copy(place); root.rotation.y = yaw; scene.add(root);
  return { kind, root, size, center: place.clone(), yaw, name: { m: 'Studio Display', t: 'iPad Pro', h: 'Téléphone' }[kind] };
}
const DEVICES = [];
const FOV = 36;
function poseOf(d, k = 0) { // vue de face, légèrement décalée, qui cadre l'appareil à ~72 % de la hauteur
  const h = d.size.y, w = d.size.x, aspect = innerWidth / innerHeight;
  const dist = Math.max(h * 1.42, (w * 1.3) / aspect) / (2 * Math.tan((FOV * Math.PI) / 360)) * (1 - 0.05 * k);
  const fwd = new THREE.Vector3(Math.sin(d.yaw), 0, Math.cos(d.yaw));
  const pos = d.center.clone().addScaledVector(fwd, dist); pos.y += h * 0.04;
  return { pos, look: d.center.clone() };
}

/* ---------- Passe plein écran : traits, déformation, aberration, vignette (même effet que la page « saut ») ---------- */
const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
const postU = { tScene: { value: rt.texture }, uRes: { value: new THREE.Vector2() }, uT: { value: 0 }, uWarp: { value: 0 }, uDim: { value: 0 }, uDist: { value: 0 }, uZoom: { value: 1 }, uDens: { value: P.densite }, uLen: { value: P.longueur }, uSpd: { value: P.vitesse }, uGlow: { value: P.lueur }, uCA: { value: P.aberration } };
const postMat = new THREE.ShaderMaterial({
  uniforms: postU, depthTest: false, depthWrite: false,
  vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
  fragmentShader: `uniform sampler2D tScene;uniform vec2 uRes;uniform float uT,uWarp,uDim,uDist,uZoom,uDens,uLen,uSpd,uGlow,uCA;varying vec2 vUv;
float h21(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
vec3 pal(float s){vec3 hd=vec3(1.,.98,.94),te=vec3(.12,.80,.70),bl=vec3(.20,.58,.92),in_=vec3(.40,.34,.98);
vec3 c=mix(hd,te,smoothstep(0.,.10,s));c=mix(c,bl,smoothstep(.08,.5,s));return mix(c,in_,smoothstep(.45,1.,s));}
vec3 streaks(vec2 p){float r=length(p),a=atan(p.y,p.x);vec3 acc=vec3(0.);
for(int L=0;L<3;L++){float fL=float(L),N=380.+fL*150.;float cell=a/6.2831853*N,id=floor(cell),f=fract(cell)-.5;
float hh=h21(vec2(id,fL+1.7)),h2=h21(vec2(id+9.1,fL+4.3));if(hh>uDens)continue;
float spd=(.35+h2*.9)*uSpd*(1.+fL*.35),u=fract(h2*7.+uT*spd),r0=.05+u*u*1.4;
float len=(.015+uLen*r0*(.35+hh*.9))*uWarp;float s=(r0-r)/max(len,1e-4);if(s<0.||s>1.)continue;
float d=abs(f)*(6.2831853/N)*r,w=(.0008+.0007*h2)*(1.-.5*s);
float prof=exp(-pow(d/w,2.))+.2*uGlow*exp(-pow(d/(w*6.),2.));
acc+=pal(s)*prof*pow(1.-s,1.3)*smoothstep(.03,.14,r)*(1.5+uGlow);}
return acc;}
void main(){vec2 uv=vUv,d=uv-.5;float asp=uRes.x/uRes.y;vec2 dd=d*vec2(asp,1.);float r2=dot(dd,dd);
vec2 su=.5+d*(1.+uDist*r2*4.)/uZoom,su2=.5+d*(1.+uDist*(1.+uCA*.5)*r2*4.)/uZoom,su3=.5+d*(1.+uDist*(1.-uCA*.5)*r2*4.)/uZoom;
vec3 col=vec3(texture2D(tScene,su2).r,texture2D(tScene,su).g,texture2D(tScene,su3).b)*(1.-uDim);
col+=streaks(dd)*uWarp*.9;
gl_FragColor=vec4(col,1.);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`,
});
const postScene = new THREE.Scene(), postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMat));

function resize() {
  const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false);
  rt.setSize(Math.round(w * dpr), Math.round(h * dpr)); postU.uRes.value.set(w * dpr, h * dpr);
  camera.aspect = w / h; camera.updateProjectionMatrix(); SU.uPx.value = dpr * h / 900;
}
addEventListener('resize', resize);

/* ---------- Boucle : pause sur l'appareil → saut → pause… ---------- */
let idx = 0, phase = 'hold', holdT = 0, jumpT = 0, bt = 9, tAbs = 0, streakT = 3, hop = 0, curve = null, lookA = new THREE.Vector3(), lookB = new THREE.Vector3(), nextIdx = 1, lastShown = '';
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
function startJump() {
  nextIdx = (idx + 1) % DEVICES.length; const A = camPos.clone(), pb = poseOf(DEVICES[nextIdx]);
  const dirs = [[18, 14, 10], [-16, -12, 14], [10, 16, -8]], o = dirs[hop++ % 3];
  const mid = A.clone().lerp(pb.pos, 0.5).add(new THREE.Vector3(...o));
  curve = new THREE.CatmullRomCurve3([A, A.clone().lerp(mid, 0.55), mid, mid.clone().lerp(pb.pos, 0.55), pb.pos], false, 'centripetal');
  lookA.copy(camLook); lookB.copy(pb.look); phase = 'jump'; jumpT = 0;
}
function state(s) {
  const pre = clamp(s / 0.5), post = clamp((s - 0.5) / 0.4);
  const warp = s < 0.5 ? Math.pow(pre, 2.2) : Math.pow(1 - post, 2.2);
  const dim = 0.8 * Math.pow(Math.sin(Math.PI * clamp(s)), 1.3);
  return { warp, dim };
}
function frame(dt) {
  tAbs += dt;
  let warp = 0, dim = 0, fov = FOV;
  if (phase === 'hold') {
    holdT += dt; bt += dt;
    const d = DEVICES[idx], u = clamp(holdT / P.pause), pose = poseOf(d, u);
    camPos.copy(pose.pos); camPos.x += Math.sin(tAbs * 0.25) * 0.05 * d.size.y; camPos.y += Math.cos(tAbs * 0.2) * 0.03 * d.size.y; camLook.copy(pose.look);
    driveScreen(d.kind, u);
    if (holdT >= P.pause) startJump();
  } else {
    jumpT += dt; const s = clamp(jumpT / P.duree), e = easeIO(s);
    curve.getPointAt(e, camPos);
    const tg = curve.getTangentAt(Math.min(0.999, e)), look = lookA.clone().lerp(lookB, easeIO(clamp((s - 0.1) / 0.8)));
    look.lerp(camPos.clone().addScaledVector(tg, 20), Math.sin(Math.PI * s) * 0.7); camLook.copy(look);
    const st = state(s); warp = st.warp; dim = st.dim; fov = FOV + 14 * warp; bt = Math.max(0, (s - 0.85) * P.duree);
    if (s >= 1) { phase = 'hold'; idx = nextIdx; holdT = 0; driveScreen(DEVICES[idx].kind, 0); }
  }
  camera.position.copy(camPos); camera.lookAt(camLook);
  if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  /* sortie : l'image est « bombée » puis revient en place en rebondissant */
  const ramp = phase === 'hold' ? 1 : sm(0.8, 0.9, jumpT / P.duree), bounce = Math.exp(-bt / 0.2) * Math.cos(2 * Math.PI * P.rebond * bt);
  const jumpS = phase === 'jump' ? clamp(jumpT / P.duree) : 1;
  const dist = jumpS < 0.5 ? -0.16 * P.deformation * Math.pow(jumpS / 0.5, 2) : P.deformation * 0.9 * bounce * ramp;
  const zoom = jumpS < 0.5 ? 1 + 0.03 * Math.pow(jumpS / 0.5, 2) : 1 - 0.07 * P.deformation * bounce * ramp;
  streakT += dt * (1.5 + 7 * warp);
  Object.assign(postU, {}); postU.uT.value = streakT; postU.uWarp.value = warp; postU.uDim.value = dim; postU.uDist.value = dist; postU.uZoom.value = zoom;
  postU.uDens.value = P.densite; postU.uLen.value = P.longueur; postU.uSpd.value = P.vitesse; postU.uGlow.value = P.lueur; postU.uCA.value = P.aberration;
  SU.uAmt.value = P.etoiles; SU.uCam.value.copy(camPos);
  const here = DEVICES[idx];
  const txt = phase === 'hold' ? here.name + '|' + 'prochain voyage dans ' + Math.max(0, Math.ceil(P.pause - holdT)) + ' s' : here.name + '|' + 'voyage…';
  if (txt !== lastShown) { lastShown = txt; const [a, b] = txt.split('|'); $('name').textContent = a; $('next').textContent = b; }
}
function render() {
  renderer.setRenderTarget(rt); renderer.render(scene, camera);
  renderer.setRenderTarget(null); renderer.render(postScene, postCam);
}
let last = performance.now();
function loop(now) { requestAnimationFrame(loop); const dt = Math.min(0.05, (now - last) / 1000); last = now; if (!window.__tour?.hold) { frame(dt); render(); } }

/* ---------- Interface ---------- */
for (const k in DEF) {
  const [lab, mn, mx, st] = DEF[k], row = document.createElement('label'); row.className = 's';
  row.innerHTML = '<span>' + lab + '</span><input type="range" min="' + mn + '" max="' + mx + '" step="' + st + '" value="' + P[k] + '"><output>' + P[k] + '</output>';
  const inp = row.querySelector('input'), out = row.querySelector('output');
  inp.addEventListener('input', () => { P[k] = +inp.value; out.textContent = P[k]; sync(); });
  $('sliders').appendChild(row);
}
function sync() { $('json').textContent = JSON.stringify(P); try { history.replaceState(null, '', '#' + encodeURIComponent(JSON.stringify(P))); } catch (e) { /* ignoré */ } }
sync();
$('skip').addEventListener('click', () => { if (phase === 'hold') startJump(); });
$('hide').addEventListener('click', () => $('panel').classList.toggle('min'));
addEventListener('keydown', (e) => { if (e.code === 'Space' && !e.target.closest('input,button')) { e.preventDefault(); if (phase === 'hold') startJump(); } });
$('copy').addEventListener('click', () => navigator.clipboard?.writeText(JSON.stringify(P)).catch(() => {}));

/* ---------- Démarrage ---------- */
await Promise.race([Promise.all([document.fonts.load('600 40px Inter'), document.fonts.load('500 20px "IBM Plex Mono"')]).catch(() => {}), new Promise((r) => setTimeout(r, 1200))]);
const [dm, dt_, dh] = await Promise.all([
  device('studio-display.glb', 'm', new THREE.Vector3(0, 0, 0), -0.1),
  device('ipad-pro.glb', 't', new THREE.Vector3(72, -10, -95), 0.12),
  device('telephone.glb', 'h', new THREE.Vector3(-38, 16, -185), -0.08),
]);
DEVICES.push(dm, dt_, dh);
resize();
{ const p = poseOf(DEVICES[0]); camPos.copy(p.pos); camLook.copy(p.look); driveScreen('m', 0); }
$('name').textContent = DEVICES[0].name;
window.__tour = { P, hold: false, devices: DEVICES, step(sec) { const n = Math.round(sec * 30); for (let i = 0; i < n; i++) frame(1 / 30); render(); }, startJump, get phase() { return phase; }, get idx() { return idx; }, camera };
requestAnimationFrame(loop);
