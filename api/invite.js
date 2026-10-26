'use strict';
/*
 * Page publique d'invitation /u/<pseudo>?i=<code> (réécriture vercel.json → /api/invite?h=…&i=…).
 *  - Sans code, ou avec un code faux : AUCUNE information sur le profil (même page neutre).
 *  - Avec le bon code : avatar, nom et bouton « Ajouter X », rien d'autre (pas de liste, pas d'affiches).
 *  - Lecture via la RPC get_invite (clé publique) ; noindex, no-store, aucune ressource tierce.
 *  - La base limite à 3 mauvais codes par minute et par pseudo ; ici, 60 requêtes par minute et par IP.
 */
const { queryParams, supabaseUrl, timeoutSignal } = require('./_lib/common');
const S = require('./_lib/share');

const limited = S.makeLimiter(60);
const HANDLE_RE = /^[a-z0-9._]{3,20}$/;
const CODE_RE = /^[A-Za-z0-9]{12}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const TXT = {
  fr: { add: 'Ajouter {name}', lead: '{name} t’invite à devenir amis sur Cinepisode.', sub: 'Voyez ce que l’autre regarde, sans pub ni traceur.',
    noTitle: 'Invitation Cinepisode', noH: 'Demande le lien à ton ami', noP: 'Pour l’ajouter, il te faut son lien d’invitation ou son QR code. Il le trouve dans Amis → Inviter.',
    cta: 'Découvrir Cinepisode', create: 'Créer ma liste — gratuit', foot: 'Aucun cookie, aucun traceur sur cette page', busyH: 'Un instant…', busyP: 'Trop de requêtes. Réessaie dans une minute.',
    downH: 'Service momentanément indisponible', downP: 'Réessaie dans un instant.', someone: 'Quelqu’un' },
  en: { add: 'Add {name}', lead: '{name} invited you to be friends on Cinepisode.', sub: 'See what each other is watching. No ads, no trackers.',
    noTitle: 'Cinepisode invite', noH: 'Ask your friend for their link', noP: 'To add them, you need their invite link or QR code. They’ll find it under Friends → Invite.',
    cta: 'Discover Cinepisode', create: 'Start my list — free', foot: 'No cookies, no trackers on this page', busyH: 'Hold on…', busyP: 'Too many requests. Try again in a minute.',
    downH: 'Service temporarily unavailable', downP: 'Try again in a moment.', someone: 'Someone' },
};
function lang(req) { return /^\s*en\b/i.test(String((req.headers || {})['accept-language'] || '')) ? 'en' : 'fr'; }
const fill = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => v[k]);

async function fetchInvite(handle, code, fetchImpl) {
  handle = String(handle || '').toLowerCase();
  if (!HANDLE_RE.test(handle) || !CODE_RE.test(String(code || ''))) return null; /* aucune requête sans code valide */
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_AgSykBvnAW4cZmuMZJWnrA_lcFL5eT0';
  const r = await (fetchImpl || fetch)(supabaseUrl() + '/rest/v1/rpc/get_invite', {
    method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ p_handle: handle, p_code: code }), signal: timeoutSignal(4000),
  });
  if (!r.ok) throw new Error('upstream_' + r.status);
  const d = await r.json();
  return d && typeof d === 'object' && d.handle ? d : null;
}

const CSS = `:root{--bg:#0a0a0c;--t:#f0f0f0;--t2:#a1a1aa;--a:#5cc8ff}*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--t);font-family:'IBM Plex Sans',Inter,system-ui,sans-serif;min-height:100%}
.amb{position:fixed;inset:-20%;z-index:-1;background:radial-gradient(40% 35% at 30% 30%,rgba(92,200,255,.22),transparent 70%),radial-gradient(35% 30% at 75% 70%,rgba(58,123,255,.18),transparent 70%);filter:blur(40px);animation:amb 18s ease-in-out infinite alternate}
@keyframes amb{to{transform:translate(3%,-2%) rotate(6deg)}}
.top{display:flex;align-items:center;justify-content:space-between;padding:18px 28px}.logo{color:var(--t);text-decoration:none;font:900 19px Inter,sans-serif;letter-spacing:-.02em}.logo em{font-style:normal;color:var(--a)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:12px 22px;border-radius:999px;background:var(--a);color:#06070a;font:800 15px Inter,sans-serif;text-decoration:none;transition:background .2s,transform .3s cubic-bezier(.34,1.4,.5,1)}.btn:hover{background:#7ad4ff;transform:translateY(-2px)}
.btn.g{background:rgba(255,255,255,.07);color:var(--t);border:1px solid rgba(255,255,255,.12)}
main{min-height:calc(100vh - 140px);display:grid;grid-template-columns:minmax(0,1fr);place-items:center;padding:20px}
.card{width:420px;max-width:100%;text-align:center;padding:40px 28px 32px;border-radius:32px;background:rgba(22,22,26,.72);border:1px solid rgba(255,255,255,.1);backdrop-filter:blur(30px);-webkit-backdrop-filter:blur(30px);box-shadow:0 40px 100px rgba(0,0,0,.6);animation:in .5s cubic-bezier(.34,1.4,.5,1)}
@keyframes in{from{opacity:0;transform:translateY(16px) scale(.97)}}
.av{width:104px;height:104px;margin:0 auto 18px;border-radius:50%;display:grid;place-items:center;font:900 44px Inter,sans-serif;color:#06070a;box-shadow:0 0 0 4px rgba(10,10,12,1),0 0 0 6px rgba(92,200,255,.55),0 18px 50px rgba(92,200,255,.25)}
h1{font:900 30px/1.1 Inter,sans-serif;letter-spacing:-.02em;margin:0 0 6px}.h{color:var(--a);font:700 15px Inter,sans-serif;margin:0 0 16px}p{color:var(--t2);line-height:1.5;margin:0 0 6px}
.card .btn{width:100%;margin-top:22px;padding:15px}.made{text-align:center;color:#6b6b75;font-size:12px;padding:0 20px 28px}
@media(max-width:700px){.top{padding:12px 16px}.top .btn{padding:8px 14px;font-size:12.5px}.card{padding:32px 20px 24px}}
@media(prefers-reduced-motion:reduce){.amb,.card{animation:none}.btn{transition:none}}`;

