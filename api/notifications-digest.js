'use strict';
/*
 * Digest hebdomadaire des sorties : GET /api/notifications-digest, appelé par Vercel Cron
 * (vercel.json → crons), jamais par le client. Protégé par CRON_SECRET — Vercel ajoute
 * automatiquement Authorization: Bearer <CRON_SECRET> à ses appels cron quand la variable est
 * définie côté projet ; sans elle, la route refuse (pas d'envoi en masse sans protection).
 *
 * - Lit watchlist_items.next_air (déjà calculé et synchronisé côté client, js/14-suivi.js, pour
 *   les items au statut "encours") : AUCUN appel TMDB côté serveur.
 * - Un seul email par profil opté in (notification_prefs.releases = true), et seulement si sa
 *   liste de sorties de la semaine n'est pas vide (pas de spam).
 * - E-mail et langue du compte récupérés via l'API admin de Supabase (auth/v1/admin/users/{id}),
 *   même patron que api/welcome.js.
 * - Envoi en lot via Resend (POST /emails/batch), un objet par destinataire, gabarit préparé à
 *   l'avance (api/_lib/app-emails.json → digest, généré par scripts/build-brand.mjs depuis
 *   branding/app-emails/<langue>/digest.html) et rempli ici (titre + petite affiche TMDB par item).
 * - Sans RESEND_API_KEY ou sans clé secrète Supabase : 200 { sent:0, reason:'not_configured' }.
 */
const { send, fail, serviceKey, serviceHeaders, supabaseUrl, timeoutSignal } = require('./_lib/common');
const EMAILS = require('./_lib/app-emails.json');

const RESEND_BATCH_URL = 'https://api.resend.com/emails/batch';
const DEFAULT_FROM = 'Cinepisode <noreply@cinepisode.com>';
const APP_URL = 'https://cinepisode.com/';
const SETTINGS_URL = 'https://cinepisode.com/#notifications';
const WINDOW_DAYS = 7;
const TIMEOUT_MS = 8000;
const BATCH_SIZE = 100;

