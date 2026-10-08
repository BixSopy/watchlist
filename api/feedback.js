'use strict';
/*
 * Avis des utilisateurs : POST /api/feedback (JSON)
 *   { kind: 'idea'|'bug'|'other', message, reply_email?, locale?, page?, context?, standalone?,
 *     website (champ piège, doit rester vide), elapsed (ms depuis l'ouverture de la fenêtre) }
 *
 * - Avec ou sans compte : une session valide (Authorization: Bearer) rattache l'avis au profil,
 *   une session absente ou expirée n'empêche pas l'envoi.
 * - Anti-robots : champ piège rempli ou envoi en moins de 2 s = réponse « ok » sans rien faire ;
 *   Content-Type JSON obligatoire et Origin du même site (pas d'envoi depuis un autre site) ;
 *   rafales limitées en mémoire, puis limites en base (submit_feedback : par profil, par empreinte
 *   d'IP et globale).
 * - L'IP n'est jamais stockée : empreinte HMAC tronquée, qui change chaque jour (UTC), effacée
 *   de la base après 2 jours. Le navigateur est réduit à « Chrome 154 · Android ».
 * - Enregistrement : RPC submit_feedback avec la clé secrète (SUPABASE_SECRET_KEY), seule
 *   autorisée à l'appeler. Notification : email texte via l'API HTTP de Resend (RESEND_API_KEY)
 *   vers FEEDBACK_TO (contact@cinepisode.com par défaut), Reply-To = l'adresse donnée.
 * - Aucune clé ni contenu d'avis dans les journaux.
 */
const crypto = require('node:crypto');
const { send, fail, verifySession, bearerToken, serviceKey, serviceHeaders, supabaseUrl, timeoutSignal } = require('./_lib/common');

const KINDS = { idea: 'Idée', bug: 'Bug', other: 'Autre' };
const MSG_MIN = 3;
const MSG_MAX = 2000;
const BODY_MAX = 16 * 1024;
const MIN_ELAPSED_MS = 2000;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const RESEND_URL = 'https://api.resend.com/emails';
const DEFAULT_TO = 'contact@cinepisode.com';
const DEFAULT_FROM = 'Cinepisode <noreply@cinepisode.com>';
const SUPABASE_TIMEOUT_MS = 4000;
const RESEND_TIMEOUT_MS = 6000;

/* ---- Rafales (mémoire de l'instance) : 3 avis par minute par IP, 30 par minute au total ---- */
const INSTANCE_SALT = crypto.randomBytes(16);
const burst = new Map();
let burstAll = { start: 0, n: 0 };
/* Sans base (clé secrète absente) : plafond d'emails par instance et par jour */
let mailDay = { day: '', n: 0 };
const MAIL_FALLBACK_DAILY = 20;

function burstLimited(ipKey, now) {
  now = now || Date.now();
  if (now - burstAll.start > 60000) burstAll = { start: now, n: 0 };
  if (++burstAll.n > 30) return true;
  let b = burst.get(ipKey);
  if (!b || now - b.start > 60000) { b = { start: now, n: 0 }; burst.set(ipKey, b); }
  if (burst.size > 5000) burst.clear();
  return ++b.n > 3;
}

function clientIp(req) {
  const h = req.headers || {};
  const first = (v) => String(v || '').split(',')[0].trim();
  return first(h['x-vercel-forwarded-for']) || first(h['x-real-ip']) || first(h['x-forwarded-for']) ||
    (req.socket && req.socket.remoteAddress) || '';
}
/* Empreinte du jour : HMAC(clé dérivée de la clé secrète, jour UTC | IP), 32 caractères hexa */
function ipHash(ip, now) {
  if (!ip) return null;
  const secret = serviceKey();
  const key = secret ? crypto.createHmac('sha256', secret).update('cinepisode/feedback/ip-hash/v1').digest() : INSTANCE_SALT;
  const day = new Date(now || Date.now()).toISOString().slice(0, 10);
  return crypto.createHmac('sha256', key).update(day + '|' + ip).digest('hex').slice(0, 32);
}

/* « Chrome 154 · Android » : famille, version majeure et système, rien de plus */
function shortUserAgent(ua) {
  ua = String(ua || '');
  if (!ua) return null;
  const pick = [
    ['Edge', /Edg(?:e|A|iOS)?\/(\d+)/], ['Opera', /OPR\/(\d+)/], ['Samsung Internet', /SamsungBrowser\/(\d+)/],
    ['Firefox', /(?:Firefox|FxiOS)\/(\d+)/], ['Chrome', /(?:Chrome|CriOS)\/(\d+)/], ['Safari', /Version\/(\d+)[\d.]* (?:Mobile\/\S+ )?Safari\//],
  ];
  let browser = 'Autre';
  for (const [name, re] of pick) { const m = ua.match(re); if (m) { browser = name + ' ' + m[1]; break; } }
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPod/.test(ua) ? 'iOS' : /iPad/.test(ua) ? 'iPadOS'
    : /CrOS/.test(ua) ? 'ChromeOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'macOS'
    : /Linux/.test(ua) ? 'Linux' : 'autre';
  return (browser + ' · ' + os).slice(0, 80);
}

function cleanText(s) {
  /* caractères de contrôle retirés (sauf retour à la ligne et tabulation), fins de ligne unifiées */
  return String(s).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
}
function oneLine(s) { return String(s).replace(/\s+/g, ' ').trim(); }

async function readJson(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body);
    if (raw.length > BODY_MAX) throw new Error('too_large');
    return JSON.parse(raw);
  }
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > BODY_MAX) throw new Error('too_large');
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

