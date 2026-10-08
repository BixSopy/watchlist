'use strict';
/*
 * Historique Crunchyroll (extension Cinepisode 0.6.2).
 * Avec la session crunchyroll.com de ce navigateur (cookie etp_rt, jamais lu par l'extension :
 * le navigateur l'ajoute lui-même à la requête), on obtient un jeton d'accès de courte durée puis
 * on lit l'historique page par page (/content/v2/{compte}/watch-history, sinon l'ancienne adresse
 * /content/v1/watch-history/{compte}). Regroupé par série : dernier épisode fini (saison/épisode
 * tels que Crunchyroll les numérote), date, pourcentage.
 *
 * 0.6.1 : les requêtes partent de l'onglet www.crunchyroll.com (background.js, crRelayFetch : même
 * origine, cookies propriétaires, comme le site lui-même) et plus du service worker, que Cloudflare
 * ou l'API pouvaient refuser. Chaque erreur dit l'étape (jeton, compte, historique) et le statut
 * HTTP, pour un diagnostic copiable sans aucun jeton.
 *
 * 0.6.2 : pagination par curseur. L'adresse v2 renvoie dans meta.next_page l'adresse de la page
 * suivante (curseur opaque) ; un numéro de page (page=11…) est refusé avec un 400
 * « content.get_watch_history_v2.invalid_value » (champ page) dès que l'historique est long (~900 à
 * 1 000 éléments). On suit donc meta.next_page ; sans lien : arrêt (page incomplète, total atteint),
 * le numéro de page n'est plus qu'un dernier recours. Si une page suivante échoue quand même, ce qui
 * a déjà été lu est gardé et envoyé (partial), seule la première page est une erreur.
 * Source : ruflas/crunchyexporter-cli, issue #4 et CHANGELOG 1.3.1 (septembre 2026) ;
 * crunchy-labs/crunchyroll-rs, src/common.rs (PaginationBulkResultMeta.next_page prioritaire sur total).
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
  var CR_V1_PAGE_SIZE = 20;        /* ancienne adresse : taille de page du site (UTS) */
  var CR_MAX_ITEMS = 10000;        /* au-delà : import tronqué, signalé */
  var CR_MAX_PAGES = 100;
  var CR_MAX_REFRESH = 5;          /* le jeton d'accès dure ~5 min : renouvelé si l'import dure plus */
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

  /* Jeton à partir du cookie de session etp_rt (même requête que le site ; sans « scope », le
   * paramètre anti-cache « _ » comme UTS). Le cookie n'est jamais lu : le navigateur l'ajoute. */
  function tokenRequest(deviceId, nowMs) {
    return {
      url: CR_ORIGIN + '/auth/v1/token?_=' + (typeof nowMs === 'number' ? nowMs : Date.now()),
      opts: {
        method: 'POST', credentials: 'include',
        headers: { 'Authorization': CR_WEB_CLIENT, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=etp_rt_cookie&device_id=' + encodeURIComponent(deviceId || '')
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
  function historyUrlV1(accountId, locale) {
    return CR_ORIGIN + '/content/v1/watch-history/' + encodeURIComponent(accountId) + '?locale=' + encodeURIComponent(locale || 'fr-FR')
      + '&page=1&page_size=' + CR_V1_PAGE_SIZE;
  }
  /* next_page de la v2 (0.6.2) : chemin relatif « /content/v2/{compte}/watch-history?page=<curseur>… »,
   * ou adresse complète www / beta-api.crunchyroll.com ramenée sur www (même API, seule origine relayée
   * par l'onglet). Jamais une autre origine ni un autre chemin. Langue ajoutée si absente. */
  function nextUrlV2(next, locale) {
    if (typeof next !== 'string' || !next) return null;
    var path = null;
    var abs = /^https:\/\/(?:www|beta-api)\.crunchyroll\.com(\/.*)$/.exec(next);
    if (abs) path = abs[1];
    else if (next.charAt(0) === '/' && next.charAt(1) !== '/') path = next;
    if (!path || !/^\/content\/v2\/[^/?#]+\/watch-history(?:\?|$)/.test(path)) return null;
    if (!/[?&]locale=/.test(path)) path += (path.indexOf('?') >= 0 ? '&' : '?') + 'locale=' + encodeURIComponent(locale || 'fr-FR');
    return CR_ORIGIN + path;
  }
  /* next_page de la v1 : chemin relatif (« /content/v1/watch-history/…?page=2… ») ; jamais une autre origine */
  function nextUrlV1(next) {
    if (typeof next !== 'string' || !next) return null;
    if (next.indexOf(CR_ORIGIN + '/content/') === 0) return next;
    if (/^\/content\/v1\/watch-history\//.test(next)) return CR_ORIGIN + next;
    return null;
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
  /* Une page : {entries, raw, next, hasNext, total} ; null si la réponse n'a pas la forme attendue.
   * v2 : {data:[…], total, meta:{next_page}} ; ancienne forme v1 : {items:[…], next_page}.
   * hasNext : le champ next_page existe (même vide) -> il fait foi ; total : null si absent. */
  function parseHistoryPage(json) {
    if (!json || typeof json !== 'object') return null;
    var list = Array.isArray(json.data) ? json.data : Array.isArray(json.items) ? json.items : null;
    if (!list) return null;
    var meta = json.meta && typeof json.meta === 'object' ? json.meta : {};
    var hasNext = typeof meta.next_page === 'string' || typeof json.next_page === 'string';
    var next = meta.next_page || json.next_page || null;
    var total = typeof json.total === 'number' && json.total >= 0 ? json.total : null;
    var out = [];
    for (var i = 0; i < list.length; i++) { var e = parseHistoryEntry(list[i]); if (e) out.push(e); }
    return { entries: out, raw: list.length, next: next ? String(next) : null, hasNext: hasNext, total: total };
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

  /* Erreur avec l'étape (token, account, history) et le statut HTTP : affichés dans la fenêtre de
   * l'extension et dans le diagnostic copiable (jamais de jeton ni de contenu de réponse). */
  function codeError(code, step, res, extra) {
    var e = new Error(code + (step ? ' ' + step : '') + (res && typeof res.status === 'number' ? ' ' + res.status : ''));
    e.code = code; e.step = step || null;
    e.status = res && typeof res.status === 'number' ? res.status : null;
    e.cloudflare = !!(res && isChallenge(res));
    if (extra) for (var k in extra) e[k] = extra[k];
    return e;
  }
  function jsonOf(res) { try { return JSON.parse(res.body); } catch (e) { return null; } }
  /* Page de contrôle Cloudflare (ou autre page HTML) au lieu de JSON */
  function isChallenge(res) {
    if (!res) return false;
    if (res.cf) return true;
    var body = typeof res.body === 'string' ? res.body.slice(0, 4096) : '';
    if (!/^\s*</.test(body)) return false;
    return /cloudflare|cf-chl|challenge-platform|just a moment|attention required|cf-ray/i.test(body) || res.status === 403 || res.status === 503;
  }
  /* Réponse -> code d'erreur, ou null si 2xx */
  function failureCode(res, authStatuses) {
    if (!res || typeof res.status !== 'number' || res.status === 0) return 'crunchyroll_http';
    if (res.status >= 200 && res.status < 300) return null;
    if (isChallenge(res)) return 'crunchyroll_blocked';
    if (res.status === 429) return 'crunchyroll_rate';
    if (authStatuses.indexOf(res.status) >= 0) return 'crunchyroll_auth';
    return 'crunchyroll_http';
  }

  /* Lit tout l'historique. fetchFn(url, opts) -> {status, body[, cf]}. opts : deviceId, locale,
   * sinceMs, onProgress(pages, éléments), sleep(ms), now(). Renvoie {items (groupes), truncated,
   * pages, api ('v2' | 'v1'), partial}. partial : null, ou {page, status, code, cloudflare} quand une
   * page après la première a échoué (le début de l'historique, déjà lu, est renvoyé quand même).
   * Erreurs (jeton, compte ou première page seulement) : e.code (crunchyroll_auth | _blocked |
   * _rate | _http), e.step, e.status, e.cloudflare. */
  async function fetchHistory(fetchFn, opts) {
    opts = opts || {};
    var sleep = opts.sleep || function () { return Promise.resolve(); };
    var now = opts.now || function () { return Date.now(); };
    var refreshes = 0;

    async function getToken() {
      var tr, tres, tries = 0;
      for (;;) {
        tr = tokenRequest(opts.deviceId, now());
        tres = await fetchFn(tr.url, tr.opts);
        if (tres && tres.status === 429 && tries < 2) { tries++; await sleep(4000 * tries); continue; }
        break;
      }
      var code = failureCode(tres, [400, 401, 403]);
      if (code) throw codeError(code, 'token', tres);
      var tok = parseToken(jsonOf(tres));
      if (!tok) throw codeError(isChallenge(tres) ? 'crunchyroll_blocked' : 'crunchyroll_auth', 'token', tres, { parse: true });
      return tok;
    }
    var tok = await getToken();
    var headers = { 'Authorization': 'Bearer ' + tok.accessToken };
    if (!tok.accountId) {
      var me = await fetchFn(CR_ORIGIN + '/accounts/v1/me', { method: 'GET', credentials: 'include', headers: headers });
      var meCode = failureCode(me, [401, 403]);
      if (meCode) throw codeError(meCode, 'account', me);
      var mj = jsonOf(me);
      tok.accountId = mj && str(mj.account_id) ? str(mj.account_id) : null;
      if (!tok.accountId) throw codeError('crunchyroll_auth', 'account', me, { parse: true });
    }
    var accountId = tok.accountId;

    var sinceMs = typeof opts.sinceMs === 'number' ? opts.sinceMs : null;
    var all = [], page = 1, truncated = false, reachedKnown = false, retried = 0, api = 'v2', url = historyUrl(accountId, 1, opts.locale);
    var maxPages = CR_MAX_PAGES, pageSize = CR_PAGE_SIZE, seen = 0, partial = null, requested = {};
    /* Échec d'une page après la première : on garde ce qui est lu (0.6.2) */
    function stopPartial(code, res, extra) {
      partial = { page: page, status: res && typeof res.status === 'number' ? res.status : null, code: code,
        cloudflare: !!(res && isChallenge(res)) };
      if (extra) for (var k in extra) partial[k] = extra[k];
    }
    while (!reachedKnown) {
      if (page > maxPages || seen >= CR_MAX_ITEMS) { truncated = true; break; }
      requested[url] = true;
      var res = await fetchFn(url, { method: 'GET', credentials: 'include', headers: headers });
      if (res && res.status === 429 && retried < 3) { retried++; await sleep(5000 * retried); continue; } /* trop de requêtes : pause */
      /* Jeton expiré pendant un long import : on en redemande un (cookie de session toujours là) */
      if (res && res.status === 401 && page > 1 && refreshes < CR_MAX_REFRESH && !isChallenge(res)) {
        refreshes++;
        try { tok = await getToken(); } catch (te) {
          partial = { page: page, status: te.status, code: te.code || 'crunchyroll_auth', cloudflare: !!te.cloudflare, step: 'token' };
          break;
        }
        headers = { 'Authorization': 'Bearer ' + tok.accessToken };
        continue;
      }
      var parsed = res && res.status >= 200 && res.status < 300 ? parseHistoryPage(jsonOf(res)) : null;
      /* v2 refusée (paramètres, adresse retirée, réponse d'une autre forme) : ancienne adresse v1 */
      if (api === 'v2' && page === 1 && !parsed && res && !isChallenge(res)
        && ((res.status >= 200 && res.status < 300) || [400, 404, 405, 410, 422].indexOf(res.status) >= 0)) {
        api = 'v1'; url = historyUrlV1(accountId, opts.locale); pageSize = CR_V1_PAGE_SIZE; maxPages = Math.ceil(CR_MAX_ITEMS / CR_V1_PAGE_SIZE);
        continue;
      }
      var hCode = failureCode(res, [401, 403]);
      if (hCode) {
        if (page > 1) { stopPartial(hCode, res); break; }
        throw codeError(hCode, 'history', res, { api: api, page: page });
      }
      if (!parsed) {
        if (page > 1) { stopPartial('crunchyroll_http', res, { parse: true }); break; }
        throw codeError('crunchyroll_http', 'history', res, { api: api, page: page, parse: true });
      }
      seen += parsed.raw;
      for (var i = 0; i < parsed.entries.length; i++) {
        var e = parsed.entries[i];
        if (sinceMs !== null && e.dateMs !== null && e.dateMs < sinceMs) { reachedKnown = true; continue; }
        all.push(e);
      }
      if (opts.onProgress) opts.onProgress(page, all.length);
      if (!parsed.raw) break;                                             /* page vide : fin */
      var nu = null;
      if (api === 'v1') {
        nu = nextUrlV1(parsed.next);
      } else if (parsed.next) {
        nu = nextUrlV2(parsed.next, opts.locale);                         /* curseur de l'API */
      }
      if (!nu) {
        /* Pas de lien suivant utilisable. next_page présent mais vide, page incomplète ou total
         * atteint : fin. Sinon (réponse sans next_page) : numéro de page, dernier recours. */
        if (api === 'v1' || (parsed.hasNext && !parsed.next) || parsed.raw < pageSize
          || (parsed.total !== null && seen >= parsed.total)) break;
        nu = historyUrl(accountId, page + 1, opts.locale);
      }
      if (requested[nu]) break;                                           /* même page redonnée : fin */
      url = nu;
      page++;
      retried = 0;
      await sleep(250);
    }
    return { items: aggregate(all), truncated: truncated, pages: page, api: api, partial: partial };
  }

  var api = { CR_ORIGIN: CR_ORIGIN, CR_PAGE_SIZE: CR_PAGE_SIZE, CR_V1_PAGE_SIZE: CR_V1_PAGE_SIZE, CR_MAX_PAGES: CR_MAX_PAGES,
    cleanTitle: cleanTitle, tokenRequest: tokenRequest, parseToken: parseToken, historyUrl: historyUrl,
    historyUrlV1: historyUrlV1, nextUrlV1: nextUrlV1, nextUrlV2: nextUrlV2, isChallenge: isChallenge,
    parseHistoryEntry: parseHistoryEntry, parseHistoryPage: parseHistoryPage, aggregate: aggregate, fetchHistory: fetchHistory };
  root.CinepisodeCrunchyroll = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
