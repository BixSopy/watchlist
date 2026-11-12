/* Fond d'espace simple : des étoiles fines de tailles et de profondeurs variées, la caméra qui avance dedans.
   Pas de nébuleuse, pas de cristaux, pas de scintillement (luminosité constante, taille minimale stable). */
import * as THREE from './three/three.module.min.js';

const $ = (id) => document.getElementById(id);
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas: $('gl'), antialias: true, powerPreference: 'high-performance' }); }
catch (e) { $('nogl').hidden = false; $('panel').hidden = true; throw e; }

const P = { etoiles: 1.5, vitesse: 4 };
const DEF = { etoiles: ['Étoiles', 0, 3, 0.05], vitesse: ['Vitesse de dérive', 0, 10, 0.1] };
try { Object.assign(P, JSON.parse(decodeURIComponent(location.hash.slice(1) || '{}'))); } catch (e) { /* hash libre */ }

const dpr = Math.min(devicePixelRatio || 1, 1.75);
renderer.setPixelRatio(dpr); renderer.setClearColor(0x000000, 1);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 1200);
let seed = 5; const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const RANGE = 520; // profondeur du volume, qui boucle autour de la caméra

const U = { uAmt: { value: P.etoiles }, uPx: { value: 1 }, uCamZ: { value: 0 }, uRange: { value: RANGE } };
function stars(n, spread, size, bright) {
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), sz = new Float32Array(n);
  const pal = [[1, 0.97, 0.92], [0.7, 0.8, 1], [0.7, 1, 0.92], [0.85, 0.78, 1]];
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (rnd() - 0.5) * spread; pos[i * 3 + 1] = (rnd() - 0.5) * spread * 0.62; pos[i * 3 + 2] = rnd() * RANGE;
    const c = pal[(rnd() * (rnd() < 0.7 ? 1 : 4)) | 0], b = (0.35 + rnd() * 0.65) * bright;
    col[i * 3] = c[0] * b; col[i * 3 + 1] = c[1] * b; col[i * 3 + 2] = c[2] * b; sz[i] = size * (0.5 + Math.pow(rnd(), 3) * 2.2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aCol', new THREE.BufferAttribute(col, 3)); g.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: U,
    vertexShader: `attribute vec3 aCol;attribute float aSize;uniform float uPx,uCamZ,uRange,uAmt;varying vec3 vC;varying float vA;
void main(){vec3 p=position;p.z=uCamZ-mod(uCamZ-p.z,uRange);
vec4 mv=viewMatrix*vec4(p,1.);float d=max(-mv.z,.5);
float edge=smoothstep(0.,28.,d)*(1.-smoothstep(uRange*.78,uRange,d));
gl_PointSize=clamp(max(uPx*aSize*300./d,3.4*uPx),3.4*uPx,90.*uPx);
vC=aCol;vA=edge*uAmt;gl_Position=projectionMatrix*mv;}`,
    fragmentShader: `varying vec3 vC;varying float vA;
void main(){float r=length(gl_PointCoord-.5)*2.;if(r>1.)discard;gl_FragColor=vec4(vC*exp(-r*r*3.4)*vA*2.1,1.);}`,
  });
  const pts = new THREE.Points(g, m); pts.frustumCulled = false; return pts;
}
scene.add(stars(650, 600, 0.45, 0.9), stars(140, 360, 0.6, 0.8));

let t = 0, camZ = 0, boost = 0, mx = 0, my = 0, sx = 0, sy = 0;
function resize() { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); U.uPx.value = dpr * h / 900; }
addEventListener('resize', resize); resize();
addEventListener('pointermove', (e) => { mx = e.clientX / innerWidth - 0.5; my = e.clientY / innerHeight - 0.5; }, { passive: true });
function frame(dt, draw = true) {
  t += dt; camZ -= (6 * P.vitesse + boost * 90) * dt; boost *= Math.pow(0.15, dt);
  sx += (mx - sx) * (1 - Math.exp(-dt * 2.5)); sy += (my - sy) * (1 - Math.exp(-dt * 2.5));
  camera.position.set(sx * 6 + Math.sin(t * 0.07) * 4, -sy * 4 + Math.cos(t * 0.05) * 2.5, camZ);
  camera.rotation.set(-sy * 0.05 + Math.sin(t * 0.05) * 0.015, -sx * 0.08, Math.sin(t * 0.04) * 0.02);
  U.uCamZ.value = camZ; U.uAmt.value = P.etoiles; $('dist').textContent = Math.round(-camZ) + ' m';
  if (draw) renderer.render(scene, camera);
}
let last = performance.now();
function loop(now) { requestAnimationFrame(loop); const dt = Math.min(0.05, (now - last) / 1000); last = now; if (!window.__space?.hold) frame(dt); }
requestAnimationFrame(loop);

for (const k in DEF) {
  const [lab, mn, mx2, st] = DEF[k], row = document.createElement('label'); row.className = 's';
  row.innerHTML = '<span>' + lab + '</span><input type="range" min="' + mn + '" max="' + mx2 + '" step="' + st + '" value="' + P[k] + '"><output>' + P[k] + '</output>';
  const inp = row.querySelector('input'), out = row.querySelector('output');
  inp.addEventListener('input', () => { P[k] = +inp.value; out.textContent = P[k]; sync(); });
  $('sliders').appendChild(row);
}
function sync() { $('json').textContent = JSON.stringify(P); try { history.replaceState(null, '', '#' + encodeURIComponent(JSON.stringify(P))); } catch (e) { /* ignoré */ } }
sync();
$('go').addEventListener('click', () => { boost = 1.4; });
addEventListener('keydown', (e) => { if (e.code === 'Space' && !e.target.closest('input,button')) { e.preventDefault(); boost = 1.4; } });
$('copy').addEventListener('click', () => navigator.clipboard?.writeText(JSON.stringify(P)).catch(() => {}));
window.__space = { P, hold: false, step(sec) { const n = Math.round(sec * 30); for (let i = 0; i < n; i++) frame(1 / 30, i === n - 1); }, camera };
