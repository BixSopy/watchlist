'use strict';
/* Service worker (MV3) : reçoit les détections du relai Netflix (content/netflix-bridge.js),
 * revalide l'expéditeur et la forme du message, dédoublonne, puis appelle la fonction Supabase
 * mark_watched_by_title() — même jeton que Tautulli, bornée à la watchlist de son propriétaire.
 *
 * Le résultat de la dernière détection est gardé dans chrome.storage.local (clé wlLast, jamais le
 * jeton) pour que la fenêtre de l'extension l'affiche en clair (« Mis à jour : Dark S2E3 »...).
 * Les détections sans correspondance vont aussi dans wlLive (page « Titres détectés », 0.5.0).
 * Rien n'est envoyé ailleurs qu'à Supabase. */
var SUPA_URL = 'https://batfulcvvquffgfeppcx.supabase.co';
var SUPA_KEY = 'sb_publishable_AgSykBvnAW4cZmuMZJWnrA_lcFL5eT0';
/* Pages d'où une détection peut venir (mêmes origines que content_scripts dans manifest.json) */
var ALLOWED_ORIGINS = ['https://www.netflix.com'];
/* Réponses structurées de mark_watched_by_title (migration 20261008120000_mark_watched_fiable) */
var SERVER_STATUSES = ['updated', 'already_up_to_date', 'not_found', 'ambiguous', 'invalid_token', 'invalid_input'];

var lastSent = null; /* {key, at} — évite de renvoyer la même détection en boucle */

function sameAsLast(key) {
  if (!lastSent || lastSent.key !== key) return false;
  return (Date.now() - lastSent.at) < 2 * 60 * 1000; /* 2 min */
}

/* Message venu d'un content script de cette extension, dans un onglet d'une origine autorisée */
function trustedSender(sender) {
  if (!sender || sender.id !== chrome.runtime.id || !sender.tab) return false;
  var origin = sender.origin;
  if (!origin && sender.url) { try { origin = new URL(sender.url).origin; } catch (e) { return false; } }
  return ALLOWED_ORIGINS.indexOf(origin) >= 0;
}

function intOrNull(v) {
  if (v === null || v === undefined) return null;
  return (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100000) ? v : undefined;
}

/* Détection valide : épisode = saison et épisode entiers ; film = sans saison ni épisode */
function validDetection(msg) {
  var title = typeof msg.title === 'string' ? msg.title.trim() : '';
  var season = intOrNull(msg.season);
  var episode = intOrNull(msg.episode);
  if (!title || title.length > 300 || season === undefined || episode === undefined) return null;
  if (msg.kind === 'episode' && season !== null && episode !== null) return { kind: 'episode', title: title, season: season, episode: episode };
  if (msg.kind === 'movie' && season === null && episode === null) return { kind: 'movie', title: title, season: null, episode: null };
  return null;
}

/* Traduit la réponse du serveur en statut simple.
 * Base pas encore migrée : l'ancienne fonction renvoie true/false (legacy_updated / legacy_no_change). */
function interpret(data) {
  if (data === true) return { status: 'legacy_updated' };
  if (data === false) return { status: 'legacy_no_change' };
  if (data && typeof data === 'object' && SERVER_STATUSES.indexOf(data.status) >= 0) {
    return {
      status: data.status,
      matchedTitle: typeof data.title === 'string' ? data.title.slice(0, 300) : null,
      season: intOrNull(data.season) === undefined ? null : intOrNull(data.season),
      episode: intOrNull(data.episode) === undefined ? null : intOrNull(data.episode),
    };
  }
  return { status: 'server_error' };
}

function remember(det, result) {
  var last = {
    at: Date.now(),
    kind: det ? det.kind : null,
    title: det ? det.title : null,
    season: det ? det.season : null,
    episode: det ? det.episode : null,
    status: result.status,
    matchedTitle: result.matchedTitle || null,
  };
  /* Pour « Déjà à jour », on montre la progression réellement enregistrée dans la watchlist */
  if (result.status === 'already_up_to_date' && det && det.kind === 'episode') {
    last.season = result.season; last.episode = result.episode;
  }
  try { chrome.storage.local.set({ wlLast: last }); } catch (e) { /* stockage indisponible : rien à afficher */ }
  if (det && (result.status === 'not_found' || result.status === 'ambiguous')) rememberLive(last);
}

/* Détection sans correspondance (« pas dans ta liste », « plusieurs titres ») : gardée localement
 * (clé wlLive, 200 au plus, jamais le jeton) pour la page « Titres détectés », où l'utilisateur peut
 * l'ajouter à sa liste ou l'ignorer. Rien n'est envoyé ailleurs. */
var LIVE_MAX = 200;
function rememberLive(last) {
  try {
    chrome.storage.local.get(['wlLive'], function (res) {
      var live = Array.isArray(res && res.wlLive) ? res.wlLive : [];
      live.push({ at: last.at, kind: last.kind, title: last.title, season: last.season, episode: last.episode, status: last.status });
      if (live.length > LIVE_MAX) live = live.slice(live.length - LIVE_MAX);
      chrome.storage.local.set({ wlLive: live });
    });
  } catch (e) { /* stockage indisponible */ }
}

function rpc(body) {
  return fetch(SUPA_URL + '/rest/v1/rpc/mark_watched_by_title', {
    method: 'POST',
    headers: { apikey: SUPA_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(function (r) { return r.json().catch(function () { return null; }).then(function (data) { return { r: r, data: data }; }); });
}

/* Appelle la nouvelle signature (avec p_type) ; si la base n'a pas encore la migration, PostgREST
 * ne trouve pas la fonction (404 / PGRST202) : on réessaie avec l'ancienne signature. */
function markWatched(token, det) {
  var base = { p_token: token, p_title: det.title, p_season: det.season, p_episode: det.episode };
  var withType = Object.assign({}, base, { p_type: det.kind });
  return rpc(withType).then(function (res) {
    var missing = res.r.status === 404 || (res.data && res.data.code === 'PGRST202');
    return missing ? rpc(base) : res;
  });
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || typeof msg !== 'object' || msg.type !== 'wl_watched') return;
  if (!trustedSender(sender)) { sendResponse({ ok: false, reason: 'sender' }); return; }
  var det = validDetection(msg);
  if (!det) { remember(null, { status: 'invalid_detection' }); sendResponse({ ok: false, reason: 'invalid' }); return; }

  var key = det.kind + '|' + det.title + '|' + det.season + '|' + det.episode;
  if (sameAsLast(key)) { sendResponse({ ok: true, skipped: true }); return; }

  chrome.storage.local.get(['wlToken'], function (res) {
    var token = res.wlToken;
    if (!token) { remember(det, { status: 'no_token' }); sendResponse({ ok: false, reason: 'no_token' }); return; }

    markWatched(token, det).then(function (out) {
      var result = out.r.ok ? interpret(out.data) : { status: 'server_error' };
      if (out.r.ok) lastSent = { key: key, at: Date.now() };
      remember(det, result);
      sendResponse({ ok: out.r.ok, status: result.status });
    }).catch(function () {
      remember(det, { status: 'network' });
      sendResponse({ ok: false, reason: 'network' });
    });
  });
  return true; /* réponse asynchrone */
});
