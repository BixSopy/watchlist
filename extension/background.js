'use strict';
/* Service worker (MV3) : reçoit les détections du relai Netflix (content/netflix-bridge.js),
 * revalide l'expéditeur et la forme du message, dédoublonne, puis appelle la fonction Supabase
 * mark_watched_by_title() — même jeton que Tautulli, bornée à la watchlist de son propriétaire. */
var SUPA_URL = 'https://batfulcvvquffgfeppcx.supabase.co';
var SUPA_KEY = 'sb_publishable_AgSykBvnAW4cZmuMZJWnrA_lcFL5eT0';
/* Pages d'où une détection peut venir (mêmes origines que content_scripts dans manifest.json) */
var ALLOWED_ORIGINS = ['https://www.netflix.com'];

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

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || typeof msg !== 'object' || msg.type !== 'wl_watched') return;
  if (!trustedSender(sender)) { sendResponse({ ok: false, reason: 'sender' }); return; }
  var title = typeof msg.title === 'string' ? msg.title.trim() : '';
  var season = intOrNull(msg.season);
  var episode = intOrNull(msg.episode);
  if (!title || title.length > 300 || season === undefined || episode === undefined) { sendResponse({ ok: false, reason: 'invalid' }); return; }

  var key = title + '|' + season + '|' + episode;
  if (sameAsLast(key)) { sendResponse({ ok: true, skipped: true }); return; }

  chrome.storage.local.get(['wlToken'], function (res) {
    var token = res.wlToken;
    if (!token) { sendResponse({ ok: false, reason: 'no_token' }); return; }

    fetch(SUPA_URL + '/rest/v1/rpc/mark_watched_by_title', {
      method: 'POST',
      headers: { apikey: SUPA_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_token: token, p_title: title, p_season: season, p_episode: episode }),
    }).then(function (r) { return r.json().catch(function () { return null; }).then(function (data) {
      lastSent = { key: key, at: Date.now() };
      sendResponse({ ok: r.ok, matched: data === true });
    }); }).catch(function () {
      sendResponse({ ok: false, reason: 'network' });
    });
  });
  return true; /* réponse asynchrone */
});
