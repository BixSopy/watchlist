/*
 * Aperçu Open Graph d'un lien de partage : GET /api/og?t=<jeton> → PNG 1200×630.
 * Fonction Node Vercel (@vercel/og). Lit uniquement get_public_share (champs publics).
 * Lien inconnu ou révoqué → carte générique Cinepisode, sans aucune donnée.
 * Cache CDN court (10 min) : une révocation coupe l'aperçu en moins de 10 min chez nous ;
 * les messageries gardent parfois leur propre copie.
 * Limite par IP et par minute (par instance) ; l'IP n'est ni stockée ni journalisée.
 */
import { ImageResponse } from '@vercel/og';
import { readFile } from 'node:fs/promises';

/* Runtime Node : l'Edge de Vercel refusait de compiler le wasm de @vercel/og (500). */
export const config = { runtime: 'nodejs' };

const TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;
const POSTER_RE = /^\/[A-Za-z0-9_.-]{1,80}$/;
const SUPA = ((typeof process !== 'undefined' && process.env && process.env.SUPABASE_URL) || 'https://batfulcvvquffgfeppcx.supabase.co').replace(/\/+$/, '');
const KEY = (typeof process !== 'undefined' && process.env && process.env.SUPABASE_PUBLISHABLE_KEY) || 'sb_publishable_AgSykBvnAW4cZmuMZJWnrA_lcFL5eT0';
const TYPE_ONE = { film: 'film', serie: 'série', anime: 'anime' };
const STATUS_FR = { avoir: 'À voir', encours: 'En cours', termine: 'Terminé' };
const TYPE_FR = { film: 'Films', serie: 'Séries', anime: 'Anime' };
const hits = new Map();
function limited(ip) {
  const now = Date.now(); let e = hits.get(ip);
  if (!e || now - e.start > 60000) { e = { start: now, n: 0 }; hits.set(ip, e); }
  if (hits.size > 5000) hits.clear();
  return ++e.n > 30;
}

export function headline(d) {
  const n = d.items.length, who = d.name || 'Quelqu’un', st = d.filter_status || [], ty = d.filter_types || [];
  if (d.kind === 'filtered' && st.length === 1 && st[0] === 'encours') {
    const what = ty.length === 1 ? (TYPE_ONE[ty[0]] + (n > 1 && ty[0] !== 'anime' ? 's' : '')) : (n > 1 ? 'titres' : 'titre');
    return [who + ' regarde', n + ' ' + what + ' en ce moment'];
  }
  if (d.kind === 'profile') return [who, 'sur Cinepisode'];
  const f = d.kind === 'filtered' ? [].concat(st.map((s) => STATUS_FR[s] || s), ty.map((s) => TYPE_FR[s] || s)).join(', ') : n + ' titre' + (n > 1 ? 's' : '');
  return ['La liste de ' + who, f];
}
export function kicker(d) { return d.kind === 'profile' ? 'Profil public' : 'Liste partagée'; }

const h = (type, props, ...children) => ({ type, props: Object.assign({}, props, { children: children.length > 1 ? children : children[0] }), key: null });

