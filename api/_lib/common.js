'use strict';
/*
 * Outils partagés par les fonctions /api (Vercel, Node, sans dépendance).
 * Les fichiers de api/_lib ne sont pas exposés comme routes (préfixe « _ »).
 *
 * Principes :
 *  - aucune clé d'API ne sort de la fonction (ni dans les réponses, ni dans les logs) ;
 *  - toute requête doit porter une session Supabase valide (Authorization: Bearer <jwt>)
 *    d'un compte à l'email CONFIRMÉ ; ALLOWED_EMAILS (facultatif) restreint en plus à une
 *    liste d'adresses — vide = tout compte confirmé ;
 *  - quotas quotidiens par compte, comptés dans Supabase (RPC consume_api_quota, appelée
 *    avec le jeton de l'utilisateur : impossible de consommer le quota d'un autre) ;
 *  - les erreurs ne sont jamais mises en cache (Cache-Control: no-store) ;
 *  - le CDN Vercel ne met pas en cache une requête qui porte un en-tête Authorization :
 *    chaque appel passe donc par la vérification de session. Le cache se fait côté
 *    navigateur (private), en mémoire dans la fonction et, pour OMDb, dans une table
 *    Supabase partagée (écrite uniquement avec la clé secrète côté serveur).
 */

const DEFAULT_SUPABASE_URL = 'https://batfulcvvquffgfeppcx.supabase.co';
const UPSTREAM_TIMEOUT_MS = 8000;
const SUPABASE_TIMEOUT_MS = 3000;

function supabaseUrl() {
  return (process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/+$/, '');
}
/* Clé secrète (sb_secret_…) ou ancienne clé service_role (JWT). Facultative. */
function serviceKey() {
  return process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
}
function serviceHeaders(extra) {
  const key = serviceKey();
  const h = Object.assign({ apikey: key }, extra || {});
  /* Les nouvelles clés sb_secret_ ne sont pas des JWT : en-tête apikey seulement */
  if (/^eyJ/.test(key)) h.Authorization = 'Bearer ' + key;
  return h;
}
function timeoutSignal(ms) {
  return typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined;
}

function send(res, status, body, cacheControl) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  /* Extension (jeton dans X-Cinepisode-Token) : la réponse dépend aussi de cet en-tête */
  res.setHeader('Vary', res.wlVaryToken ? 'Authorization, X-Cinepisode-Token' : 'Authorization');
  res.setHeader('Cache-Control', status === 200 && cacheControl ? cacheControl : 'no-store');
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function fail(res, status, code, message, retryAfterS) {
  if (retryAfterS) res.setHeader('Retry-After', String(Math.max(1, Math.ceil(retryAfterS))));
  send(res, status, { error: code, message: message });
}

/* ---- Petit cache mémoire borné (par instance de fonction), en entrées et en octets ---- */
function makeCache(maxEntries, maxBytes) {
  const map = new Map();
  let bytes = 0;
  const sizeOf = (v) => (typeof v === 'string' ? v.length : 256);
  function del(key) {
    const hit = map.get(key);
    if (hit) { bytes -= hit.size; map.delete(key); }
  }
  return {
    get(key) {
      const hit = map.get(key);
      if (!hit) return null;
      if (hit.exp < Date.now()) { del(key); return null; }
      map.delete(key); map.set(key, hit); /* LRU */
      return hit.value;
    },
    set(key, value, ttlMs) {
      del(key);
      const size = sizeOf(value);
      if (maxBytes && size > maxBytes / 4) return; /* trop gros pour être utile */
      map.set(key, { value: value, exp: Date.now() + ttlMs, size: size });
      bytes += size;
      while (map.size > maxEntries || (maxBytes && bytes > maxBytes)) del(map.keys().next().value);
    },
    clear() { map.clear(); bytes = 0; },
    get size() { return map.size; },
    get bytes() { return bytes; },
  };
}

/* ---- Vérification de session Supabase ---- */
const authCache = makeCache(1000);
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

/* Liste blanche facultative : vide (ou absente) = tout compte confirmé est accepté */
function allowedEmails() {
  return (process.env.ALLOWED_EMAILS || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/* Renvoie { ok:true, userId, token } ou { ok:false, status, code } */
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
        signal: timeoutSignal(SUPABASE_TIMEOUT_MS),
      });
    } catch (e) {
      return { ok: false, status: 503, code: 'auth_unavailable' };
    }
    if (r.status === 401 || r.status === 403) return { ok: false, status: 401, code: 'auth_invalid' };
    if (!r.ok) return { ok: false, status: 503, code: 'auth_unavailable' };
    let data;
    try { data = await r.json(); } catch (e) { return { ok: false, status: 503, code: 'auth_unavailable' }; }
    if (!data || !data.id) return { ok: false, status: 401, code: 'auth_invalid' };
    user = {
      id: String(data.id),
      email: String(data.email || '').toLowerCase(),
      confirmed: !!(data.email_confirmed_at || data.confirmed_at),
      anonymous: data.is_anonymous === true,
    };
    authCache.set(token, user, AUTH_TTL_MS);
  }

  if (user.anonymous || !user.email || !user.confirmed) {
    return { ok: false, status: 403, code: 'email_unconfirmed' };
  }
  const allow = allowedEmails();
  if (allow.length && allow.indexOf(user.email) < 0) {
    return { ok: false, status: 403, code: 'not_allowed' };
  }
  return { ok: true, userId: user.id, token: token };
}

