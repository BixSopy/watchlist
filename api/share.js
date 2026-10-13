'use strict';
/*
 * Page publique en lecture seule : GET /s/<jeton> (réécrit vers /api/share?t=<jeton>).
 * HTML rendu côté serveur (aucun script, aucun cookie, aucun traceur), DA « Cinéma » P3.
 * Jamais mis en cache partagé : une révocation prend effet immédiatement.
 * noindex (meta + X-Robots-Tag), Referrer-Policy: no-referrer.
 */
const { queryParams } = require('./_lib/common');
const S = require('./_lib/share');

const limited = S.makeLimiter(60);
const IMG = 'https://image.tmdb.org/t/p/';
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const POSTER_RE = /^\/[A-Za-z0-9_.-]{1,80}$/;
const pad = (n) => String(n).padStart(2, '0');

function origin(req) {
  const h = req.headers || {};
  const host = String(h['x-forwarded-host'] || h.host || '').split(',')[0].trim();
  return /^[a-z0-9.-]+(:\d+)?$/i.test(host) ? (/^(localhost|127\.)/.test(host) ? 'http://' : 'https://') + host : '';
}

function card(it, d) {
  const poster = POSTER_RE.test(it.poster_path || '') ? it.poster_path : '';
  const kind = it.type === 'film' ? 'Film' : it.type === 'serie' ? 'Série' : 'Anime';
  const cls = it.type === 'film' ? 'f' : it.type === 'serie' ? 's' : 'an';
  const ep = it.season && it.episode ? 'S' + pad(it.season) + ' · E' + pad(it.episode) : '';
  const add = (it.tmdb_type === 'tv' || it.tmdb_type === 'movie') && it.tmdb_id
    ? '/?' + new URLSearchParams({ ajouter: it.tmdb_type + '.' + it.tmdb_id, t: String(it.title || '').slice(0, 200), y: String(it.year || '').slice(0, 4), p: poster }).toString()
    : '';
  return '<li class="pc">' +
    '<div class="im">' + (poster ? '<img src="' + IMG + 'w342' + esc(poster) + '" alt="" loading="lazy" decoding="async">' : '<span class="ph">' + esc(kind) + '</span>') +
    (ep ? '<span class="ep">' + esc(ep) + '</span>' : '') +
    (add ? '<a class="add" href="' + esc(add) + '" title="Ajouter à ma liste" aria-label="Ajouter ' + esc(it.title) + ' à ma liste">＋</a>' : '') + '</div>' +
    '<h3>' + esc(it.title) + '</h3><p><span class="bdg ' + cls + '">' + esc(kind) + '</span>' + esc(it.year || '') +
    (it.rating ? ' · <span class="r">★ ' + esc(Number(it.rating).toFixed(Number(it.rating) % 1 ? 1 : 0)) + '</span>' : '') + '</p></li>';
}

