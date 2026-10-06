'use strict';
/* Service worker (MV3) : reçoit les détections des content scripts, dédoublonne,
 * et appelle la fonction Supabase mark_watched_by_title() — même jeton que Tautulli. */
var SUPA_URL = 'https://batfulcvvquffgfeppcx.supabase.co';
var SUPA_KEY = 'sb_publishable_AgSykBvnAW4cZmuMZJWnrA_lcFL5eT0';

var lastSent = null; /* {key, at} — évite de renvoyer la même détection en boucle */

function sameAsLast(key) {
  if (!lastSent || lastSent.key !== key) return false;
  return (Date.now() - lastSent.at) < 2 * 60 * 1000; /* 2 min */
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || msg.type !== 'wl_watched') return;
  var title = (msg.title || '').trim();
  var season = msg.season != null ? parseInt(msg.season, 10) : null;
  var episode = msg.episode != null ? parseInt(msg.episode, 10) : null;
  if (!title) { sendResponse({ ok: false, reason: 'no_title' }); return; }

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
      sendResponse({ ok: true, matched: data === true });
    }); }).catch(function (e) {
      sendResponse({ ok: false, reason: String(e) });
    });
  });
  return true; /* réponse asynchrone */
});
