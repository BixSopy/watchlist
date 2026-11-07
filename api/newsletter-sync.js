'use strict';
/*
 * Synchro de l'abonnement à la newsletter générale vers Resend : POST /api/newsletter-sync
 * { enabled: boolean }, appelé par le client juste après avoir basculé notification_prefs.newsletter
 * (js/17-settings-menu.js). Jamais de clé Resend côté client.
 *
 * - Session obligatoire (Authorization: Bearer) d'un compte à l'email confirmé (verifySession).
 * - E-mail récupéré via l'API admin de Supabase (auth/v1/admin/users/{id}), même patron que
 *   api/welcome.js (verifySession ne renvoie pas l'email lui-même).
 * - Crée le contact Resend s'il n'existe pas encore (POST /contacts, accepte aussi le cas où il
 *   existe déjà), puis bascule son abonnement au Topic "newsletter" (PATCH /contacts/{email}/topics,
 *   opt_in/opt_out — API Resend « Topics », sans audienceId).
 * - Le contenu de la newsletter elle-même est rédigé et envoyé par Pierre depuis le dashboard
 *   Resend (Topic ciblé en destinataires) : rien d'autre à coder ici.
 * - Sans RESEND_API_KEY, sans clé secrète Supabase ou sans RESEND_NEWSLETTER_TOPIC_ID :
 *   200 { synced:false, reason:'not_configured' }.
 */
const { send, fail, verifySession, serviceKey, serviceHeaders, supabaseUrl, timeoutSignal } = require('./_lib/common');

const RESEND_CONTACTS_URL = 'https://api.resend.com/contacts';
const TIMEOUT_MS = 5000;
const BODY_MAX = 1024;

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

async function adminUser(id) {
  const r = await fetch(supabaseUrl() + '/auth/v1/admin/users/' + encodeURIComponent(id), {
    headers: serviceHeaders({ Accept: 'application/json' }), signal: timeoutSignal(TIMEOUT_MS),
  });
  if (!r.ok) throw new Error('admin_' + r.status);
  return r.json();
}

async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return fail(res, 405, 'method_not_allowed', 'POST uniquement'); }
  const origin = req.headers && req.headers.origin;
  if (origin) { try { if (new URL(origin).host !== String(req.headers.host || '')) return fail(res, 403, 'forbidden_origin', 'Origine refusée'); } catch (e) { return fail(res, 403, 'forbidden_origin', 'Origine refusée'); } }

  const auth = await verifySession(req);
  if (!auth.ok) return fail(res, auth.status, auth.code, 'Connexion requise');

  const key = process.env.RESEND_API_KEY;
  const topicId = process.env.RESEND_NEWSLETTER_TOPIC_ID;
  if (!key || !topicId || !serviceKey()) return send(res, 200, { synced: false, reason: 'not_configured' });

  let body;
  try { body = await readJson(req); } catch (e) { return fail(res, 400, 'bad_json', 'Corps invalide'); }
  const enabled = !!(body && body.enabled);

  let user;
  try { user = await adminUser(auth.userId); } catch (e) { return fail(res, 503, 'unavailable', 'Réessaie plus tard'); }
  if (!user || !user.email) return send(res, 200, { synced: false, reason: 'no_email' });

  try {
    await fetch(RESEND_CONTACTS_URL, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, unsubscribed: false }),
      signal: timeoutSignal(TIMEOUT_MS),
    }); /* 200 création ou déjà présent : les deux sont acceptables, on continue dans tous les cas */
    const r = await fetch(RESEND_CONTACTS_URL + '/' + encodeURIComponent(user.email) + '/topics', {
      method: 'PATCH',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ topics: [{ id: topicId, subscription: enabled ? 'opt_in' : 'opt_out' }] }),
      signal: timeoutSignal(TIMEOUT_MS),
    });
    if (!r.ok) { console.warn('[newsletter-sync] Resend en erreur', r.status); return fail(res, 503, 'unavailable', 'Réessaie plus tard'); }
  } catch (e) { console.warn('[newsletter-sync] Resend injoignable'); return fail(res, 503, 'unavailable', 'Réessaie plus tard'); }

  return send(res, 200, { synced: true });
}

module.exports = handler;
