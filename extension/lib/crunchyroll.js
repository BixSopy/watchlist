'use strict';
/*
 * Historique Crunchyroll (extension Cinepisode 0.6.0).
 * Avec la session crunchyroll.com de ce navigateur (cookie etp_rt, jamais lu par l'extension :
 * le navigateur l'ajoute lui-même à la requête), on obtient un jeton d'accès de courte durée puis
 * on lit l'historique page par page (/content/v2/{compte}/watch-history). Regroupé par série :
 * dernier épisode fini (saison/épisode tels que Crunchyroll les numérote), date, pourcentage.
 *
 * Saisons d'animés : Crunchyroll et TMDB ne numérotent pas toujours pareil (saisons « cours »,
 * numérotation absolue, OAV). La saison est envoyée telle quelle ; le site ne coche pas ces lignes
 * d'office et signale la numérotation à vérifier (onglet « Détectés »).
 *
 * Référence : Universal Trakt Scrobbler (MIT, Copyright (c) 2020 trakt-tools,
 * github.com/trakt-tools/universal-trakt-scrobbler), CrunchyrollApi.ts — jeton etp_rt_cookie,
 * structure des éléments (panel.episode_metadata, fully_watched, playhead), suffixe « (… Dub) »,
 * repérage des films. Code réécrit pour Cinepisode ; notice MIT dans extension/README.md.
 *
 * Indépendant du navigateur (fetch injecté) pour être testable avec node --test.
 */
