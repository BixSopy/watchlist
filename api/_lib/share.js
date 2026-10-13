'use strict';
/*
 * Outils des pages de partage public (/s/<jeton> → /api/share, aperçu /api/og).
 *  - Le jeton est validé (22 caractères base64url) AVANT toute requête.
 *  - Lecture via la RPC get_public_share avec la clé PUBLIQUE (publishable) : la base ne renvoie
 *    que les champs publics ; un lien inconnu et un lien révoqué donnent la même réponse.
 *  - Limite de débit par IP et par minute (par instance) ; l'IP n'est ni stockée ni journalisée.
 */
const { supabaseUrl, timeoutSignal } = require('./common');

const TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;
/* Clé publique du projet (la même que js/01-config.js) ; surchargeable par variable d'environnement */
const PUBLISHABLE_KEY_FALLBACK = 'sb_publishable_AgSykBvnAW4cZmuMZJWnrA_lcFL5eT0';
function publishableKey() { return process.env.SUPABASE_PUBLISHABLE_KEY || PUBLISHABLE_KEY_FALLBACK; }

function clientIp(req) {
  const h = req.headers || {};
  const first = (v) => String(v || '').split(',')[0].trim();
  return first(h['x-vercel-forwarded-for']) || first(h['x-real-ip']) || first(h['x-forwarded-for']) || '';
}
function makeLimiter(perMin) {
  const b = new Map();
  return function limited(key) {
    const now = Date.now();
    let e = b.get(key);
    if (!e || now - e.start > 60000) { e = { start: now, n: 0 }; b.set(key, e); }
    if (b.size > 5000) b.clear();
    return ++e.n > perMin;
  };
}

async function fetchShare(token, fetchImpl) {
  if (!TOKEN_RE.test(String(token || ''))) return null;
  const key = publishableKey();
  const r = await (fetchImpl || fetch)(supabaseUrl() + '/rest/v1/rpc/get_public_share', {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ p_token: token }),
    signal: timeoutSignal(4000),
  });
  if (!r.ok) throw new Error('upstream_' + r.status);
  const d = await r.json();
  return d && typeof d === 'object' && Array.isArray(d.items) ? d : null;
}

const STATUS_FR = { avoir: 'À voir', encours: 'En cours', termine: 'Terminé' };
const TYPE_FR = { film: 'Films', serie: 'Séries', anime: 'Anime' };
const TYPE_ONE = { film: 'film', serie: 'série', anime: 'anime' };
function displayName(d) { return (d && d.name) || 'Quelqu’un'; }
function filterLabel(d) {
  if (!d) return '';
  if (d.kind === 'profile') return 'Profil';
  if (d.kind === 'list') return 'Sa liste';
  const p = [].concat((d.filter_status || []).map((s) => STATUS_FR[s] || s), (d.filter_types || []).map((s) => TYPE_FR[s] || s));
  return p.join(', ');
}
/* « Pierre regarde 4 anime en ce moment », « La liste de Pierre · 33 titres »… */
function headline(d) {
  const n = d.items.length, who = displayName(d);
  const st = d.filter_status || [], ty = d.filter_types || [];
  if (d.kind === 'filtered' && st.length === 1 && st[0] === 'encours') {
    const what = ty.length === 1 ? (TYPE_ONE[ty[0]] + (n > 1 && ty[0] !== 'anime' ? 's' : '')) : (n > 1 ? 'titres' : 'titre');
    return who + ' regarde ' + n + ' ' + what + ' en ce moment';
  }
  if (d.kind === 'profile') return who + ' sur Cinepisode';
  return 'La liste de ' + who + (d.kind === 'filtered' ? ' · ' + filterLabel(d) : '');
}

module.exports = { TOKEN_RE, fetchShare, clientIp, makeLimiter, headline, filterLabel, displayName, STATUS_FR, TYPE_FR };
