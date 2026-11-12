/* Effets de la landing 3D : nébuleuse, poussière en 3 couches, traînées du saut supraluminique
   (dégradé Cinepisode), affiches instanciées, passe finale (aberration chromatique, flou radial,
   vignettage, grain, flash). Tout est calculé par la carte graphique ; aucun fichier à télécharger. */
import * as THREE from './three/three.module.min.js';

function mulberry(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/* ---------- Nébuleuse : nuages très sombres indigo / turquoise, centrée sur la caméra ---------- */
export function createNebula() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    uniforms: { uTime: { value: 0 }, uAmt: { value: 1 } },
    vertexShader: 'varying vec3 vD;void main(){vD=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `varying vec3 vD;uniform float uTime;uniform float uAmt;
float h(vec3 p){p=fract(p*0.3183099+.1);p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float n3(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.-2.*f);
return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z);}
float fbm(vec3 p){float a=.5,s=0.;for(int i=0;i<5;i++){s+=a*n3(p);p=p*2.03+vec3(1.7,9.2,3.1);a*=.5;}return s;}
void main(){vec3 d=normalize(vD);
float a=fbm(d*2.1+vec3(0.,uTime*.004,0.));float b=fbm(d*3.5+vec3(7.,3.,uTime*.003));
vec3 col=vec3(.026,.018,.085)*smoothstep(.40,.86,a)*1.7+vec3(0.,.055,.075)*smoothstep(.50,.92,b)*1.3+vec3(.006,.008,.02);
gl_FragColor=vec4(col*uAmt,1.);}`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 24), mat);
  mesh.renderOrder = -100; mesh.frustumCulled = false;
  return { mesh, mat };
}

/* ---------- Poussière : 3 couches à des profondeurs différentes, toujours autour de la caméra ---------- */
export function createDust(density = 1) {
  const group = new THREE.Group();
  const defs = [
    { n: 9000, box: 70, size: 0.07, color: [0.45, 0.8, 1.0], op: 0.9 },
    { n: 5500, box: 120, size: 0.16, color: [0.5, 0.45, 1.0], op: 0.8 },
    { n: 2400, box: 200, size: 0.34, color: [0.85, 0.92, 1.0], op: 0.7 },
  ];
  const layers = defs.map((d, li) => {
    const r = mulberry(100 + li), pos = new Float32Array(d.n * 3), seed = new Float32Array(d.n);
    for (let i = 0; i < d.n; i++) { pos[i * 3] = r(); pos[i * 3 + 1] = r(); pos[i * 3 + 2] = r(); seed[i] = r(); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uCam: { value: new THREE.Vector3() }, uBox: { value: d.box }, uSize: { value: d.size }, uTime: { value: 0 }, uPx: { value: 1 }, uColor: { value: new THREE.Vector3(...d.color) }, uOp: { value: d.op } },
      vertexShader: `attribute float aSeed;uniform vec3 uCam;uniform float uBox,uSize,uTime,uPx;varying float vA;varying float vS;
void main(){vec3 rel=fract(position-uCam/uBox)-.5;vec3 wp=uCam+rel*uBox;vec4 mv=viewMatrix*vec4(wp,1.);gl_Position=projectionMatrix*mv;
float edge=1.-smoothstep(.3,.5,max(max(abs(rel.x),abs(rel.y)),abs(rel.z)));
float tw=.65+.35*sin(uTime*(.6+aSeed*2.2)+aSeed*40.);vA=edge*tw;vS=aSeed;
gl_PointSize=clamp(uPx*uSize*(.5+aSeed)/max(-mv.z,.1),1.,16.*uPx);}`,
      fragmentShader: `varying float vA;varying float vS;uniform vec3 uColor;uniform float uOp;