(function (root) {
  var CR_ORIGIN = 'https://www.crunchyroll.com';
  /* Identifiant public du client web de crunchyroll.com (« noaihdevm_6iyg0a8l0q: » en base64) :
   * le même pour tous les visiteurs du site, ce n'est pas un secret de l'utilisateur. */
  var CR_WEB_CLIENT = 'Basic bm9haWhkZXZtXzZpeWcwYThsMHE6';
  var CR_PAGE_SIZE = 100;
  var CR_MAX_PAGES = 100;          /* 10 000 éléments au plus (au-delà : import tronqué, signalé) */
  var CR_DONE_RATIO = 0.8;         /* même règle que Netflix : 80 % d'un épisode = vu */
  var CR_DUB_RE = /\s+\((?:[\w\u00C0-\u017F-]+\s+)?(?:Dub|Dubbed|Sub|Subbed|Subtitled|VF|VOSTFR|Doublage)\)\s*$/i;
  var CR_MOVIE_RE = /(?:^|[-\s])(?:movie|film|the-movie|le-film|gekijouban)(?:$|[-\s])/i;

  function str(v) { return typeof v === 'string' ? v.trim() : ''; }
  function int(v) {
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return v;
    if (typeof v === 'string' && /^\d{1,5}$/.test(v.trim())) return parseInt(v, 10);
    return null;
  }
  function cleanTitle(t) { return str(t).replace(CR_DUB_RE, '').trim(); }

  function tokenRequest(deviceId) {
    return {
      url: CR_ORIGIN + '/auth/v1/token',
      opts: {
        method: 'POST', credentials: 'include',
        headers: { 'Authorization': CR_WEB_CLIENT, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=etp_rt_cookie&scope=offline_access&device_id=' + encodeURIComponent(deviceId || '')
          + '&device_type=' + encodeURIComponent('Cinepisode (navigateur)'),
      },
    };
  }
  function parseToken(json) {
    if (!json || typeof json.access_token !== 'string' || !json.access_token) return null;
    var accountId = str(json.account_id);
    return { accessToken: json.access_token, accountId: accountId || null };
  }
  function historyUrl(accountId, page, locale) {
    return CR_ORIGIN + '/content/v2/' + encodeURIComponent(accountId) + '/watch-history?page=' + page
      + '&page_size=' + CR_PAGE_SIZE + '&locale=' + encodeURIComponent(locale || 'fr-FR');
  }

  /* Un élément de l'historique -> {kind, seriesId, title, season, episode, dateMs, pct, done} ou null */
  function parseHistoryEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var panel = raw.panel && typeof raw.panel === 'object' ? raw.panel : {};
    var em = panel.episode_metadata && typeof panel.episode_metadata === 'object' ? panel.episode_metadata : null;
    var mm = panel.movie_metadata && typeof panel.movie_metadata === 'object' ? panel.movie_metadata : null;
    var date = Date.parse(str(raw.date_played));
    var dateMs = isFinite(date) ? date : null;
    var durationMs = (em && em.duration_ms) || (mm && mm.duration_ms) || null;
    var playhead = typeof raw.playhead === 'number' && raw.playhead >= 0 ? raw.playhead : null; /* secondes */
    var pct = null;
    if (raw.fully_watched === true) pct = 100;
    else if (playhead !== null && typeof durationMs === 'number' && durationMs > 0) pct = Math.min(100, Math.round(playhead * 1000 / durationMs * 100));
    var done = raw.fully_watched === true || (pct !== null && pct >= CR_DONE_RATIO * 100);

    var isMovie = panel.type === 'movie' || !!mm || raw.parent_type === 'movie_listing';
    if (!isMovie && em) {
      var slugs = str(em.season_slug_title) + ' ' + str(em.series_slug_title);
      if (/movie/i.test(str(em.season_title)) || (em.episode_number === null && CR_MOVIE_RE.test(slugs))) isMovie = true;
    }
    if (isMovie) {
      var mt = cleanTitle((mm && mm.movie_listing_title) || (em && em.series_title) || panel.title);
      if (!mt) return null;
      return { kind: 'movie', seriesId: str((mm && mm.movie_listing_id) || raw.parent_id) || null, title: mt,
        season: null, episode: null, dateMs: dateMs, pct: pct, done: done };
    }
    if (!em) return null;
    var title = cleanTitle(em.series_title);
    if (!title) return null;
    /* Saison brute de Crunchyroll ; numéro d'épisode : episode_number, sinon le champ texte « 12 » */
    var season = int(em.season_number);
    var episode = int(em.episode_number);
    if (episode === null) episode = int(em.episode);
    return { kind: 'show', seriesId: str(em.series_id || raw.parent_id) || null, title: title,
      season: season, episode: episode, dateMs: dateMs, pct: pct, done: done };
  }
  /* Une page : {entries, next} ; null si la réponse n'a pas la forme attendue.
   * v2 : {data:[…], total, meta:{next_page}} ; ancienne forme v1 : {items:[…], next_page}. */
  function parseHistoryPage(json) {
    if (!json || typeof json !== 'object') return null;
    var list = Array.isArray(json.data) ? json.data : Array.isArray(json.items) ? json.items : null;
    if (!list) return null;
    var next = (json.meta && json.meta.next_page) || json.next_page || null;
    var out = [];
    for (var i = 0; i < list.length; i++) { var e = parseHistoryEntry(list[i]); if (e) out.push(e); }
    return { entries: out, raw: list.length, next: next ? String(next) : null };
  }

  /* Regroupe par série/film (historique du plus récent au plus ancien) */
  function aggregate(entries) {
    var byKey = {}, order = [];
    for (var i = 0; i < entries.length; i++) {
      var it = entries[i];
      var key = it.kind + ':' + (it.seriesId || it.title.toLowerCase());
      var g = byKey[key];
      if (!g) { g = byKey[key] = { key: key, kind: it.kind, title: it.title, altTitles: [], dateMs: null, progress: null, pct: null, best: null, anyDone: false }; order.push(key); }
      if (it.dateMs && (g.dateMs === null || it.dateMs > g.dateMs)) g.dateMs = it.dateMs;
      if (it.done) g.anyDone = true;
      if (it.kind === 'movie') { if (g.pct === null || (it.pct !== null && it.pct > g.pct)) g.pct = it.pct; continue; }
      if (!it.done || it.season === null || it.episode === null) continue;
      var b = g.best;
      if (!b || it.season > b.season || (it.season === b.season && it.episode > b.episode)) g.best = { season: it.season, episode: it.episode, pct: it.pct };
    }
    var out = [];
    for (var k = 0; k < order.length; k++) {
      var gr = byKey[order[k]];
      if (gr.kind === 'movie' && !gr.anyDone) continue;  /* film commencé, pas fini : pas « vu » */
      if (gr.kind === 'show') {
        if (!gr.best && !gr.anyDone) continue;             /* seulement des épisodes entamés */
        gr.progress = gr.best ? { season: gr.best.season, episode: gr.best.episode } : null;
        gr.pct = gr.best ? gr.best.pct : null;
      }
      delete gr.best; delete gr.anyDone;
      out.push(gr);
    }
    return out;
  }

  function codeError(code, msg) { var e = new Error(msg || code); e.code = code; return e; }
  function jsonOf(res) { try { return JSON.parse(res.body); } catch (e) { return null; } }

  /* Lit tout l'historique. fetchFn(url, opts) -> {status, body}. opts : deviceId, locale, sinceMs,
   * onProgress(pages, éléments), sleep(ms). Renvoie {items (groupes), truncated, pages}. */
  async function fetchHistory(fetchFn, opts) {
    opts = opts || {};
    var sleep = opts.sleep || function () { return Promise.resolve(); };
    var tr = tokenRequest(opts.deviceId);
    var tres = await fetchFn(tr.url, tr.opts);
    if (!tres || tres.status === 400 || tres.status === 401 || tres.status === 403) throw codeError('crunchyroll_auth');
    if (tres.status < 200 || tres.status >= 300) throw codeError('crunchyroll_http', 'token ' + tres.status);
    var tok = parseToken(jsonOf(tres));
    if (!tok) throw codeError('crunchyroll_auth');
    var headers = { 'Authorization': 'Bearer ' + tok.accessToken };
    if (!tok.accountId) {
      var me = await fetchFn(CR_ORIGIN + '/accounts/v1/me', { method: 'GET', credentials: 'include', headers: headers });
      var mj = me && me.status === 200 ? jsonOf(me) : null;
      tok.accountId = mj && str(mj.account_id) ? str(mj.account_id) : null;
      if (!tok.accountId) throw codeError('crunchyroll_auth');
    }
    var sinceMs = typeof opts.sinceMs === 'number' ? opts.sinceMs : null;
    var all = [], page = 1, truncated = false, reachedKnown = false, retried = 0;
    while (!reachedKnown) {
      if (page > CR_MAX_PAGES) { truncated = true; break; }
      var res = await fetchFn(historyUrl(tok.accountId, page, opts.locale), { method: 'GET', credentials: 'include', headers: headers });
      if (res && res.status === 429 && retried < 3) { retried++; await sleep(5000 * retried); continue; } /* trop de requêtes (Cloudflare) : pause */
      if (!res || res.status === 401 || res.status === 403) throw codeError('crunchyroll_auth');
      if (res.status === 404 && page > 1) break; /* au-delà de la dernière page */
      if (res.status < 200 || res.status >= 300) throw codeError('crunchyroll_http', 'history ' + res.status);
      var parsed = parseHistoryPage(jsonOf(res));
      if (!parsed) throw codeError('crunchyroll_http', 'parse');
      for (var i = 0; i < parsed.entries.length; i++) {
        var e = parsed.entries[i];
        if (sinceMs !== null && e.dateMs !== null && e.dateMs < sinceMs) { reachedKnown = true; continue; }
        all.push(e);
      }
      if (opts.onProgress) opts.onProgress(page, all.length);
      if (!parsed.raw || parsed.raw < CR_PAGE_SIZE && !parsed.next) break;
      page++;
      await sleep(250);
    }
    return { items: aggregate(all), truncated: truncated, pages: page };
  }

  var api = { CR_ORIGIN: CR_ORIGIN, CR_PAGE_SIZE: CR_PAGE_SIZE, CR_MAX_PAGES: CR_MAX_PAGES,
    cleanTitle: cleanTitle, tokenRequest: tokenRequest, parseToken: parseToken, historyUrl: historyUrl,
    parseHistoryEntry: parseHistoryEntry, parseHistoryPage: parseHistoryPage, aggregate: aggregate, fetchHistory: fetchHistory };
  root.CinepisodeCrunchyroll = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
