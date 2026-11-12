/* Test de l'espace : un vrai volume 3D, pas un fond de points.
   Ce qui donne la profondeur :
   - étoiles en 3 profondeurs, avec flou de profondeur (les proches et les lointaines deviennent de grands disques doux, la mise au point reste nette) ;
   - nuages de nébuleuse en grandes nappes à des distances différentes (parallaxe : ils glissent plus lentement que les étoiles proches) ;
   - éclats de verre à facettes à plusieurs profondeurs, arêtes lumineuses aux couleurs de la marque ;
   - brouillard de profondeur et halo bleu en bas, comme dans la référence ;
   - la caméra avance dans le volume (dérive lente, ou « Avancer »). */
import * as THREE from './three/three.module.min.js';

const $ = (id) => document.getElementById(id);
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas: $('gl'), antialias: true, powerPreference: 'high-performance' }); }
catch (e) { $('nogl').hidden = false; $('panel').hidden = true; throw e; }

const P = { etoiles: 0.6, nebuleuse: 0.8, eclats: 1, micro: 1, flou: 0, brouillard: 0.7, vitesse: 1 };
const DEF = { etoiles: ['Étoiles (fines)', 0, 1.5, 0.05], micro: ['Éclats lointains', 0, 1.5, 0.05], nebuleuse: ['Nébuleuse', 0, 1.5, 0.05], eclats: ['Éclats de verre', 0, 1.5, 0.05], flou: ['Flou de profondeur', 0, 1.5, 0.05], brouillard: ['Brouillard', 0, 1.5, 0.05], vitesse: ['Vitesse de dérive', 0, 4, 0.1] };
try { Object.assign(P, JSON.parse(decodeURIComponent(location.hash.slice(1) || '{}'))); } catch (e) { /* hash libre */ }

const dpr = Math.min(devicePixelRatio || 1, 1.75);
renderer.setPixelRatio(dpr); renderer.setClearColor(0x000000, 1);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 1200);
let seed = 5; const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const RANGE = 520; // profondeur du volume, qui boucle autour de la caméra

/* ---------- Étoiles : 3 profondeurs + flou de profondeur ---------- */
const starUniforms = { uFocus: { value: 70 }, uCoc: { value: P.flou }, uPx: { value: 1 }, uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uRange: { value: RANGE } };
function stars(n, spread, size, bright) {
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), sd = new Float32Array(n), sz = new Float32Array(n);
  const pal = [[1, 0.97, 0.92], [0.7, 0.8, 1], [0.7, 1, 0.92], [0.85, 0.78, 1]];
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (rnd() - 0.5) * spread; pos[i * 3 + 1] = (rnd() - 0.5) * spread * 0.62; pos[i * 3 + 2] = rnd() * RANGE;
    const c = pal[(rnd() * (rnd() < 0.7 ? 1 : 4)) | 0]; const b = (0.35 + rnd() * 0.65) * bright;
    col[i * 3] = c[0] * b; col[i * 3 + 1] = c[1] * b; col[i * 3 + 2] = c[2] * b; sd[i] = rnd(); sz[i] = size * (0.5 + Math.pow(rnd(), 3) * 2.2);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aCol', new THREE.BufferAttribute(col, 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1)); g.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: starUniforms,
    vertexShader: `attribute vec3 aCol;attribute float aSeed,aSize;uniform float uFocus,uCoc,uPx,uTime,uRange;uniform vec3 uCam;varying vec3 vC;varying float vA,vR;
void main(){vec3 p=position;p.z=uCam.z-mod(uCam.z-p.z,uRange);
vec4 mv=viewMatrix*vec4(p,1.);float d=max(-mv.z,.5);float coc=clamp(abs(d-uFocus)/(uFocus*1.4),0.,1.)*uCoc;
float edge=smoothstep(0.,28.,d)*(1.-smoothstep(uRange*.78,uRange,d));
float tw=1.;
float s=aSize*(1.+coc*5.5);gl_PointSize=clamp(uPx*s*300./d,1.4,90.*uPx);
vC=aCol;vR=coc;vA=edge*tw/(1.+coc*coc*10.);gl_Position=projectionMatrix*mv;}`,
    fragmentShader: `varying vec3 vC;varying float vA,vR;
void main(){vec2 q=gl_PointCoord-.5;float r=length(q)*2.;if(r>1.)discard;
float core=exp(-r*r*(7.-vR*4.));float ring=0.;
gl_FragColor=vec4(vC*(core+ring)*vA*2.6,1.);}`,
  });
  const pts = new THREE.Points(g, m); pts.frustumCulled = false; return pts;
}
const starLayers = [stars(650, 600, 0.45, 0.9), stars(140, 360, 0.6, 0.8)];
starLayers.forEach((s) => scene.add(s));

