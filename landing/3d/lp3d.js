/* lp3d — corps 3D des appareils de la landing (écran Studio Display, iPad Pro, iPhone).
   Principe : les écrans restent du vrai HTML (.lp-s dans .lp-dv-scr, net, cliquable, traduit) ; ce module
   dessine seulement le CORPS de l'appareil (cadre, tranche, pied) dans un <canvas> placé derrière,
   avec une caméra qui reproduit exactement la transformation CSS de .lp-dv (perspective 1800 px, centre de
   fuite au centre de l'appareil, rotateX/rotateY, scale). Le modèle est mis à l'échelle pour que la dalle
   du GLB coïncide avec la zone d'écran du DOM. Chargé à la demande (import dynamique) : si quoi que ce soit
   échoue (WebGL absent, GPU logiciel, trop lent), js/23-landing.js garde l'appareil CSS d'origine.
   Rien d'externe : Three.js et les modèles sont servis localement (CSP script-src 'self'). */
import * as THREE from './three/three.module.min.js';
import { GLTFLoader } from './three/GLTFLoader.js';
import { RoomEnvironment } from './three/RoomEnvironment.js';

const D = Math.PI / 180;
/* rx : les GLB iPad/iPhone sont modélisés à plat (écran vers +Y, haut vers −Z) → on les redresse. */
const DEFS = [
  { k: 'pc', url: './models/studio-display.glb', rx: 0 },
  { k: 'tab', url: './models/ipad-pro.glb', rx: Math.PI / 2 },
  { k: 'ph', url: './models/telephone.glb', rx: Math.PI / 2 }
];