const CSS = `:root{--bg:#0a0a0c;--t:#f5f5f7;--t2:#a1a1aa;--t3:#6b6b75;--a:#5cc8ff;--grad:linear-gradient(135deg,#5cc8ff,#3a7bff);--glass:rgba(28,28,32,.55)}
*{box-sizing:border-box}html{background:var(--bg)}body{margin:0;background:var(--bg);color:var(--t);font:14px/1.4 Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased;overflow-x:hidden}
a{color:inherit;text-decoration:none}
.amb{position:fixed;inset:0;pointer-events:none;background:radial-gradient(900px 500px at 15% -10%,rgba(92,200,255,.16),transparent 60%),radial-gradient(800px 600px at 100% 30%,rgba(120,80,255,.10),transparent 60%)}
.top{position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:space-between;padding:14px 40px;background:rgba(10,10,12,.72);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border-bottom:1px solid rgba(255,255,255,.05)}
.logo{display:flex;align-items:center;font:800 19px Inter,sans-serif;letter-spacing:-.02em}.logo i{width:24px;height:24px;margin-right:9px;border-radius:7px;background:var(--grad);box-shadow:0 4px 14px rgba(92,200,255,.35)}.logo em{font-style:normal;color:var(--a)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:10px 18px;border-radius:999px;font-weight:650;font-size:13.5px;background:var(--grad);color:#fff;box-shadow:0 8px 24px rgba(58,123,255,.35)}
main{position:relative;max-width:1240px;margin:0 auto;padding:40px 40px 20px}
.pub{display:flex;gap:22px;align-items:center;margin-bottom:26px}.av{flex-shrink:0;width:76px;height:76px;border-radius:50%;background:var(--grad);display:grid;place-items:center;font:850 30px Inter,sans-serif;box-shadow:0 10px 30px rgba(58,123,255,.4)}
h1{font:850 40px Inter,sans-serif;letter-spacing:-.04em;margin:0;line-height:1.08}.sub{color:var(--t2);margin:6px 0 0}
.ro{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--t3);border:1px solid rgba(255,255,255,.12);padding:3px 9px;border-radius:999px;margin-left:10px;vertical-align:middle}
.stats{display:flex;gap:12px;margin-bottom:28px;flex-wrap:wrap;padding:0;list-style:none}.stats li{padding:14px 20px;border-radius:18px;min-width:120px;background:var(--glass);border:1px solid rgba(255,255,255,.09)}.stats b{display:block;font:850 24px Inter,sans-serif}.stats span{font-size:12px;color:var(--t2)}
.grid{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:26px 20px}
.pc{min-width:0}.pc .im{position:relative;aspect-ratio:2/3;border-radius:16px;overflow:hidden;background:#17171b;box-shadow:0 18px 40px rgba(0,0,0,.5);transition:transform .4s cubic-bezier(.2,.8,.2,1)}
.pc:hover .im{transform:translateY(-4px)}.pc img{width:100%;height:100%;object-fit:cover;display:block}.pc .ph{display:grid;place-items:center;height:100%;color:var(--t3)}
.pc .ep{position:absolute;left:8px;bottom:8px;font:600 10.5px 'IBM Plex Mono',monospace;background:rgba(0,0,0,.62);padding:2px 6px;border-radius:6px}
.pc .add{position:absolute;top:8px;right:8px;width:32px;height:32px;border-radius:50%;background:rgba(10,10,12,.7);backdrop-filter:blur(8px);display:grid;place-items:center;font-size:17px;border:1px solid rgba(255,255,255,.15);transition:background .2s}.pc .add:hover{background:#3a7bff}
.pc h3{font-size:14px;font-weight:650;margin:10px 0 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pc p{margin:0;color:var(--t2);font-size:12px;display:flex;gap:6px;align-items:center}.r{color:#ffc861}
.bdg{font-size:11px;font-weight:600;padding:3px 8px;border-radius:6px;background:rgba(255,255,255,.08)}.bdg.f{background:rgba(92,200,255,.14);color:#8ad6ff}.bdg.s{background:rgba(75,232,122,.12);color:#6de89a}.bdg.an{background:rgba(255,165,80,.15);color:#ffb060}
.empty{padding:60px 0;text-align:center;color:var(--t2)}
.cta{margin:44px 0 30px;padding:30px;border-radius:28px;display:flex;gap:20px;align-items:center;flex-wrap:wrap;background:linear-gradient(120deg,rgba(58,123,255,.18),rgba(92,200,255,.06));border:1px solid rgba(92,200,255,.25)}
.cta h2{font:850 22px Inter,sans-serif;margin:0 0 4px;letter-spacing:-.02em}.cta p{color:var(--t2);margin:0}.cta .btn{margin-left:auto}
.made{text-align:center;color:var(--t3);font-size:12px;padding:0 20px 34px}.made b{color:var(--t2)}
.nf{min-height:70vh;display:grid;place-items:center;text-align:center}.nf h1{font-size:34px}.nf p{color:var(--t2);margin:10px 0 24px}
@media(max-width:700px){.top{padding:12px 16px}.top .btn{padding:8px 14px;font-size:12.5px}main{padding:24px 16px 10px}h1{font-size:28px}.av{width:56px;height:56px;font-size:22px}.pub{gap:14px}
.grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:20px 14px}.cta{padding:22px}.cta .btn{margin-left:0;width:100%}.ro{margin:6px 0 0}}
@media(prefers-reduced-motion:reduce){.pc .im{transition:none}}`;

