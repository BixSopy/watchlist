'use strict';
/*
 * Email de bienvenue : POST /api/welcome (sans corps), appelé par l'app à la première connexion
 * d'un compte confirmé (js/15-sync.js → maybeSendWelcome).
 *
 * - Session obligatoire (Authorization: Bearer) d'un compte à l'email confirmé (verifySession).
 * - Envoyé UNE seule fois par compte : la date d'envoi est écrite dans app_metadata
 *   (welcome_email_sent_at) via l'API admin de Supabase avec la clé secrète. app_metadata n'est
 *   pas modifiable par l'utilisateur, aucune migration SQL n'est nécessaire. La marque est posée
 *   AVANT l'envoi (deux onglets simultanés ne déclenchent pas deux emails) et retirée si Resend
 *   échoue ; Resend reçoit en plus une Idempotency-Key par compte (doublons filtrés 24 h).
 * - Comptes anciens : rien n'est envoyé si le compte a plus de WELCOME_MAX_AGE_DAYS jours
 *   (7 par défaut) — le déploiement n'envoie pas de « bienvenue » aux inscrits existants.
 * - Langue : user_metadata.lang (fr par défaut). Gabarits : api/_lib/app-emails.json, généré par
 *   scripts/build-brand.mjs depuis branding/app-emails/<langue>/welcome.html.
 * - Sans RESEND_API_KEY ou sans clé secrète Supabase : 200 { sent:false, reason:'not_configured' }.
 * - Aucune adresse ni clé dans les journaux.
 */
const { send, fail, verifySession, serviceKey, serviceHeaders, supabaseUrl, timeoutSignal } = require('./_lib/common');
const EMAILS = require('./_lib/app-emails.json');

const RESEND_URL = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'Cinepisode <noreply@cinepisode.com>';
const DEFAULT_REPLY_TO = 'contact@cinepisode.com';
const APP_URL = 'https://cinepisode.com/';
const EXT_URL = 'https://chromewebstore.google.com/detail/hmoafofdaajkenkodmgbdjejbmkdjicc';
const FLAG = 'welcome_email_sent_at';
const TIMEOUT_MS = 5000;

function maxAgeMs() {
  const d = Number(process.env.WELCOME_MAX_AGE_DAYS);
  return (Number.isFinite(d) && d > 0 ? d : 7) * 86400000;
}

async function adminUser(id, method, body) {
  const r = await fetch(supabaseUrl() + '/auth/v1/admin/users/' + encodeURIComponent(id), {
    method: method || 'GET',
    headers: serviceHeaders(Object.assign({ Accept: 'application/json' }, body ? { 'Content-Type': 'application/json' } : {})),
    body: body ? JSON.stringify(body) : undefined,
    signal: timeoutSignal(TIMEOUT_MS),
  });
  if (!r.ok) throw new Error('admin_' + r.status);
  return r.json();
}

function render(lang) {
  const t = EMAILS.welcome;
  const e = t[lang] || t[EMAILS.defaultLanguage];
  const sub = (s) => s.split('{{EXT_URL}}').join(EXT_URL).split('{{APP_URL}}').join(APP_URL);
  return { subject: e.subject, html: sub(e.html), text: sub(e.text) };
}

async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return fail(res, 405, 'method_not_allowed', 'POST uniquement'); }
  const origin = req.headers && req.headers.origin;
  if (origin) { try { if (new URL(origin).host !== String(req.headers.host || '')) return fail(res, 403, 'forbidden_origin', 'Origine refusée'); } catch (e) { return fail(res, 403, 'forbidden_origin', 'Origine refusée'); } }

  const auth = await verifySession(req);
  if (!auth.ok) return fail(res, auth.status, auth.code, 'Connexion requise');

  const key = process.env.RESEND_API_KEY;
  if (!key || !serviceKey()) return send(res, 200, { sent: false, reason: 'not_configured' });

  let user;
  try { user = await adminUser(auth.userId); } catch (e) { return fail(res, 503, 'unavailable', 'Réessaie plus tard'); }
  const app = (user && user.app_metadata) || {};
  if (app[FLAG]) return send(res, 200, { sent: false, reason: 'already_sent' });
  const created = Date.parse(user.created_at || '');
  if (!(created > 0) || Date.now() - created > maxAgeMs()) return send(res, 200, { sent: false, reason: 'old_account' });
  if (!user.email) return send(res, 200, { sent: false, reason: 'no_email' });

  /* Marque posée avant l'envoi (app_metadata est fusionné côté Supabase, on renvoie quand même l'existant) */
  try { await adminUser(auth.userId, 'PUT', { app_metadata: Object.assign({}, app, { [FLAG]: new Date().toISOString() }) }); }
  catch (e) { return fail(res, 503, 'unavailable', 'Réessaie plus tard'); }

  const lang = String((user.user_metadata && user.user_metadata.lang) || '').slice(0, 5);
  const mail = render(lang);
  let ok = false;
  try {
    const r = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'Idempotency-Key': 'welcome-' + auth.userId },
      body: JSON.stringify({
        from: (process.env.WELCOME_FROM || DEFAULT_FROM).trim(),
        to: [user.email], reply_to: (process.env.WELCOME_REPLY_TO || DEFAULT_REPLY_TO).trim(),
        subject: mail.subject, html: mail.html, text: mail.text,
      }),
      signal: timeoutSignal(TIMEOUT_MS),
    });
    ok = r.ok;
    if (!ok) console.warn('[welcome] Resend en erreur', r.status);
  } catch (e) { console.warn('[welcome] Resend injoignable'); }

  if (!ok) {
    /* Échec : on retire la marque pour réessayer à la prochaine connexion */
    try { await adminUser(auth.userId, 'PUT', { app_metadata: Object.assign({}, app, { [FLAG]: null }) }); } catch (e) { /* tant pis */ }
    return fail(res, 503, 'unavailable', 'Envoi impossible pour le moment');
  }
  return send(res, 200, { sent: true });
}

module.exports = handler;
module.exports._render = render;
