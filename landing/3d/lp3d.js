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
  { k: 'pc', url: './models/studio-display.glb', rx: 0, rad: 0.004 },
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
  renderer.toneMappingExposure = 1.0;
  renderer.setClearColor(0x000000, 0);
  const dpr = Math.min(window.devicePixelRatio || 1, opts.maxDpr || 2);
  renderer.setPixelRatio(dpr);

  const scene = new THREE.Scene();
  /* Studio sombre : fond bleu nuit presque noir et quelques softbox. Les aluminiums anodisés « bleu nuit » des GLB
     (métal = 1, couleur de base marine) ne reflètent que ce qu'on leur donne : une salle blanche les rend chromés,
     un fond sombre avec de fines sources les garde bleu profond avec un liseré net sur les arêtes. */
  const pm = new THREE.PMREMGenerator(renderer);
  const env = new THREE.Scene();
  /* Voûte en dégradé (haut clair, bas sombre) : un métal reflète la couleur de base × l'éclairement reçu ;
     avec ~1 de moyenne le cadre rend exactement son bleu marine, les softbox y ajoutent des reflets nets. */
  const dome = new THREE.SphereGeometry(60, 48, 24), cols = [], top = new THREE.Color(0.6, 0.76, 1.15), bot = new THREE.Color(0.1, 0.14, 0.24), cc = new THREE.Color();
  const pos = dome.attributes.position;
  for (let i = 0; i < pos.count; i++) { const k = Math.pow(Math.min(1, Math.max(0, (pos.getY(i) / 60 + 1) / 2)), 1.3); cc.copy(bot).lerp(top, k); cols.push(cc.r, cc.g, cc.b); }
  dome.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  env.add(new THREE.Mesh(dome, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const box = (w, h, x, y, z, hex, k) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.lookAt(0, 0, 0); env.add(m);
  };
  box(30, 12, -8, 36, 16, 0xdce8ff, 2.4);     /* softbox du dessus */
  box(6, 46, -40, 4, 10, 0xc4d4ff, 1.5);      /* liseré gauche */
  box(6, 46, 40, 6, -4, 0x3fd8c0, 1.8);       /* liseré droit, teinte Cinepisode */
  scene.environment = pm.fromScene(env, 0.025).texture;
  scene.environmentIntensity = 1;
  pm.dispose();
  const rim = new THREE.DirectionalLight(0x1fb8a3, 0.35); rim.position.set(1100, 250, -600); scene.add(rim); /* teinte du chapitre : voir draw() */

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
    /* rayon de coin de la dalle : le point du contour le plus proche d'un coin de la boîte englobante est à r·(√2−1) de ce coin */
    let rad = 0.04;
    if (scr) {
      const pts = []; const v = new THREE.Vector3();
      scr.updateWorldMatrix(true, false);
      scr.traverse(o => { if (o.isMesh) { const p = o.geometry.attributes.position; for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); pts.push(v.x, v.y); } } });
      const cs = [[sb.min.x, sb.min.y], [sb.max.x, sb.min.y], [sb.min.x, sb.max.y], [sb.max.x, sb.max.y]];
      let best = Infinity;
      for (const [cx, cy] of cs) { let d = Infinity; for (let i = 0; i < pts.length; i += 2) d = Math.min(d, Math.hypot(pts[i] - cx, pts[i + 1] - cy)); best = Math.min(best, d / (Math.SQRT2 - 1)); }
      rad = Math.min(0.25, best / sz.x);
    }
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
      holder, mats, sw: sz.x, sh: sz.y, rad: def.rad !== undefined ? def.rad : rad,
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
    /* proportions (largeur/hauteur) et rayon de coin (fraction de la largeur) de la dalle de chaque modèle : le HTML s'y cale */
    ratio: models.map(m => m.sw / m.sh),
    rad: models.map(m => m.rad),
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