/* ---- Rafales : limite simple par utilisateur et par minute (par instance) ---- */
const buckets = new Map();
const RATE_PER_MIN = 240;
function rateLimited(userId) {
  const now = Date.now();
  let b = buckets.get(userId);
  if (!b || now - b.start > 60000) { b = { start: now, n: 0 }; buckets.set(userId, b); }
  b.n++;
  if (buckets.size > 2000) buckets.clear();
  return b.n > RATE_PER_MIN;
}

/* ---- Quotas quotidiens (Supabase, RPC consume_api_quota) ---- */
function secondsUntilUtcMidnight(now) {
  const d = new Date(now || Date.now());
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - d.getTime()) / 1000));
}
const quotaDenied = makeCache(5000);
const quotaState = { missingUntil: 0, warned: false };

/*
 * Renvoie { allowed:true } ou { allowed:false, scope:'user'|'global', retryAfter }.
 * Fail-open si la RPC est absente (migration pas encore appliquée) ou si Supabase ne
 * répond pas : la limite par minute ci-dessus reste active, le service ne tombe pas.
 */
async function consumeQuota(auth, bucket, cost) {
  const key = auth.userId + ':' + bucket;
  const denied = quotaDenied.get(key);
  if (denied) return { allowed: false, scope: denied.scope, retryAfter: secondsUntilUtcMidnight() };
  if (Date.now() < quotaState.missingUntil) return { allowed: true, degraded: true };
  let r;
  try {
    r = await fetch(supabaseUrl() + '/rest/v1/rpc/consume_api_quota', {
      method: 'POST',
      headers: {
        apikey: process.env.SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + auth.token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_bucket: bucket, p_cost: cost || 1 }),
      signal: timeoutSignal(SUPABASE_TIMEOUT_MS),
    });
  } catch (e) {
    return { allowed: true, degraded: true };
  }
  if (r.status === 404) {
    quotaState.missingUntil = Date.now() + 5 * 60 * 1000;
    if (!quotaState.warned) { quotaState.warned = true; console.warn('[quota] RPC consume_api_quota absente : migration 20261008100000 à appliquer'); }
    return { allowed: true, degraded: true };
  }
  if (!r.ok) { console.warn('[quota] RPC en erreur', r.status); return { allowed: true, degraded: true }; }
  let data;
  try { data = await r.json(); } catch (e) { return { allowed: true, degraded: true }; }
  if (data && data.allowed === false) {
    const scope = data.scope === 'global' ? 'global' : 'user';
    quotaDenied.set(key, { scope: scope }, secondsUntilUtcMidnight() * 1000);
    return { allowed: false, scope: scope, retryAfter: secondsUntilUtcMidnight() };
  }
  return { allowed: true };
}

/* ---- Cache partagé Supabase (table api_cache, clé secrète uniquement) ---- */
async function sharedCacheGet(key) {
  if (!serviceKey()) return null;
  try {
    const url = supabaseUrl() + '/rest/v1/api_cache?select=body&key=eq.' + encodeURIComponent(key) +
      '&expires_at=gt.' + encodeURIComponent(new Date().toISOString()) + '&limit=1';
    const r = await fetch(url, { headers: serviceHeaders({ Accept: 'application/json' }), signal: timeoutSignal(SUPABASE_TIMEOUT_MS) });
    if (!r.ok) return null;
    const rows = await r.json();
    return Array.isArray(rows) && rows[0] && rows[0].body != null ? rows[0].body : null;
  } catch (e) {
    return null;
  }
}
async function sharedCachePut(key, body, ttlS) {
  if (!serviceKey()) return false;
  try {
    const now = Date.now();
    const r = await fetch(supabaseUrl() + '/rest/v1/api_cache?on_conflict=key', {
      method: 'POST',
      headers: serviceHeaders({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify({ key: key, body: body, expires_at: new Date(now + ttlS * 1000).toISOString(), updated_at: new Date(now).toISOString() }),
      signal: timeoutSignal(SUPABASE_TIMEOUT_MS),
    });
    return r.ok;
  } catch (e) {
    return false;
  }
}

/* Paramètres de requête sous forme de URLSearchParams, quel que soit le runtime */
function queryParams(req) {
  const u = new URL(req.url || '/', 'http://localhost');
  return u.searchParams;
}

const AUTH_MESSAGES = {
  not_allowed: "Ce compte n'a pas accès au catalogue",
  email_unconfirmed: 'Confirme ton adresse email pour accéder au catalogue',
  server_config: 'Configuration serveur incomplète',
  auth_unavailable: 'Vérification de session indisponible',
};

/* Garde commune : méthode, session, rafales. Renvoie l'auth si la requête peut continuer. */
async function guard(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); fail(res, 405, 'method_not_allowed', 'GET uniquement'); return null; }
  const auth = await verifySession(req);
  if (!auth.ok) {
    fail(res, auth.status, auth.code, AUTH_MESSAGES[auth.code] || 'Connexion requise');
    return null;
  }
  if (rateLimited(auth.userId)) { fail(res, 429, 'rate_limited', 'Trop de requêtes, réessaie dans une minute', 60); return null; }
  return auth;
}