export async function start(canvas, opts) {
  opts = opts || {};
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance', premultipliedAlpha: true });
  const gl = renderer.getContext();
  let gpu = '';
  try { const e = gl.getExtension('WEBGL_debug_renderer_info'); gpu = e ? String(gl.getParameter(e.UNMASKED_RENDERER_WEBGL)) : ''; } catch (e) { /* ignore */ }
  const soft = /swiftshader|llvmpipe|software|softpipe|basic render/i.test(gpu);
  if (soft && !opts.force) { renderer.dispose(); throw new Error('soft-gpu'); }

  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x000000, 0);
  const dpr = Math.min(window.devicePixelRatio || 1, opts.maxDpr || 2);
  renderer.setPixelRatio(dpr);

  const scene = new THREE.Scene();
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.75;
  pm.dispose();

  const key = new THREE.DirectionalLight(0xffffff, 1.7); key.position.set(-700, 900, 1200); scene.add(key);
  const rim = new THREE.DirectionalLight(0x1fb8a3, 2.4); rim.position.set(1100, 250, -600); scene.add(rim);
  const fill = new THREE.DirectionalLight(0x8fa6ff, 0.5); fill.position.set(900, -500, 900); scene.add(fill);

  const cam = new THREE.PerspectiveCamera(30, 1, 200, 6000);
  const DIST = 1800;
  cam.position.set(0, 0, DIST);

  const root = new THREE.Group();
  scene.add(root);

  const loader = new GLTFLoader();
  const gltfs = await Promise.all(DEFS.map(d => loader.loadAsync(new URL(d.url, import.meta.url).href)));

  const models = gltfs.map((g, i) => {
    const def = DEFS[i];
    const holder = new THREE.Group();
    const obj = g.scene;
    obj.rotation.x = def.rx;
    holder.add(obj);
    holder.updateMatrixWorld(true);
    let scr = null;
    obj.traverse(o => { if (!scr && /^Ecran/.test(o.name)) scr = o; });
    const whole = new THREE.Box3().setFromObject(obj);
    const sb = scr ? new THREE.Box3().setFromObject(scr) : whole.clone();
    const c = sb.getCenter(new THREE.Vector3()), sz = sb.getSize(new THREE.Vector3());
    /* origine = centre de la dalle, plan de l'écran en z = 0 (même plan que le DOM) */
    obj.position.set(-c.x, -c.y, -sb.max.z);
    /* la dalle devient un aplat noir (le HTML est posé dessus) : pas de trou dans le corps */
    if (scr) scr.traverse(o => { if (o.isMesh) { o.material = new THREE.MeshBasicMaterial({ color: 0x000000 }); } });
    const mats = [];
    obj.traverse(o => {
      if (!o.isMesh) return;
      o.frustumCulled = false;
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
        if (mats.indexOf(m) < 0) { m._o = m.opacity; m._t = m.transparent; m._dw = m.depthWrite; mats.push(m); }
      });
    });
    root.add(holder);
    holder.visible = false;
    return {
      holder, mats, sw: sz.x, sh: sz.y,
      /* étendue sous le centre de la dalle, en fraction de la hauteur d'écran (pied compris) */
      down: Math.max(0.5, (c.y - whole.min.y) / sz.y),
      up: Math.max(0.5, (whole.max.y - c.y) / sz.y),
      shown: -1
    };
  });

  function fade(m, w) {
    const vis = w > 0.004;
    if (m.holder.visible !== vis) m.holder.visible = vis;
    if (!vis || Math.abs(m.shown - w) < 0.002) return;
    m.shown = w;
    const solid = w > 0.995;
    for (let i = 0; i < m.mats.length; i++) {
      const t = m.mats[i];
      if (solid) { t.transparent = t._t; t.opacity = t._o; t.depthWrite = t._dw; }
      else { t.transparent = true; t.opacity = t._o * w; t.depthWrite = false; }
    }
  }

  let cw = 0, ch = 0;
  const tc = new THREE.Color(), white = new THREE.Color(0xffffff);
  const api = {
    gpu, soft, canvas,
    /* étendue (sous / au-dessus du centre de la dalle) pondérée par les poids des 3 modèles, en fraction de la hauteur d'écran */
    ext(w) {
      let dn = 0, up = 0, t = 0;
      for (let i = 0; i < 3; i++) { dn += models[i].down * w[i]; up += models[i].up * w[i]; t += w[i]; }
      return t > 0 ? { down: dn / t, up: up / t } : { down: 0.5, up: 0.5 };
    },
    /* st : vw, vh (px CSS du conteneur), cx, cy (centre de l'appareil), iw, ih (zone d'écran DOM),
       s (échelle), rx, ry (degrés CSS), w[3] (poids PC/tablette/téléphone), tint [r,g,b] */
    draw(st) {
      if (st.vw !== cw || st.vh !== ch) {
        cw = st.vw; ch = st.vh;
        renderer.setSize(cw, ch, false);
        cam.aspect = cw / ch;
        cam.fov = 2 * Math.atan((ch / 2) / DIST) / D;
      }
      cam.setViewOffset(cw, ch, cw / 2 - st.cx, ch / 2 - st.cy, cw, ch);
      cam.updateProjectionMatrix();
      /* CSS : y vers le bas → rotateX de signe inverse ; rotateY identique ; ordre X puis Y (Euler XYZ) */
      root.rotation.set(-st.rx * D, st.ry * D, 0, 'XYZ');
      root.scale.setScalar(st.s);
      for (let i = 0; i < 3; i++) {
        const m = models[i], sx = st.iw / m.sw, sy = st.ih / m.sh;
        m.holder.scale.set(sx, sy, (sx + sy) / 2);
        fade(m, st.w[i]);
      }
      if (st.tint) { tc.setRGB(st.tint[0] / 255, st.tint[1] / 255, st.tint[2] / 255, THREE.SRGBColorSpace).lerp(white, 0.35); rim.color.copy(tc); }
      renderer.render(scene, cam);
    },
    dispose() {
      try {
        scene.traverse(o => { if (o.isMesh) { o.geometry && o.geometry.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m && m.dispose()); } });
        renderer.dispose();
        const e = renderer.getContext().getExtension('WEBGL_lose_context'); if (e) e.loseContext();
      } catch (e) { /* ignore */ }
    }
  };
  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); if (opts.onLost) opts.onLost(); });
  return api;
}
