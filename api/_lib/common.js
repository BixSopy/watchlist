'use strict';
/*
 * Outils partagés par les fonctions /api (Vercel, Node, sans dépendance).
 * Les fichiers de api/_lib ne sont pas exposés comme routes (préfixe « _ »).
 *
 * Principes :
 *  - aucune clé d'API ne sort de la fonction (ni dans les réponses, ni dans les logs) ;
 *  - toute requête doit porter une session Supabase valide (Authorization: Bearer <jwt>) ;
 *  - les erreurs ne sont jamais mises en cache (Cache-Control: no-store) ;
 *  - le CDN Vercel ne met pas en cache une requête qui porte un en-tête Authorization :
 *    chaque appel passe donc par la vérification de session. Le cache se fait côté
 *    navigateur (private) et en mémoire dans la fonction (données TMDB/OMDb identiques
 *    pour tous les utilisateurs).
 */

const DEFAULT_SUPABASE_URL = 'https://batfulcvvquffgfeppcx.supabase.co';

function supabaseUrl() {
  return (process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/+$/, '');
}

function send(res, status, body, cacheControl) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Vary', 'Authorization');
  res.setHeader('Cache-Control', status === 200 && cacheControl ? cacheControl : 'no-store');
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function fail(res, status, code, message) {
  send(res, status, { error: code, message: message });
}

/* ---- Petit cache mémoire borné (par instance de fonction) ---- */
function makeCache(maxEntries) {
  const map = new Map();
  return {
    get(key) {
      const hit = map.get(key);
      if (!hit) return null;
      if (hit.exp < Date.now()) { map.delete(key); return null; }
      map.delete(key); map.set(key, hit); /* LRU */
      return hit.value;
    },
    set(key, value, ttlMs) {
      if (map.has(key)) map.delete(key);
      map.set(key, { value: value, exp: Date.now() + ttlMs });
      while (map.size > maxEntries) map.delete(map.keys().next().value);
    },
    clear() { map.clear(); },
  };
}

/* ---- Vérification de session Supabase ---- */
const authCache = makeCache(500);
const AUTH_TTL_MS = 60 * 1000;
const JWT_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

function bearerToken(req) {
  const h = req.headers && (req.headers.authorization || req.headers.Authorization);
  if (!h || typeof h !== 'string') return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const tok = m[1].trim();
  if (tok.length > 4096 || !JWT_RE.test(tok)) return null;
  return tok;
}

function allowedEmails() {
  return (process.env.ALLOWED_EMAILS || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/* Renvoie { ok:true, userId } ou { ok:false, status, code } */
async function verifySession(req) {
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!anonKey) return { ok: false, status: 500, code: 'server_config' };
  const token = bearerToken(req);
  if (!token) return { ok: false, status: 401, code: 'auth_required' };

  let user = authCache.get(token);
  if (!user) {
    let r;
    try {
      r = await fetch(supabaseUrl() + '/auth/v1/user', {
        headers: { Authorization: 'Bearer ' + token, apikey: anonKey },
      });
    } catch (e) {
      return { ok: false, status: 503, code: 'auth_unavailable' };
    }
    if (r.status === 401 || r.status === 403) return { ok: false, status: 401, code: 'auth_invalid' };
    if (!r.ok) return { ok: false, status: 503, code: 'auth_unavailable' };
    let data;
    try { data = await r.json(); } catch (e) { return { ok: false, status: 503, code: 'auth_unavailable' }; }
    if (!data || !data.id) return { ok: false, status: 401, code: 'auth_invalid' };
    user = { id: String(data.id), email: String(data.email || '').toLowerCase() };
    authCache.set(token, user, AUTH_TTL_MS);
  }

  const allow = allowedEmails();
  if (allow.length && allow.indexOf(user.email) < 0) {
    return { ok: false, status: 403, code: 'not_allowed' };
  }
  return { ok: true, userId: user.id };
}

/* ---- Limite de débit simple par utilisateur (par instance) ---- */
const buckets = new Map();
const RATE_PER_MIN = 240;
function rateLimited(userId) {
  const now = Date.now();
  let b = buckets.get(userId);
  if (!b || now - b.start > 60000) { b = { start: now, n: 0 }; buckets.set(userId, b); }
  b.n++;
  if (buckets.size > 1000) buckets.clear();
  return b.n > RATE_PER_MIN;
}

/* Paramètres de requête sous forme de URLSearchParams, quel que soit le runtime */
function queryParams(req) {
  const u = new URL(req.url || '/', 'http://localhost');
  return u.searchParams;
}

/* Garde commune : méthode, session, débit. Renvoie true si la requête peut continuer. */
async function guard(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); fail(res, 405, 'method_not_allowed', 'GET uniquement'); return null; }
  const auth = await verifySession(req);
  if (!auth.ok) {
    const msg = auth.code === 'not_allowed' ? 'Compte non autorisé'
      : auth.code === 'server_config' ? 'Configuration serveur incomplète'
      : auth.code === 'auth_unavailable' ? 'Vérification de session indisponible'
      : 'Connexion requise';
    fail(res, auth.status, auth.code, msg);
    return null;
  }
  if (rateLimited(auth.userId)) { fail(res, 429, 'rate_limited', 'Trop de requêtes'); return null; }
  return auth;
}

module.exports = { send, fail, makeCache, verifySession, guard, queryParams, bearerToken, _authCache: authCache, _buckets: buckets };