function page(o) {
  return '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
    '<meta name="robots" content="noindex,nofollow,noarchive"><meta name="referrer" content="no-referrer"><meta name="theme-color" content="#0a0a0c">' +
    '<title>' + esc(o.title) + '</title><meta name="description" content="' + esc(o.desc) + '">' +
    '<meta property="og:type" content="website"><meta property="og:site_name" content="Cinepisode"><meta property="og:title" content="' + esc(o.title) + '"><meta property="og:description" content="' + esc(o.desc) + '">' +
    (o.image ? '<meta property="og:image" content="' + esc(o.image) + '"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="' + esc(o.image) + '">' : '') +
    '<link rel="icon" href="/icons/icon-192.png"><link rel="stylesheet" href="/fonts/fonts.css"><style>' + CSS + '</style></head><body><div class="amb"></div>' +
    '<header class="top"><a class="logo" href="/"><i></i>cin<em>episode</em></a><a class="btn" href="/">Créer ma liste — gratuit</a></header>' + o.body +
    '<footer class="made">Créé avec <b>Cinepisode</b> · Lecture seule · Aucun cookie, aucun traceur sur cette page</footer></body></html>';
}

function render(d, token, base) {
  const who = S.displayName(d), n = d.items.length;
  const title = S.headline(d);
  const sub = (d.kind === 'filtered' ? S.filterLabel(d) + ' · ' : '') + n + ' titre' + (n > 1 ? 's' : '');
  const st = d.stats;
  const body = '<main><section class="pub"><div class="av" aria-hidden="true">' + esc((who[0] || 'C').toUpperCase()) + '</div><div><h1>' + esc(title) + '<span class="ro">Lecture seule</span></h1><p class="sub">' + esc(sub) + '</p></div></section>' +
    (st ? '<ul class="stats"><li><b>' + esc(st.titles) + '</b><span>titres suivis</span></li><li><b>' + esc(st.episodes) + '</b><span>épisodes vus</span></li><li><b>' + esc(st.finished) + '</b><span>terminés</span></li>' +
      (st.top_type ? '<li><b>' + esc(S.TYPE_FR[st.top_type] || st.top_type) + '</b><span>le plus suivi</span></li>' : '') + '</ul>' : '') +
    (n ? '<ul class="grid">' + d.items.map((it) => card(it, d)).join('') + '</ul>' : '<p class="empty">Rien à afficher pour l’instant.</p>') +
    '<section class="cta"><div><h2>Suis tes séries sans effort</h2><p>Cinepisode détecte ce que tu regardes sur Netflix, Crunchyroll, Disney+… Aucun traceur, aucune pub.</p></div><a class="btn" href="/">Créer avec Cinepisode</a></section></main>';
  const names = d.items.slice(0, 4).map((i) => i.title).join(' · ');
  return page({ title: title + ' · Cinepisode', desc: names ? names + ' — liste en lecture seule sur Cinepisode' : 'Liste en lecture seule sur Cinepisode', image: base ? base + '/api/og?t=' + encodeURIComponent(token) : '', body });
}
function notFound() {
  return page({ title: 'Lien indisponible · Cinepisode', desc: 'Ce lien de partage n’existe pas ou a été désactivé.',
    body: '<main class="nf"><div><h1>Ce lien n’est plus disponible</h1><p>Il n’existe pas ou son auteur l’a désactivé.</p><a class="btn" href="/">Découvrir Cinepisode</a></div></main>' });
}

function headers(res, status) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

async function handler(req, res, deps) {
  deps = deps || {};
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Allow', 'GET, HEAD'); headers(res, 405); return res.end(''); }
  if (limited(S.clientIp(req) || 'na')) { res.setHeader('Retry-After', '60'); headers(res, 429); return res.end(page({ title: 'Trop de requêtes · Cinepisode', desc: '', body: '<main class="nf"><div><h1>Un instant…</h1><p>Trop de requêtes. Réessaie dans une minute.</p></div></main>' })); }
  const t = String(queryParams(req).get('t') || '');
  let d = null;
  try { d = await S.fetchShare(t, deps.fetch); } catch (e) { headers(res, 502); return res.end(page({ title: 'Cinepisode', desc: '', body: '<main class="nf"><div><h1>Service momentanément indisponible</h1><p>Réessaie dans un instant.</p></div></main>' })); }
  if (!d) { headers(res, 404); return res.end(notFound()); }
  headers(res, 200);
  res.end(render(d, t, origin(req)));
}
module.exports = handler;
module.exports._render = render;
module.exports._limited = limited;