void main(){float d=length(gl_PointCoord-.5);float a=smoothstep(.5,0.,d);a*=a;vec3 c=mix(vec3(.85,.9,1.),uColor,step(.55,vS));gl_FragColor=vec4(c,a*vA*uOp);}`,
    });
    const pts = new THREE.Points(g, mat); pts.frustumCulled = false; group.add(pts);
    return { pts, mat, g, n: d.n };
  });
  return {
    group,
    update(cam, t, px) { for (const l of layers) { l.mat.uniforms.uCam.value.copy(cam); l.mat.uniforms.uTime.value = t; l.mat.uniforms.uPx.value = px; } },
    setDensity(k) { for (const l of layers) l.g.setDrawRange(0, Math.max(100, Math.floor(l.n * k))); },
  };
}

/* ---------- Traînées du saut : lignes de lumière du centre vers les bords, dégradé de la marque ---------- */
export function createStreaks(n = 4200) {
  const base = new THREE.PlaneGeometry(1, 1);
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index; g.setAttribute('position', base.attributes.position); g.setAttribute('uv', base.attributes.uv);
  const r = mulberry(7), A = new Float32Array(n * 4), B = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    A[i * 4] = r() * Math.PI * 2;
    A[i * 4 + 1] = 0.7 + Math.pow(r(), 1.5) * 19;
    A[i * 4 + 2] = r();
    A[i * 4 + 3] = r();
    B[i * 4] = r(); B[i * 4 + 1] = r(); B[i * 4 + 2] = r();
  }
  g.setAttribute('aA', new THREE.InstancedBufferAttribute(A, 4)); g.setAttribute('aB', new THREE.InstancedBufferAttribute(B, 4));
  g.instanceCount = n;
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uTravel: { value: 0 }, uWarp: { value: 0 }, uLen: { value: 46 }, uAlpha: { value: 0 } },
    vertexShader: `attribute vec4 aA;attribute vec4 aB;uniform float uTravel,uWarp,uLen;varying float vAlong;varying float vFade;varying float vMix;varying float vX;