/* ---------- Nébuleuse : nappes douces à plusieurs profondeurs ---------- */
function blobTex(r, g, b) {
  const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d');
  for (let i = 0; i < 14; i++) {
    const cx = 128 + (rnd() - 0.5) * 120, cy = 128 + (rnd() - 0.5) * 120, rad = 40 + rnd() * 70, gr = x.createRadialGradient(cx, cy, 0, cx, cy, rad);
    gr.addColorStop(0, `rgba(${r},${g},${b},${0.10 + rnd() * 0.12})`); gr.addColorStop(1, `rgba(${r},${g},${b},0)`); x.fillStyle = gr; x.fillRect(0, 0, 256, 256);
  }
  const f = document.createElement('canvas'); f.width = f.height = 256; const y = f.getContext('2d'); y.filter = 'blur(3px)'; y.drawImage(c, 0, 0);
  const t = new THREE.CanvasTexture(f); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const nebTex = [blobTex(70, 60, 220), blobTex(30, 130, 210), blobTex(20, 170, 150), blobTex(110, 80, 230)];
const nebulae = [];
for (let i = 0; i < 16; i++) {
  const mat = new THREE.SpriteMaterial({ map: nebTex[i % 4], transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, fog: false });
  const s = new THREE.Sprite(mat); const sc = 140 + rnd() * 260;
  s.scale.set(sc, sc * (0.55 + rnd() * 0.45), 1); s.userData = { x: (rnd() - 0.5) * 380, y: (rnd() - 0.5) * 200, z: rnd() * RANGE, o: 0.1 + rnd() * 0.16, rot: (rnd() - 0.5) * 0.02 };
  scene.add(s); nebulae.push(s);
}

/* ---------- Éclats de verre à facettes ---------- */
const shardMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { uTime: starUniforms.uTime, uAmt: { value: P.eclats }, uCam: starUniforms.uCam },
  vertexShader: 'varying vec3 vN,vV,vW;void main(){vec4 w=modelMatrix*vec4(position,1.);vW=w.xyz;vN=normalize(mat3(modelMatrix)*normal);vV=normalize(cameraPosition-w.xyz);gl_Position=projectionMatrix*viewMatrix*w;}',
  fragmentShader: `uniform float uTime,uAmt;varying vec3 vN,vV,vW;
void main(){vec3 n=normalize(vN);if(!gl_FrontFacing)n=-n;float f=pow(1.-abs(dot(n,normalize(vV))),2.2);
float h=fract(sin(dot(floor(vW*0.0+n*7.3),vec3(12.9,78.2,37.7)))*43758.5);
vec3 ind=vec3(.30,.26,.95),teal=vec3(.10,.72,.64),blu=vec3(.18,.52,.95);
vec3 base=mix(ind,mix(teal,blu,h),smoothstep(.2,.9,h))*(.18+.65*f);
float spec=pow(max(dot(reflect(-normalize(vV),n),normalize(vec3(.4,.8,.3))),0.),24.);
vec3 col=base+vec3(.55,.65,1.)*spec*.22+vec3(.35,.4,1.)*f*.5;
float d=length(cameraPosition-vW);float fade=smoothstep(8.,40.,d)*(1.-smoothstep(300.,480.,d));
gl_FragColor=vec4(col*uAmt,(.30+.42*f+spec*.2)*fade*uAmt);}`,
});
const edgeMat = new THREE.LineBasicMaterial({ color: 0x8fa2ff, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending });
const shards = [];
for (let i = 0; i < 30; i++) {
  const geo = new THREE.IcosahedronGeometry(1, 0); const p = geo.attributes.position;
  const memo = new Map(); // même déformation pour un même sommet : les faces restent jointes (sinon l'éclat « se déchire »)
  for (let k = 0; k < p.count; k++) {
    const x = p.getX(k), y = p.getY(k), z = p.getZ(k), key = x.toFixed(3) + ',' + y.toFixed(3) + ',' + z.toFixed(3);
    if (!memo.has(key)) memo.set(key, [0.78 + rnd() * 0.5, 0.8 + rnd() * 0.5, 1 + rnd() * 0.8]);
    const j = memo.get(key); p.setXYZ(k, x * j[0] * j[1], y * j[0] * j[2], z * j[0] * 0.6);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, shardMat), e = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 1), edgeMat);
  const g = new THREE.Group(); g.add(m, e); const sc = 1.0 + Math.pow(rnd(), 2.0) * 7; g.scale.setScalar(sc);
  g.userData = { x: (rnd() - 0.5) * 120, y: (rnd() - 0.5) * 60, z: Math.pow(rnd(), 1.5) * RANGE * 0.7, r: [rnd() * 0.3, rnd() * 0.3, rnd() * 0.2] };
  scene.add(g); shards.push(g);
}