function logo() {
  return h('div', { style: { display: 'flex', alignItems: 'center', fontSize: 28, fontWeight: 800, color: '#fff' } },
    h('div', { style: { width: 36, height: 36, borderRadius: 10, marginRight: 12, background: 'linear-gradient(135deg,#5cc8ff,#3a7bff)' } }),
    h('span', {}, 'cin'), h('span', { style: { color: '#5cc8ff' } }, 'episode'));
}
export function cardTree(d) {
  const W = 1200, H = 630;
  if (!d) {
    return h('div', { style: { width: W, height: H, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: 80, fontFamily: 'Inter', fontWeight: 500, background: 'linear-gradient(135deg,#0a0a0c,#14213a)', color: '#fff' } },
      logo(), h('div', { style: { fontSize: 60, fontWeight: 800, marginTop: 30, letterSpacing: -2 } }, 'Suis tes séries sans effort'),
      h('div', { style: { fontSize: 26, color: '#a1a1aa', marginTop: 12 } }, 'Films, séries et anime · aucun traceur'));
  }
  const posters = d.items.filter((i) => POSTER_RE.test(i.poster_path || '')).slice(0, 3).map((i) => 'https://image.tmdb.org/t/p/w342' + i.poster_path);
  const [l1, l2] = headline(d);
  const names = d.items.slice(0, 4).map((i) => i.title).join(' · ');
  const pos = [{ left: 250, top: 70, rot: 8 }, { left: 130, top: 40, rot: 3 }, { left: 10, top: 60, rot: -6 }];
  return h('div', { style: { width: W, height: H, display: 'flex', position: 'relative', background: '#0a0a0c', color: '#fff', overflow: 'hidden', fontFamily: 'Inter', fontWeight: 500 } },
    posters[0] ? h('img', { src: posters[0], width: 1400, height: 2100, style: { position: 'absolute', left: -100, top: -700, opacity: 0.28, filter: 'blur(40px)' } }) : null,
    h('div', { style: { position: 'absolute', inset: 0, display: 'flex', background: 'linear-gradient(90deg,rgba(10,10,12,.92) 30%,rgba(10,10,12,.35))' } }),
    h('div', { style: { position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'center', width: 680, padding: '0 0 0 64px' } },
      h('div', { style: { fontSize: 18, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: '#5cc8ff' } }, kicker(d)),
      h('div', { style: { display: 'flex', flexDirection: 'column', fontSize: 62, fontWeight: 800, letterSpacing: -2, lineHeight: 1.05, margin: '12px 0 16px' } }, h('span', {}, l1.slice(0, 40)), h('span', {}, l2.slice(0, 40))),
      h('div', { style: { fontSize: 24, color: '#a1a1aa', display: 'flex' } }, names.slice(0, 80))),
    h('div', { style: { position: 'absolute', right: 40, top: 100, width: 470, height: 420, display: 'flex' } },
      ...posters.slice().reverse().map((src, k) => { const p = pos[3 - posters.length + k] || pos[k]; return h('img', { src, width: 210, height: 315, style: { position: 'absolute', left: p.left, top: p.top, borderRadius: 18, transform: 'rotate(' + p.rot + 'deg)', boxShadow: '0 30px 60px rgba(0,0,0,.6)' } }); })),
    h('div', { style: { position: 'absolute', left: 64, bottom: 48, display: 'flex' } }, logo()));
}

export async function loadShare(token, fetchImpl) {
  if (!TOKEN_RE.test(String(token || ''))) return null;
  const r = await (fetchImpl || fetch)(SUPA + '/rest/v1/rpc/get_public_share', {
    method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_token: token }),
  });
  if (!r.ok) return null;
  const d = await r.json();
  return d && Array.isArray(d.items) ? d : null;
}

let fontsP = null;
function loadFonts() {
  if (!fontsP) fontsP = Promise.all(['Inter-Medium', 'Inter-ExtraBold'].map((n) => readFile(new URL('./_fonts/' + n + '.ttf', import.meta.url)).then((b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))))
    .then(([m, b]) => [{ name: 'Inter', data: m, weight: 500, style: 'normal' }, { name: 'Inter', data: b, weight: 800, style: 'normal' }])
    .catch(() => { fontsP = null; return undefined; });
  return fontsP;
}

export async function GET(req) {
  const ip = (req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for') || 'na').split(',')[0].trim();
  if (limited(ip)) return new Response('Too many requests', { status: 429, headers: { 'Retry-After': '60', 'Cache-Control': 'no-store' } });
  const t = new URL(req.url).searchParams.get('t');
  let d = null;
  try { d = await loadShare(t); } catch (e) { d = null; }
  const fonts = await loadFonts();
  const img = new ImageResponse(cardTree(d), Object.assign({ width: 1200, height: 630 }, fonts ? { fonts } : {}));
  /* ImageResponse impose « immutable, 1 an » : on le remplace (une révocation doit couper l'aperçu) */
  const hd = new Headers(img.headers);
  hd.set('Cache-Control', d ? 'public, max-age=300, s-maxage=600' : 'public, max-age=60, s-maxage=60');
  hd.set('X-Robots-Tag', 'noindex'); hd.set('Referrer-Policy', 'no-referrer');
  return new Response(img.body, { status: 200, headers: hd });
}