void main(){float L=140.;float sp=.55+aA.w*1.1;float zh=mod(aA.z*L+uTravel*sp,L)-L;
float len=(.05+uWarp*uLen*(.35+aA.w))*(.6+aB.x*.8);float al=position.y+.5;float z=zh-al*len;
vec2 dir=vec2(cos(aA.x),sin(aA.x));vec2 tg=vec2(-dir.y,dir.x);
float w=(.010+.024*aB.y)*(1.+uWarp*1.4)*(1.-.65*al);
vec3 p=vec3(dir*aA.y+tg*position.x*w,z);
vAlong=al;vMix=aB.z;vX=position.x*2.;vFade=smoothstep(-.7,-5.,zh)*(1.-smoothstep(-L*.7,-L,zh));
gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`,
    fragmentShader: `uniform float uAlpha;varying float vAlong;varying float vFade;varying float vMix;varying float vX;
void main(){float a=vAlong;
vec3 head=vec3(1.,.97,.92)*2.0;vec3 teal=vec3(.12,.72,.64)*1.25;vec3 blue=vec3(.18,.56,.88)*1.1;vec3 ind=vec3(.40,.33,.95)*1.0;
vec3 c=mix(head,teal,smoothstep(0.,.07,a));c=mix(c,blue,smoothstep(.12,.4,a));c=mix(c,ind,smoothstep(.38,.8,a));
c=mix(c,c*vec3(.82,1.,1.12),vMix*.6);
float alpha=pow(1.-a,.85)*vFade*uAlpha*.62*(1.-smoothstep(.45,1.,abs(vX)));
gl_FragColor=vec4(c,alpha);}`,
  });
  const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false; mesh.renderOrder = 5;
  return { mesh, mat, geo: g, n };
}

/* ---------- Passe finale : aberration chromatique + flou radial (saut), vignettage, grain, flash ---------- */
export const PostShader = {
  uniforms: { tDiffuse: { value: null }, uWarp: { value: 0 }, uFlash: { value: 0 }, uTime: { value: 0 }, uAspect: { value: 1.78 }, uGrain: { value: 0.026 } },
  vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader: `uniform sampler2D tDiffuse;uniform float uWarp,uFlash,uTime,uAspect,uGrain;varying vec2 vUv;
float hash(vec2 p){p=fract(p*vec2(443.897,441.423));p+=dot(p,p.yx+19.19);return fract((p.x+p.y)*p.x);}
void main(){vec2 c=vec2(.5);vec2 d=vUv-c;float r=length(d*vec2(uAspect,1.));
float ca=.0016+.015*uWarp*r;vec3 col;
if(uWarp<.004){col=vec3(texture2D(tDiffuse,c+d*(1.+ca)).r,texture2D(tDiffuse,vUv).g,texture2D(tDiffuse,c+d*(1.-ca)).b);}
else{float blur=.10*uWarp*smoothstep(.04,.85,r);col=vec3(0.);
for(int i=0;i<10;i++){float k=float(i)/9.;float s=1.-blur*k;
col+=vec3(texture2D(tDiffuse,c+d*s*(1.+ca)).r,texture2D(tDiffuse,c+d*s).g,texture2D(tDiffuse,c+d*s*(1.-ca)).b);}
col/=10.;}
col*=1.-.42*smoothstep(.32,1.1,length(d*vec2(uAspect*.85,1.)));
col+=(hash(vUv*vec2(1920.,1080.)+fract(uTime)*91.)-.5)*uGrain;
col+=vec3(.70,.88,1.)*uFlash*uFlash*1.5;
gl_FragColor=vec4(col,1.);}`,
};

/* ---------- Affiches instanciées (atlas unique) ---------- */
export function createPosterSet(count, atlas) {
  const geo = new THREE.PlaneGeometry(1, 1.5);
  const aUv = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
  const aMeta = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
  aMeta.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aUv', aUv); geo.setAttribute('aMeta', aMeta);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: true, side: THREE.DoubleSide,
    uniforms: { tMap: { value: atlas.texture }, uFogNear: { value: 6 }, uFogFar: { value: 46 }, uFocus: { value: 8 }, uFocusRange: { value: 16 }, uGlowPos: { value: new THREE.Vector3() }, uGlowCol: { value: new THREE.Vector3(0.2, 0.5, 1) }, uGlow: { value: 0 }, uBright: { value: 1 } },
    vertexShader: `attribute vec4 aUv;attribute vec4 aMeta;varying vec2 vUv;varying vec2 vL;varying float vA;varying float vDist;varying float vT;varying vec3 vW;
void main(){mat4 im=mat4(1.);
#ifdef USE_INSTANCING
im=instanceMatrix;
#endif
vec4 wp=modelMatrix*im*vec4(position,1.);vec4 mv=viewMatrix*wp;gl_Position=projectionMatrix*mv;
vUv=aUv.xy+uv*aUv.zw;vL=uv;vA=aMeta.x;vT=aMeta.y;vDist=-mv.z;vW=wp.xyz;}`,
    fragmentShader: `uniform sampler2D tMap;uniform float uFogNear,uFogFar,uFocus,uFocusRange,uGlow,uBright;uniform vec3 uGlowPos;uniform vec3 uGlowCol;
varying vec2 vUv;varying vec2 vL;varying float vA;varying float vDist;varying float vT;varying vec3 vW;
void main(){vec2 p=(vL-.5)*vec2(2.,3.);vec2 b=vec2(1.,1.5);float rad=.14;float d=length(max(abs(p)-b+rad,0.))-rad;
float edge=smoothstep(.012,-.012,d);if(edge<.01||vA<.01)discard;
float bias=clamp(abs(vDist-uFocus)/uFocusRange,0.,1.)*2.6;
vec3 c=texture2D(tMap,vUv,bias).rgb;
c=mix(c,c*vec3(.90,.97,1.1)+vec3(0.,.012,.035),.55);c*=uBright*(.86+vT*.28);
float rim=smoothstep(-.075,0.,d)*.55;c+=vec3(.55,.78,1.)*rim*.55;
float g=uGlow*smoothstep(14.,0.,distance(vW,uGlowPos));c+=uGlowCol*g*.35*(c.r+c.g+c.b)*.5+uGlowCol*g*.05;
float f=smoothstep(uFogNear,uFogFar,vDist);c*=1.-f;
gl_FragColor=vec4(c,edge*vA*(1.-f*.4));}`,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false;
  const ids = [];
  for (let i = 0; i < count; i++) { const c = (i * 7) % atlas.count; ids.push(c); const u = atlas.cellUv(c); aUv.setXYZW(i, u[0], u[1], u[2], u[3]); }
  aUv.needsUpdate = true;
  const m4 = new THREE.Matrix4(), id4 = new THREE.Matrix4().makeScale(0, 0, 0);
  return {
    mesh, mat, count, ids,
    set(i, pos, quat, scale, alpha, tint) { m4.compose(pos, quat, scale); mesh.setMatrixAt(i, m4); aMeta.setXYZW(i, alpha, tint, 0, 0); },
    hide(i) { mesh.setMatrixAt(i, id4); aMeta.setXYZW(i, 0, 0, 0, 0); },
    commit() { mesh.instanceMatrix.needsUpdate = true; aMeta.needsUpdate = true; },
  };
}