/* ---------- Éclats lointains : de minuscules fragments de verre à la place des « particules » ---------- */
const microMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { uAmt: { value: P.micro } },
  vertexShader: `varying vec3 vN,vV;varying float vS;void main(){mat4 im=mat4(1.);
#ifdef USE_INSTANCING
im=instanceMatrix;
#endif
vec4 w=modelMatrix*im*vec4(position,1.);vN=normalize(mat3(modelMatrix*im)*normal);vV=normalize(cameraPosition-w.xyz);vS=length(cameraPosition-w.xyz);gl_Position=projectionMatrix*viewMatrix*w;}`,
  fragmentShader: `uniform float uAmt;varying vec3 vN,vV;varying float vS;
void main(){vec3 n=normalize(vN);if(!gl_FrontFacing)n=-n;float f=pow(1.-abs(dot(n,normalize(vV))),1.6);
float spec=pow(max(dot(reflect(-normalize(vV),n),normalize(vec3(.4,.8,.3))),0.),18.);
vec3 col=mix(vec3(.28,.30,.95),vec3(.15,.75,.7),f)*(.25+.9*f)+vec3(.6,.7,1.)*spec*.5;
float fade=smoothstep(18.,60.,vS)*(1.-smoothstep(260.,460.,vS));
gl_FragColor=vec4(col*uAmt,(.25+.5*f+spec*.3)*fade*uAmt);}`,
});
const MICRO = 150, microGeo = new THREE.TetrahedronGeometry(1, 0), micro = new THREE.InstancedMesh(microGeo, microMat, MICRO);
micro.frustumCulled = false; scene.add(micro);
const microData = Array.from({ length: MICRO }, () => ({ x: (rnd() - 0.5) * 220, y: (rnd() - 0.5) * 110, z: rnd() * RANGE, s: 0.12 + Math.pow(rnd(), 2.5) * 0.9, r: [rnd() * 6, rnd() * 6, rnd() * 6], v: [(rnd() - 0.5) * 0.6, (rnd() - 0.5) * 0.6, (rnd() - 0.5) * 0.4] }));
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _sc = new THREE.Vector3();
function updateMicro() {
  microData.forEach((d, i) => {
    _e.set(d.r[0] + t * d.v[0], d.r[1] + t * d.v[1], d.r[2] + t * d.v[2]); _q.setFromEuler(_e);
    _p.set(d.x, d.y + Math.sin(t * 0.25 + d.z) * 0.4, camZ - (((-camZ + d.z) % RANGE + RANGE) % RANGE)); _sc.setScalar(d.s * (0.8 + 0.6 * Math.sin(i)));
    _m.compose(_p, _q, _sc); micro.setMatrixAt(i, _m);
  });
  micro.instanceMatrix.needsUpdate = true; microMat.uniforms.uAmt.value = P.micro; micro.visible = P.micro > 0.01;
}
scene.fog = new THREE.FogExp2(0x000000, 0.0);

/* ---------- Boucle ---------- */
let t = 0, camZ = 0, boost = 0, mx = 0, my = 0, sx = 0, sy = 0;
function resize() { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); starUniforms.uPx.value = dpr * h / 900; }
addEventListener('resize', resize); resize();
addEventListener('pointermove', (e) => { mx = e.clientX / innerWidth - 0.5; my = e.clientY / innerHeight - 0.5; }, { passive: true });
function wrapZ(z0) { return camZ - (((camZ - (-z0)) % RANGE) + RANGE) % RANGE; }
function frame(dt, draw = true) {
  t += dt; camZ -= (6 * P.vitesse + boost * 90) * dt; boost *= Math.pow(0.15, dt);
  sx += (mx - sx) * (1 - Math.exp(-dt * 2.5)); sy += (my - sy) * (1 - Math.exp(-dt * 2.5));
  camera.position.set(sx * 6 + Math.sin(t * 0.07) * 4, -sy * 4 + Math.cos(t * 0.05) * 2.5, camZ);
  camera.rotation.set(-sy * 0.05 + Math.sin(t * 0.05) * 0.015, -sx * 0.08, Math.sin(t * 0.04) * 0.02);
  starUniforms.uTime.value = t; starUniforms.uCam.value.copy(camera.position); starUniforms.uCoc.value = P.flou;
  nebulae.forEach((s, i) => { const u = s.userData; s.position.set(u.x + camera.position.x * 0.55, u.y + camera.position.y * 0.55, camZ - (((i * 31.7 + u.z + (-camZ) * 1) % RANGE + RANGE) % RANGE) - 60); s.material.opacity = u.o * P.nebuleuse * (1 - P.brouillard * 0.15); s.material.rotation += u.rot * dt; });
  shards.forEach((g) => { const u = g.userData; g.position.set(u.x, u.y + Math.sin(t * 0.3 + u.z) * 0.8, camZ - (((-camZ + u.z) % RANGE + RANGE) % RANGE)); g.rotation.x += u.r[0] * dt; g.rotation.y += u.r[1] * dt; g.rotation.z += u.r[2] * dt; });
  updateMicro(); shardMat.uniforms.uAmt.value = P.eclats; edgeMat.opacity = 0.32 * Math.min(1, P.eclats);
  starLayers.forEach((l) => { l.visible = P.etoiles > 0.01; }); $('dist').textContent = Math.round(-camZ) + ' m';
  if (draw) renderer.render(scene, camera);
}
let last = performance.now();
function loop(now) { requestAnimationFrame(loop); const dt = Math.min(0.05, (now - last) / 1000); last = now; if (!window.__space?.hold) frame(dt); }
requestAnimationFrame(loop);

/* ---------- Interface ---------- */
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
