/* Test du « saut » : l'effet hyperespace à lui seul, en une seule passe plein écran (aucune géométrie, aucune
   dépendance, très léger pour le GPU). Deux scènes d'exemple (A, B) ; le saut part de A, coupe à mi-course, arrive
   sur B avec une légère déformation de l'image qui revient en place en rebondissant.
   - plein de petits traits fins, aux couleurs de la marque (tête blanche → turquoise → bleu → indigo)
   - accélération rapide puis freinage net, fond noir pur (pas de voile)
   - à la sortie : effet de lentille (bombé) amorti + petit « coup » de zoom */
import { createAtlas, drawMonitorPlayer, drawTablet } from './screens.js';

const $ = (id) => document.getElementById(id);
const gl = $('gl').getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
if (!gl) { $('nogl').hidden = false; $('panel').hidden = true; throw new Error('webgl2'); }

/* ---------- Réglages (modifiables au curseur) ---------- */
const P = { duree: 1.1, densite: 0.55, longueur: 0.7, vitesse: 1.0, deformation: 0.3, rebond: 3.2, lueur: 0.35, aberration: 0.25 };
const DEF = {
  duree: ['Durée (s)', 0.6, 2.4, 0.05], densite: ['Densité des traits', 0.1, 1, 0.01], longueur: ['Longueur des traits', 0.2, 2, 0.05],
  vitesse: ['Vitesse des traits', 0.3, 3, 0.05], deformation: ['Déformation sortie', 0, 1, 0.01], rebond: ['Rebond (osc./s)', 0, 8, 0.1],
  lueur: ['Lueur des traits', 0, 1, 0.01], aberration: ['Aberration couleur', 0, 1, 0.01],
};
try { Object.assign(P, JSON.parse(decodeURIComponent(location.hash.slice(1) || '{}'))); } catch (e) { /* hash libre */ }