/* ---- Extension navigateur : jeton de suivi (profiles.plex_webhook_token) au lieu d'une session ----
 * L'extension n'a pas de session Supabase : elle s'authentifie avec le jeton de suivi de
 * l'utilisateur (48 caractères hexadécimaux), envoyé dans l'en-tête X-Cinepisode-Token. La RPC
 * consume_api_quota_by_token() vérifie le jeton ET compte le quota du propriétaire en un seul appel.
 * Contrairement au quota des sessions, PAS de mode dégradé : si la RPC ne répond pas, la requête
 * est refusée (c'est elle qui authentifie). */
const EXT_TOKEN_RE = /^[0-9a-f]{48}$/;
function extensionToken(req) {
  const h = req.headers && (req.headers['x-cinepisode-token'] || req.headers['X-Cinepisode-Token']);
  return typeof h === 'string' && EXT_TOKEN_RE.test(h) ? h : null;
}
/* Clé de rafale sans garder le jeton en clair en mémoire */
function tokenKey(token) {
  return 'ext:' + require('node:crypto').createHash('sha256').update(token).digest('hex').slice(0, 24);
}
/* Renvoie { allowed:true } | { allowed:false, scope:'invalid_token'|'user'|'global', retryAfter } | { unavailable:true } */
async function consumeQuotaByToken(token, bucket, cost) {
  let r;
  try {
    r = await fetch(supabaseUrl() + '/rest/v1/rpc/consume_api_quota_by_token', {
      method: 'POST',
      headers: { apikey: process.env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_token: token, p_bucket: bucket, p_cost: cost || 1 }),
      signal: timeoutSignal(SUPABASE_TIMEOUT_MS),
    });
  } catch (e) {
    return { unavailable: true };
  }
  if (!r.ok) return { unavailable: true };
  let data;
  try { data = await r.json(); } catch (e) { return { unavailable: true }; }
  if (data && data.allowed === true) return { allowed: true };
  if (data && data.allowed === false) {
    const scope = data.scope === 'global' ? 'global' : data.scope === 'user' ? 'user' : 'invalid_token';
    return { allowed: false, scope: scope, retryAfter: secondsUntilUtcMidnight() };
  }
  return { unavailable: true };
}
/* Garde de l'extension : méthode, jeton, rafales, quota. Renvoie true si la requête peut continuer. */
async function guardExtension(req, res, token, bucket) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); fail(res, 405, 'method_not_allowed', 'GET uniquement'); return false; }
  if (!process.env.SUPABASE_ANON_KEY) { fail(res, 500, 'server_config', 'Configuration serveur incomplète'); return false; }
  if (rateLimited(tokenKey(token))) { fail(res, 429, 'rate_limited', 'Trop de requêtes, réessaie dans une minute', 60); return false; }
  const q = await consumeQuotaByToken(token, bucket, 1);
  if (q.unavailable) { fail(res, 503, 'auth_unavailable', 'Vérification du jeton indisponible', 10); return false; }
  if (!q.allowed && q.scope === 'invalid_token') { fail(res, 401, 'invalid_token', 'Jeton invalide : génère un nouveau jeton dans Cinepisode'); return false; }
  if (!q.allowed) { failQuota(res, q, 'du catalogue'); return false; }
  return true;
}

/* Refus de quota → réponse 429 explicite (le client affiche un message dédié) */
function failQuota(res, q, label) {
  const msg = q.scope === 'global'
    ? 'Quota quotidien global ' + label + ' atteint, réessaie demain'
    : 'Ton quota quotidien ' + label + ' est atteint, réessaie demain';
  fail(res, 429, 'quota_exceeded', msg, q.retryAfter);
}

module.exports = {
  send, fail, failQuota, makeCache, verifySession, guard, queryParams, bearerToken,
  consumeQuota, sharedCacheGet, sharedCachePut, secondsUntilUtcMidnight, serviceKey,
  supabaseUrl, timeoutSignal, UPSTREAM_TIMEOUT_MS, extensionToken, consumeQuotaByToken, guardExtension,
  _authCache: authCache, _buckets: buckets, _quotaDenied: quotaDenied, _quotaState: quotaState,
};