function page(L, title, body) {
  return '<!doctype html><html lang="' + L + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
    '<meta name="robots" content="noindex,nofollow,noarchive"><meta name="referrer" content="no-referrer"><meta name="theme-color" content="#0a0a0c"><title>' + esc(title) + '</title>' +
    '<link rel="icon" href="/icons/icon-192.png"><link rel="stylesheet" href="/fonts/fonts.css"><style>' + CSS + '</style></head><body><div class="amb"></div>' +
    '<header class="top"><a class="logo" href="/">cin<em>episode</em></a><a class="btn g" href="/">' + esc(TXT[L].create) + '</a></header>' + body +
    '<footer class="made">Cinepisode · ' + esc(TXT[L].foot) + '</footer></body></html>';
}
function avatar(d) {
  const name = d.name || d.handle || '';
  const emoji = d.avatar && String(d.avatar).length <= 8 && !/[<>&"']/.test(d.avatar) ? d.avatar : '';
  const bg = COLOR_RE.test(d.avatar_color || '') ? d.avatar_color : '#5cc8ff';
  return '<div class="av" aria-hidden="true" style="background:' + bg + '">' + esc(emoji || (name[0] || 'C').toUpperCase()) + '</div>';
}
function render(d, code, L) {
  const T = TXT[L], name = d.name && d.name !== 'Moi' ? d.name : '@' + d.handle;
  const href = '/?ami=' + encodeURIComponent(d.handle) + '&i=' + encodeURIComponent(code);
  return page(L, fill(T.add, { name }) + ' · Cinepisode', '<main><section class="card">' + avatar(d) + '<h1>' + esc(name) + '</h1><p class="h">@' + esc(d.handle) + '</p>' +
    '<p>' + esc(fill(T.lead, { name })) + '</p><p>' + esc(T.sub) + '</p><a class="btn" href="' + esc(href) + '">' + esc(fill(T.add, { name })) + '</a></section></main>');
}
function neutral(L) {
  const T = TXT[L];
  return page(L, T.noTitle, '<main><section class="card"><div class="av" aria-hidden="true" style="background:linear-gradient(135deg,#5cc8ff,#3a7bff)">@</div><h1>' + esc(T.noH) + '</h1><p>' + esc(T.noP) + '</p><a class="btn" href="/">' + esc(T.cta) + '</a></section></main>');
}
function headers(res, status) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Vary', 'Accept-Language');
}
async function handler(req, res, deps) {
  deps = deps || {};
  const L = lang(req), T = TXT[L];
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Allow', 'GET, HEAD'); headers(res, 405); return res.end(''); }
  if (limited(S.clientIp(req) || 'na')) { res.setHeader('Retry-After', '60'); headers(res, 429); return res.end(page(L, 'Cinepisode', '<main><section class="card"><h1>' + esc(T.busyH) + '</h1><p>' + esc(T.busyP) + '</p></section></main>')); }
  const q = queryParams(req), h = String(q.get('h') || ''), code = String(q.get('i') || '');
  let d = null;
  try { d = await fetchInvite(h, code, deps.fetch); } catch (e) { headers(res, 502); return res.end(page(L, 'Cinepisode', '<main><section class="card"><h1>' + esc(T.downH) + '</h1><p>' + esc(T.downP) + '</p></section></main>')); }
  headers(res, 200); /* même statut avec ou sans profil trouvé : rien ne permet de deviner si le pseudo existe */
  res.end(d ? render(d, code, L) : neutral(L));
}
module.exports = handler;
module.exports._render = render;
module.exports._neutral = neutral;
module.exports._fetchInvite = fetchInvite;