/* ---------- Scènes d'exemple (2D), plaquées en texture ---------- */
const W = 1920, H = 1080;
function stars(x, n, seed) {
  let s = seed; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < n; i++) { const a = Math.pow(r(), 3) * 0.8 + 0.15; x.fillStyle = r() < 0.2 ? 'rgba(170,200,255,' + a + ')' : 'rgba(255,248,235,' + a + ')'; x.fillRect(r() * W, r() * H, r() < 0.06 ? 2.2 : 1.2, r() < 0.06 ? 2.2 : 1.2); }
}
function aura(x, cx, cy, rad) {
  const g = x.createRadialGradient(cx, cy, rad * 0.05, cx, cy, rad);
  g.addColorStop(0, 'rgba(91,79,224,.34)'); g.addColorStop(0.5, 'rgba(47,143,209,.14)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
}
function frame(x, dx, dy, w, h, r, draw, tw, th) {
  const c = document.createElement('canvas'); c.width = tw; c.height = th; draw(c.getContext('2d'), tw, th);
  x.save(); x.shadowColor = 'rgba(47,143,209,.45)'; x.shadowBlur = 90; x.beginPath(); x.roundRect(dx - 8, dy - 8, w + 16, h + 16, r + 8); x.fillStyle = '#0b0e16'; x.fill(); x.restore();
  x.save(); x.beginPath(); x.roundRect(dx, dy, w, h, r); x.clip(); x.drawImage(c, 0, 0, tw, th, dx, dy, w, h); x.restore();
}
function sceneCanvas(kind, atlas) {
  const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
  x.fillStyle = '#000'; x.fillRect(0, 0, W, H);
  aura(x, W * (kind === 'A' ? 0.52 : 0.5), H * 0.5, H * 0.95); stars(x, 520, kind === 'A' ? 11 : 29);
  if (kind === 'A') frame(x, W / 2 - 520, H / 2 - 335, 1040, 650, 20, (c2, w, h) => drawMonitorPlayer(c2, w, h, 0.8, 1, 0), 1792, 1120);
  else frame(x, W / 2 - 230, H / 2 - 390, 460, 780, 34, (c2, w, h) => drawTablet(c2, w, h, atlas, 1.5), 1344, 1792);
  x.fillStyle = 'rgba(236,231,222,.55)'; x.font = '500 18px "IBM Plex Mono", monospace'; x.fillText(kind === 'A' ? '01 — Studio Display' : '03 — iPad Pro', 44, H - 44);
  return c;
}

/* ---------- WebGL : une passe plein écran ---------- */
const VS = '#version 300 es\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}';
const FS = `#version 300 es
precision highp float;
uniform sampler2D uA,uB;uniform vec2 uRes;uniform float uT,uWarp,uMix,uDim,uDist,uZoom,uFlash,uDens,uLen,uSpd,uGlow,uCA;
out vec4 o;
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
void main(){vec2 uv=gl_FragCoord.xy/uRes,d=uv-.5;float asp=uRes.x/uRes.y;vec2 dd=d*vec2(asp,1.);float r2=dot(dd,dd);
vec2 su=.5+d*(1.+uDist*r2*4.)/uZoom;vec2 su2=.5+d*(1.+uDist*(1.+uCA*.5)*r2*4.)/uZoom,su3=.5+d*(1.+uDist*(1.-uCA*.5)*r2*4.)/uZoom;
vec3 ca=vec3(mix(texture(uA,vec2(su2.x,1.-su2.y)).r,texture(uB,vec2(su2.x,1.-su2.y)).r,uMix),
mix(texture(uA,vec2(su.x,1.-su.y)).g,texture(uB,vec2(su.x,1.-su.y)).g,uMix),
mix(texture(uA,vec2(su3.x,1.-su3.y)).b,texture(uB,vec2(su3.x,1.-su3.y)).b,uMix));
vec3 col=ca*(1.-uDim);col+=streaks(dd)*uWarp;col=1.-exp(-col*1.25);col*=1.15;
col+=vec3(.55,.6,1.)*uFlash*(1.-smoothstep(0.,.9,length(dd)));
col*=1.-.35*smoothstep(.45,1.1,length(dd));o=vec4(col,1.);}`;

function sh(t, s) { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; }
const prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
gl.useProgram(prog);
const U = {}; for (const n of ['uA', 'uB', 'uRes', 'uT', 'uWarp', 'uMix', 'uDim', 'uDist', 'uZoom', 'uFlash', 'uDens', 'uLen', 'uSpd', 'uGlow', 'uCA']) U[n] = gl.getUniformLocation(prog, n);
function tex(unit, canvas) {
  const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}
async function setup() {
  await Promise.race([Promise.all([document.fonts.load('600 40px Inter'), document.fonts.load('500 20px "IBM Plex Mono"')]).catch(() => {}), new Promise((r) => setTimeout(r, 1500))]);
  const atlas = createAtlas();
  tex(0, sceneCanvas('A', atlas)); tex(1, sceneCanvas('B', atlas));
  gl.uniform1i(U.uA, 0); gl.uniform1i(U.uB, 1);
}

/* ---------- Chronologie du saut ---------- */
const sm = (a, b, x) => { x = Math.min(1, Math.max(0, (x - a) / (b - a))); return x * x * (3 - 2 * x); };
function state(s, dir) {
  const CUT = 0.5, pre = Math.min(1, s / CUT), post = Math.max(0, (s - CUT) / (1 - CUT)), t2 = post * P.duree * (1 - CUT);
  const warp = s < CUT ? Math.pow(pre, 2.2) : Math.pow(1 - Math.min(1, post / 0.62), 2.5);
  const dim = s < CUT ? sm(0, 0.6, pre) : 1 - sm(0, 0.42, post);
  const bounce = Math.exp(-t2 / 0.2) * Math.cos(2 * Math.PI * P.rebond * t2);
  const dist = s < CUT ? -0.16 * P.deformation * pre * pre : P.deformation * 0.9 * bounce;
  const zoom = s < CUT ? 1 + 0.03 * pre * pre : 1 - 0.07 * P.deformation * bounce;
  const flash = Math.exp(-Math.pow((s - CUT) / 0.035, 2)) * 0.3;
  return { warp, dim, dist, zoom, flash, mix: dir ? 1 - (s < CUT ? 0 : 1) : (s < CUT ? 0 : 1) };
}
let playing = false, t0 = 0, dir = 0, travelT = 3, seekS = null, idle = 0;
function draw(S, T) {
  const w = Math.round(innerWidth * Math.min(devicePixelRatio || 1, 1.5)), h = Math.round(innerHeight * Math.min(devicePixelRatio || 1, 1.5));
  const c = $('gl'); if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  gl.viewport(0, 0, w, h);
  gl.uniform2f(U.uRes, w, h); gl.uniform1f(U.uT, T); gl.uniform1f(U.uWarp, S.warp); gl.uniform1f(U.uMix, S.mix); gl.uniform1f(U.uDim, S.dim);
  gl.uniform1f(U.uDist, S.dist); gl.uniform1f(U.uZoom, S.zoom); gl.uniform1f(U.uFlash, S.flash); gl.uniform1f(U.uDens, P.densite);
  gl.uniform1f(U.uLen, P.longueur); gl.uniform1f(U.uSpd, P.vitesse); gl.uniform1f(U.uGlow, P.lueur); gl.uniform1f(U.uCA, P.aberration);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}
let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (seekS !== null) { draw(state(seekS, dir), 5 + seekS * P.duree * 4); return; }
  if (playing) {
    const s = (now - t0) / 1000 / P.duree, S = state(Math.min(1, s), dir);
    travelT += dt * (1.5 + 7 * S.warp);
    draw(S, travelT);
    if (s >= 1) { playing = false; dir = 1 - dir; if ($('loop').checked) setTimeout(play, 650); }
  } else { idle += dt; draw({ warp: 0, dim: 0, dist: 0, zoom: 1, flash: 0, mix: dir }, travelT); }
}
function play() { if (playing) return; playing = true; t0 = performance.now(); }

/* ---------- Interface ---------- */
const box = $('sliders');
for (const k in DEF) {
  const [lab, mn, mx, st] = DEF[k], row = document.createElement('label'); row.className = 's';
  row.innerHTML = '<span>' + lab + '</span><input type="range" min="' + mn + '" max="' + mx + '" step="' + st + '" value="' + P[k] + '"><output>' + P[k] + '</output>';
  const inp = row.querySelector('input'), out = row.querySelector('output');
  inp.addEventListener('input', () => { P[k] = +inp.value; out.textContent = P[k]; sync(); });
  box.appendChild(row);
}
function sync() { $('json').textContent = JSON.stringify(P); try { history.replaceState(null, '', '#' + encodeURIComponent(JSON.stringify(P))); } catch (e) { /* ignoré */ } }
sync();
$('play').addEventListener('click', play);
addEventListener('keydown', (e) => { if (e.code === 'Space' && !e.target.closest('input,button')) { e.preventDefault(); play(); } });
$('copy').addEventListener('click', () => navigator.clipboard?.writeText(JSON.stringify(P)).catch(() => {}));

setup().then(() => {
  window.__travel = { P, seek(s, d = 0) { dir = d; seekS = s; }, free() { seekS = null; }, play };
  requestAnimationFrame(loop);
  if (new URLSearchParams(location.search).has('auto')) setTimeout(play, 600);
});