/* Valide et normalise le corps. Renvoie { ok, data } ou { ok:false, field }. */
function validate(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { ok: false, field: 'body' };
  const kind = typeof b.kind === 'string' && Object.prototype.hasOwnProperty.call(KINDS, b.kind) ? b.kind : null;
  if (!kind) return { ok: false, field: 'kind' };
  if (typeof b.message !== 'string') return { ok: false, field: 'message' };
  const message = cleanText(b.message);
  const len = Array.from(message).length;
  if (len < MSG_MIN || len > MSG_MAX) return { ok: false, field: 'message' };
  let reply = null;
  if (b.reply_email != null && b.reply_email !== '') {
    if (typeof b.reply_email !== 'string') return { ok: false, field: 'reply_email' };
    reply = b.reply_email.trim().toLowerCase();
    if (reply && (reply.length > 254 || !EMAIL_RE.test(reply))) return { ok: false, field: 'reply_email' };
    if (!reply) reply = null;
  }
  const locale = typeof b.locale === 'string' && /^[a-z]{2}$/.test(b.locale) ? b.locale : null;
  const path = typeof b.page === 'string' && /^\/[A-Za-z0-9/_.-]{0,99}$/.test(b.page) ? b.page : '/';
  const context = b.context === 'landing' ? 'landing' : 'app';
  const page = context + ':' + path + (b.standalone === true ? ' (pwa)' : '');
  return { ok: true, data: { kind, message, reply_email: reply, locale, page } };
}

function sameOrigin(req) {
  const origin = req.headers && req.headers.origin;
  if (!origin) return true; /* hors navigateur : les autres protections s'appliquent */
  try { return new URL(origin).host === String(req.headers.host || ''); } catch (e) { return false; }
}

async function storeFeedback(rec) {
  if (!serviceKey()) return { stored: false, reason: 'no_service_key' };
  let r;
  try {
    r = await fetch(supabaseUrl() + '/rest/v1/rpc/submit_feedback', {
      method: 'POST',
      headers: serviceHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' }),
      body: JSON.stringify({
        p_account_id: rec.accountId, p_ip_hash: rec.ipHash, p_kind: rec.kind, p_message: rec.message,
        p_reply_email: rec.reply_email, p_page: rec.page, p_app_version: rec.appVersion,
        p_user_agent: rec.userAgent, p_locale: rec.locale,
      }),
      signal: timeoutSignal(SUPABASE_TIMEOUT_MS),
    });
  } catch (e) {
    return { stored: false, reason: 'unreachable' };
  }
  if (!r.ok) {
    console.warn('[feedback] submit_feedback en erreur', r.status, r.status === 404 ? '(migration 20261008210000 à appliquer ?)' : '');
    return { stored: false, reason: 'rpc_' + r.status };
  }
  let d;
  try { d = await r.json(); } catch (e) { return { stored: false, reason: 'rpc_body' }; }
  if (d && d.status === 'ok') return { stored: true, id: String(d.id || ''), notify: d.notify !== false };
  if (d && d.status === 'rate_limited') return { stored: false, limited: true };
  if (d && d.status === 'invalid') return { stored: false, invalid: String(d.field || 'body') };
  return { stored: false, reason: 'rpc_status' };
}

function parisDate(now) {
  try {
    return new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' }).format(now) + ' (Paris)';
  } catch (e) { return now.toISOString(); }
}

function buildEmail(rec, stored, now) {
  const label = KINDS[rec.kind];
  const excerpt = oneLine(rec.message);
  const short = Array.from(excerpt).length > 60 ? Array.from(excerpt).slice(0, 59).join('') + '…' : excerpt;
  const subject = ('[Cinepisode] Avis · ' + label + ' · ' + short).replace(/[\r\n]/g, ' ');
  const text = [
    'Nouvel avis reçu sur Cinepisode',
    '',
    'Type : ' + label,
    'Répondre à : ' + (rec.reply_email || 'aucune adresse donnée'),
    'Compte : ' + (rec.accountId ? 'connecté' : 'sans compte'),
    'Page : ' + rec.page,
    'Langue : ' + (rec.locale || '?'),
    'Navigateur : ' + (rec.userAgent || '?'),
    'Version du site : ' + (rec.appVersion || '?'),
    'Date : ' + parisDate(now),
    'Référence : ' + (stored.stored ? stored.id + ' (table feedback)' : 'non enregistré en base'),
    '',
    'Message :',
    '----------------------------------------',
    rec.message,
    '----------------------------------------',
    '',
    rec.reply_email ? 'Répondre à cet email écrit directement à la personne.' : "La personne n'a pas laissé d'adresse : pas de réponse possible.",
  ].join('\n');
  return { subject, text };
}