function todayIso() { return new Date().toISOString().slice(0, 10); }
function addDaysIso(days) { const d = new Date(); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
function escHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

async function restGet(path) {
  const r = await fetch(supabaseUrl() + '/rest/v1/' + path, { headers: serviceHeaders({ Accept: 'application/json' }), signal: timeoutSignal(TIMEOUT_MS) });
  if (!r.ok) throw new Error('rest_' + r.status);
  return r.json();
}

async function adminUser(id) {
  const r = await fetch(supabaseUrl() + '/auth/v1/admin/users/' + encodeURIComponent(id), {
    headers: serviceHeaders({ Accept: 'application/json' }), signal: timeoutSignal(TIMEOUT_MS),
  });
  if (!r.ok) return null;
  return r.json();
}

function posterImg(path) {
  if (!path || !/^\/[A-Za-z0-9_.-]{1,80}$/.test(path)) return '';
  return '<img src="https://image.tmdb.org/t/p/w92' + path + '" width="46" height="69" alt="" ' +
    'style="display:block;border-radius:8px;width:46px;height:69px;object-fit:cover;">';
}
function itemMeta(it) {
  return (it.saison && it.episode ? 'S' + it.saison + 'E' + it.episode + ' · ' : '') + it.next_air;
}
function itemsHtml(items) {
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 10px;">' +
    items.map((it) =>
      '<tr><td style="padding:0 0 12px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>' +
      '<td width="46" valign="top">' + posterImg(it.poster_path) + '</td>' +
      '<td style="padding-left:12px;font-family:\'IBM Plex Sans\',-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;' +
      'color:#f0f0f0;font-size:14px;line-height:20px;" valign="top">' +
      '<strong style="color:#ffffff;">' + escHtml(it.title) + '</strong><br>' +
      '<span style="color:#9a9aa3;font-size:13px;">' + escHtml(itemMeta(it)) + '</span>' +
      '</td></tr></table></td></tr>'
    ).join('') +
    '</table>';
}
function itemsText(items) {
  return items.map((it) => '- ' + it.title + ' (' + itemMeta(it) + ')').join('\n');
}

function render(lang, items) {
  const t = EMAILS.digest;
  const e = t[lang] || t[EMAILS.defaultLanguage];
  const subHtml = (s) => s.split('{{APP_URL}}').join(APP_URL).split('{{SETTINGS_URL}}').join(SETTINGS_URL).split('{{ITEMS}}').join(itemsHtml(items));
  const subText = (s) => s.split('{{APP_URL}}').join(APP_URL).split('{{SETTINGS_URL}}').join(SETTINGS_URL).split('{{ITEMS}}').join(itemsText(items));
  return { subject: e.subject, html: subHtml(e.html), text: subText(e.text) };
}

async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return fail(res, 405, 'method_not_allowed', 'GET uniquement'); }
  const secret = process.env.CRON_SECRET;
  if (!secret) return send(res, 200, { sent: 0, reason: 'not_configured' });
  if ((req.headers && req.headers.authorization) !== 'Bearer ' + secret) return fail(res, 401, 'unauthorized', 'Non autorisé');

  const key = process.env.RESEND_API_KEY;
  if (!key || !serviceKey()) return send(res, 200, { sent: 0, reason: 'not_configured' });

  const from = todayIso(), to = addDaysIso(WINDOW_DAYS);
  let itemRows, profileRows;
  try {
    const prefRows = await restGet('notification_prefs?releases=eq.true&select=profile_id');
    if (!prefRows.length) return send(res, 200, { sent: 0, reason: 'no_optin' });
    const optedIn = new Set(prefRows.map((r) => r.profile_id));

    itemRows = await restGet('watchlist_items?status=eq.encours&deleted=eq.false&type=neq.film' +
      '&next_air=gte.' + from + '&next_air=lte.' + to +
      '&select=profile_id,title,poster_path,saison,episode,next_air&order=next_air.asc');
    itemRows = itemRows.filter((r) => optedIn.has(r.profile_id));
    if (!itemRows.length) return send(res, 200, { sent: 0, reason: 'no_items' });

    const profileIds = [...new Set(itemRows.map((r) => r.profile_id))];
    profileRows = await restGet('profiles?id=in.(' + profileIds.join(',') + ')&select=id,account_id');
  } catch (e) { return fail(res, 503, 'unavailable', 'Réessaie plus tard'); }

  const accountByProfile = new Map(profileRows.map((p) => [p.id, p.account_id]));
  const byProfile = new Map();
  for (const it of itemRows) {
    if (!byProfile.has(it.profile_id)) byProfile.set(it.profile_id, []);
    byProfile.get(it.profile_id).push(it);
  }

  const emails = [];
  for (const [profileId, items] of byProfile) {
    const accountId = accountByProfile.get(profileId);
    if (!accountId) continue;
    let user;
    try { user = await adminUser(accountId); } catch (e) { continue; }
    if (!user || !user.email) continue;
    const lang = String((user.user_metadata && user.user_metadata.lang) || '').slice(0, 5) || EMAILS.defaultLanguage;
    const mail = render(lang, items);
    emails.push({ from: DEFAULT_FROM, to: [user.email], subject: mail.subject, html: mail.html, text: mail.text });
  }
  if (!emails.length) return send(res, 200, { sent: 0, reason: 'no_email' });

  let sent = 0;
  for (let i = 0; i < emails.length; i += BATCH_SIZE) {
    const batch = emails.slice(i, i + BATCH_SIZE);
    try {
      const r = await fetch(RESEND_BATCH_URL, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'Idempotency-Key': 'digest-' + from + '-' + i },
        body: JSON.stringify(batch),
        signal: timeoutSignal(TIMEOUT_MS),
      });
      if (r.ok) sent += batch.length; else console.warn('[notifications-digest] Resend en erreur', r.status);
    } catch (e) { console.warn('[notifications-digest] Resend injoignable'); }
  }
  return send(res, 200, { sent });
}

module.exports = handler;
