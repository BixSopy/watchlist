'use strict';
/*
 * Abonnement calendrier : GET /cal/<jeton> (réécrit vers /api/calendar?t=<jeton>), lu par Google
 * Agenda, Apple Calendrier, Outlook… sans session (migration 20261110120000_calendrier_abonnement).
 *  - Jeton validé (22 caractères base64url) AVANT toute requête ; lecture via la RPC
 *    get_calendar_feed avec la clé PUBLIQUE : la base ne renvoie que titre, type, date du prochain
 *    épisode et clé locale (UID stable). Inconnu, remplacé ou désactivé : même 404.
 *  - Aucun appel TMDB : watchlist_items.next_air est déjà calculé et synchronisé par le client.
 *  - Jamais en cache partagé (private) : un lien désactivé cesse de répondre tout de suite.
 *  - Limite de débit par IP et par minute (par instance) ; l'IP n'est ni stockée ni journalisée.
 *  - Format .ics : le même générateur que l'export manuel de l'onglet Calendrier (CAL_CORE).
 */
const { supabaseUrl, timeoutSignal, queryParams } = require('./_lib/common');
const S = require('./_lib/share');
const CAL = require('../js/26-calendar.js');

const limited = S.makeLimiter(60);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/* Libellés du flux, dans la langue choisie à la création du lien */
const L10N = {
  fr: ['Cinepisode — mes sorties', 'nouvel épisode'],
  en: ['Cinepisode — my releases', 'new episode'],
  es: ['Cinepisode — mis estrenos', 'nuevo episodio'],
  pt: ['Cinepisode — meus lançamentos', 'novo episódio'],
  ru: ['Cinepisode — мои премьеры', 'новый эпизод'],
  zh: ['Cinepisode — 我的更新', '新剧集'],
  ar: ['Cinepisode — إصداراتي', 'حلقة جديدة'],
  hi: ['Cinepisode — मेरी रिलीज़', 'नया एपिसोड'],
  bn: ['Cinepisode — আমার রিলিজ', 'নতুন পর্ব'],
  ur: ['Cinepisode — میری ریلیزز', 'نئی قسط'],
};

async function fetchFeed(token, fetchImpl) {
  if (!S.TOKEN_RE.test(String(token || ''))) return null;
  const key = S.publishableKey();
  const r = await (fetchImpl || fetch)(supabaseUrl() + '/rest/v1/rpc/get_calendar_feed', {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ p_token: token }),
    signal: timeoutSignal(4000),
  });
  if (!r.ok) throw new Error('upstream_' + r.status);
  const d = await r.json();
  return d && typeof d === 'object' && Array.isArray(d.items) ? d : null;
}

function render(d, now) {
  const l = L10N[d.lang] || L10N.fr;
  const evs = d.items
    .filter((it) => it && DATE_RE.test(String(it.date || '')) && it.title && it.uid)
    .map((it) => ({ date: it.date, itemId: String(it.uid).slice(0, 80), title: String(it.title).slice(0, 200), kind: it.type === 'anime' ? 'anime' : 'serie', rel: 'next', label: l[1] }));
  return CAL.buildIcs(evs, { name: l[0], now: now || new Date(), headers: ['REFRESH-INTERVAL;VALUE=DURATION:PT6H', 'X-PUBLISHED-TTL:PT6H'] });
}

function headers(res, status, type) {
  res.statusCode = status;
  res.setHeader('Content-Type', type || 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', status === 200 ? 'private, max-age=900' : 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

async function handler(req, res, deps) {
  deps = deps || {};
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Allow', 'GET, HEAD'); headers(res, 405); return res.end(''); }
  if (limited(S.clientIp(req) || 'na')) { res.setHeader('Retry-After', '60'); headers(res, 429); return res.end('Too many requests'); }
  const t = String(queryParams(req).get('t') || '').replace(/\.ics$/i, '');
  let d = null;
  try { d = await fetchFeed(t, deps.fetch); } catch (e) { headers(res, 502); return res.end('Calendar temporarily unavailable'); }
  if (!d) { headers(res, 404); return res.end('Unknown or disabled calendar link'); }
  const body = render(d, deps.now);
  headers(res, 200, 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'inline; filename="cinepisode.ics"');
  res.end(req.method === 'HEAD' ? '' : body);
}
module.exports = handler;
module.exports._render = render;
module.exports._fetchFeed = fetchFeed;
module.exports._limited = limited;