async function sendEmail(rec, stored, now) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  const { subject, text } = buildEmail(rec, stored, now);
  const payload = {
    from: (process.env.FEEDBACK_FROM || DEFAULT_FROM).trim(),
    to: [(process.env.FEEDBACK_TO || DEFAULT_TO).trim()],
    subject, text,
  };
  if (rec.reply_email) payload.reply_to = rec.reply_email;
  let r;
  try {
    r = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'feedback-' + (stored.id || crypto.randomUUID()),
      },
      body: JSON.stringify(payload),
      signal: timeoutSignal(RESEND_TIMEOUT_MS),
    });
  } catch (e) {
    console.warn('[feedback] Resend injoignable');
    return false;
  }
  if (!r.ok) { console.warn('[feedback] Resend en erreur', r.status); return false; }
  return true;
}

async function markNotified(id) {
  if (!id || !serviceKey()) return;
  try {
    await fetch(supabaseUrl() + '/rest/v1/rpc/feedback_mark_notified', {
      method: 'POST',
      headers: serviceHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ p_id: id }),
      signal: timeoutSignal(SUPABASE_TIMEOUT_MS),
    });
  } catch (e) { /* sans gravité : seul le plafond d'emails du jour en dépend */ }
}

async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return fail(res, 405, 'method_not_allowed', 'POST uniquement'); }
  if (!/^application\/json\b/i.test(String((req.headers && req.headers['content-type']) || ''))) {
    return fail(res, 415, 'unsupported_media_type', 'JSON attendu');
  }
  if (!sameOrigin(req)) return fail(res, 403, 'forbidden_origin', 'Origine refusée');

  let body;
  try { body = await readJson(req); } catch (e) {
    return e && e.message === 'too_large' ? fail(res, 413, 'too_large', 'Message trop long') : fail(res, 400, 'bad_json', 'Requête illisible');
  }
  /* Robots : champ piège rempli ou formulaire envoyé trop vite → « ok », sans rien faire */
  const elapsed = Number(body && body.elapsed);
  if ((body && body.website) || !(elapsed >= MIN_ELAPSED_MS)) return send(res, 200, { ok: true });

  const v = validate(body);
  if (!v.ok) return fail(res, 400, 'invalid', 'Champ invalide : ' + v.field);

  const now = new Date();
  const ip = clientIp(req);
  const ipKey = ipHash(ip, now.getTime()) || 'none';
  if (burstLimited(ipKey)) return fail(res, 429, 'rate_limited', 'Trop d\'envois, réessaie plus tard', 60);

  let accountId = null;
  if (bearerToken(req)) {
    const auth = await verifySession(req);
    if (auth.ok) accountId = auth.userId;
  }
  const rec = Object.assign({}, v.data, {
    accountId,
    ipHash: ip ? ipKey : null,
    userAgent: shortUserAgent(req.headers && req.headers['user-agent']),
    appVersion: String(process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || null,
  });

  const stored = await storeFeedback(rec);
  if (stored.limited) return fail(res, 429, 'rate_limited', 'Trop d\'envois, réessaie plus tard', 3600);
  if (stored.invalid) return fail(res, 400, 'invalid', 'Champ invalide : ' + stored.invalid);

  let mayEmail = stored.stored ? stored.notify : true;
  if (!stored.stored) {
    const day = now.toISOString().slice(0, 10);
    if (mailDay.day !== day) mailDay = { day, n: 0 };
    mayEmail = mailDay.n < MAIL_FALLBACK_DAILY;
  }
  let emailed = false;
  if (mayEmail) {
    emailed = await sendEmail(rec, stored, now);
    if (emailed && stored.stored) await markNotified(stored.id);
    if (emailed && !stored.stored) mailDay.n++;
  }
  if (!stored.stored && !emailed) return fail(res, 503, 'unavailable', 'Envoi impossible pour le moment');
  return send(res, 200, { ok: true });
}

module.exports = handler;
module.exports._validate = validate;
module.exports._shortUserAgent = shortUserAgent;
module.exports._ipHash = ipHash;
module.exports._buildEmail = buildEmail;
module.exports._reset = () => { burst.clear(); burstAll = { start: 0, n: 0 }; mailDay = { day: '', n: 0 }; };
