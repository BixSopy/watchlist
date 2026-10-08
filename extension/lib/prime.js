'use strict';
/*
 * Historique Prime Video (extension Cinepisode 0.6.0).
 * Avec la session www.primevideo.com de ce navigateur (cookies ajoutés par le navigateur, jamais
 * lus par l'extension) :
 *   1. région du compte (GetAppStartupConfig ; « eu » pour la France, valeur par défaut) ;
 *   2. historique page par page (getWatchHistorySettingsPage, jeton nextToken) ;
 *   3. pourcentage vu de chaque élément (enrichItemMetadata) ;
 *   4. pour les éléments vus (≥ 80 %), fiche de l'épisode/film (GetPlaybackResources) :
 *      série, saison, épisode ; bandes-annonces et bonus écartés.
 * Lectures courtes (moins de 80 %) : un épisode entamé ne compte pas, un film non fini n'est pas
 * « vu » — elles ne sont pas envoyées et ne coûtent aucun appel de fiche.
 *
 * Référence : Universal Trakt Scrobbler (MIT, Copyright (c) 2020 trakt-tools,
 * github.com/trakt-tools/universal-trakt-scrobbler), AmazonPrimeApi.ts — endpoints, deviceTypeID,
 * structure des réponses, suffixe de version « [4K/UHD] ». Code réécrit pour Cinepisode ;
 * notice MIT dans extension/README.md.
 *
 * Indépendant du navigateur (fetch injecté) pour être testable avec node --test.
 */
(function (root) {
  var PV_HOST = 'https://www.primevideo.com';
  var PV_DEVICE_TYPE = 'AOAGZA014O5RE';     /* type d'appareil du lecteur web (relevé par UTS) */
  var PV_MAX_PAGES = 200;
  var PV_META_MAX = 1500;                   /* fiches demandées au plus par import */
  var PV_META_CONCURRENCY = 3;
  var PV_DONE_PCT = 80;
  var PV_VERSION_RE = /\s*\[[\w.]+\/[\w.]+\]$/;                 /* « [4K/UHD] » */
  var PV_SEASON_SUFFIX_RE = /\s*[-–:]\s*(?:Season|Saison|Staffel|Temporada|Stagione)\s+\d+\s*$/i;
  var PV_SKIP_TYPES = /^(?:trailer|bonus content|bonus|extra|clip)$/i;

  function str(v) { return typeof v === 'string' ? v.trim() : ''; }
  function int(v) { return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : (typeof v === 'string' && /^\d{1,5}$/.test(v) ? parseInt(v, 10) : null); }
  function cleanTitle(t) { return str(t).replace(PV_VERSION_RE, '').replace(PV_SEASON_SUFFIX_RE, '').trim(); }
  function codeError(code, msg) { var e = new Error(msg || code); e.code = code; return e; }
  function jsonOf(res) { try { return JSON.parse(res.body); } catch (e) { return null; } }
  var XHR = { 'x-requested-with': 'XMLHttpRequest' };

  function configUrl() {
    return 'https://atv-ps.primevideo.com/cdp/usage/GetAppStartupConfig?deviceID=&deviceTypeID=' + PV_DEVICE_TYPE + '&firmware=1&gascEnabled=false&version=1';
  }
  /* Région -> adresses. Le site reste www.primevideo.com (seul domaine autorisé à l'extension). */
  function endpoints(region) {
    var r = /^(na|eu|fe)$/.test(region || '') ? region : 'eu';
    var api = PV_HOST + '/region/' + r + '/api';
    return { region: r, api: api, catalog: 'https://atv-ps' + (r === 'na' ? '' : '-' + r) + '.primevideo.com' };
  }
  function parseConfig(json) {
    var region = json && json.customerConfig && str(json.customerConfig.homeRegion).toLowerCase();
    return /^(na|eu|fe)$/.test(region || '') ? region : null;
  }
  function historyUrl(ep, nextToken) {
    var args = nextToken ? '{"nextToken":' + JSON.stringify(String(nextToken)) + '}' : '{}';
    return ep.api + '/getWatchHistorySettingsPage?widgetArgs=' + encodeURIComponent(args);
  }
  function enrichUrl(ep, ids) {
    return ep.api + '/enrichItemMetadata?metadataToEnrich=' + encodeURIComponent('{"playback":true}')
      + '&titleIDsToEnrich=' + encodeURIComponent(JSON.stringify(ids));
  }
  function itemUrl(ep, gti, deviceId, uxLocale) {
    return ep.catalog + '/cdp/catalog/GetPlaybackResources?asin=' + encodeURIComponent(gti)
      + '&consumptionType=Streaming&desiredResources=CatalogMetadata&deviceID=' + encodeURIComponent(deviceId || '')
      + '&deviceTypeID=' + PV_DEVICE_TYPE + '&firmware=1&gascEnabled=true&resourceUsage=CacheResources'
      + '&videoMaterialType=Feature&titleDecorationScheme=primary-content&uxLocale=' + encodeURIComponent(uxLocale || 'fr_FR');
  }

  function flatten(list, out) {
    for (var i = 0; i < (list || []).length; i++) {
      var it = list[i];
      if (!it || typeof it !== 'object') continue;
      if (Array.isArray(it.children) && it.children.length) flatten(it.children, out);
      else if (typeof it.gti === 'string' && it.gti) out.push({ gti: it.gti, dateMs: typeof it.time === 'number' && it.time > 0 ? it.time : null });
    }
    return out;
  }
  /* Une page : {entries:[{gti, dateMs}], next} ; {entries:[], next:null} pour un historique vide ;
   * null si la réponse n'est pas celle de l'historique (session expirée, page de connexion…). */
  function parseHistoryPage(json) {
    if (!json || !Array.isArray(json.widgets)) return null;
    var w = null;
    for (var i = 0; i < json.widgets.length; i++) if (json.widgets[i] && json.widgets[i].widgetType === 'watch-history') { w = json.widgets[i]; break; }
    if (!w) return null;
    var c = w.content && w.content.content;
    if (!c || !Array.isArray(c.titles)) return { entries: [], next: null };
    var out = [];
    for (var d = 0; d < c.titles.length; d++) flatten(c.titles[d] && c.titles[d].titles, out);
    return { entries: out, next: str(c.nextToken) || null };
  }
  function parseEnrichments(json) {
    var out = {};
    var e = json && json.enrichments && typeof json.enrichments === 'object' ? json.enrichments : {};
    for (var k in e) {
      if (!Object.prototype.hasOwnProperty.call(e, k)) continue;
      var p = e[k] && e[k].progress && e[k].progress.percentage;
      if (typeof p === 'number' && isFinite(p)) out[k] = Math.max(0, Math.min(100, Math.round(p)));
    }
    return out;
  }
  /* Fiche -> {kind:'show', title, season, episode} | {kind:'movie', title} | {skip:true} | null */
  function parseItem(json) {
    var cm = json && json.catalogMetadata;
    var cat = cm && cm.catalog;
    if (!cat || typeof cat !== 'object') return null;
    var type = str(cat.entityType);
    if (PV_SKIP_TYPES.test(type)) return { skip: true };
    var anc = cm.family && Array.isArray(cm.family.tvAncestors) ? cm.family.tvAncestors : [];
    var seasonCat = null, showCat = null;
    for (var i = 0; i < anc.length; i++) {
      var c = anc[i] && anc[i].catalog;
      if (!c) continue;
      if (!seasonCat && (c.type === 'SEASON' || c.seasonNumber !== undefined)) seasonCat = c;
      else if (!showCat && (c.type === 'SHOW' || c.title)) showCat = c;
    }
    var episode = int(cat.episodeNumber);
    if (/^tv show$|^episode$/i.test(type) || (episode !== null && seasonCat)) {
      var title = cleanTitle((showCat && showCat.title) || (seasonCat && seasonCat.title) || '');
      var season = seasonCat ? int(seasonCat.seasonNumber) : null;
      if (!title) return null;
      return { kind: 'show', title: title, season: season, episode: episode };
    }
    var mt = cleanTitle(cat.title);
    return mt ? { kind: 'movie', title: mt } : null;
  }

  /* Regroupe les éléments vus (avec fiche) par série/film */
  function aggregate(rows) {
    var byKey = {}, order = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r.meta || r.meta.skip) continue;
      var key = r.meta.kind + ':' + r.meta.title.toLowerCase();
      var g = byKey[key];
      if (!g) { g = byKey[key] = { key: key, kind: r.meta.kind, title: r.meta.title, altTitles: [], dateMs: null, progress: null, pct: null }; order.push(key); }
      if (r.dateMs && (g.dateMs === null || r.dateMs > g.dateMs)) g.dateMs = r.dateMs;
      if (r.meta.kind === 'movie') { if (g.pct === null || r.pct > g.pct) g.pct = r.pct; continue; }
      if (r.meta.season === null || r.meta.episode === null) continue;
      var b = g.progress;
      if (!b || r.meta.season > b.season || (r.meta.season === b.season && r.meta.episode > b.episode)) {
        g.progress = { season: r.meta.season, episode: r.meta.episode }; g.pct = r.pct;
      }
    }
    var out = [];
    for (var k = 0; k < order.length; k++) out.push(byKey[order[k]]);
    return out;
  }

  /* fetchFn(url, opts) -> {status, body}. opts : deviceId, uxLocale, sinceMs, onProgress(step, a, b),
   * sleep(ms). Renvoie {items (groupes), truncated, pages, metaFailed, metaSkipped}. */
  async function fetchHistory(fetchFn, opts) {
    opts = opts || {};
    var sleep = opts.sleep || function () { return Promise.resolve(); };
    var progress = opts.onProgress || function () {};
    var region = null;
    try {
      var cres = await fetchFn(configUrl(), { method: 'GET', credentials: 'include' });
      if (cres && cres.status === 200) region = parseConfig(jsonOf(cres));
    } catch (e) { region = null; }
    var ep = endpoints(region);
    var sinceMs = typeof opts.sinceMs === 'number' ? opts.sinceMs : null;
    var entries = [], seen = {}, next = null, page = 0, truncated = false, reachedKnown = false;
    do {
      if (page >= PV_MAX_PAGES) { truncated = true; break; }
      var res = await fetchFn(historyUrl(ep, next), { method: 'GET', credentials: 'include', headers: XHR });
      if (!res || res.status === 401 || res.status === 403) throw codeError('prime_auth');
      if (res.status < 200 || res.status >= 300) throw codeError('prime_http', 'history ' + res.status);
      var parsed = parseHistoryPage(jsonOf(res));
      if (!parsed) throw codeError(page === 0 ? 'prime_auth' : 'prime_http'); /* page de connexion au lieu du JSON */
      page++;
      var fresh = [];
      for (var i = 0; i < parsed.entries.length; i++) {
        var en = parsed.entries[i];
        if (sinceMs !== null && en.dateMs !== null && en.dateMs < sinceMs) { reachedKnown = true; continue; }
        if (seen[en.gti]) continue;
        seen[en.gti] = true; fresh.push(en);
      }
      if (fresh.length) {
        var pct = {};
        for (var b = 0; b < fresh.length; b += 50) {
          var ids = fresh.slice(b, b + 50).map(function (x) { return x.gti; });
          try {
            var eres = await fetchFn(enrichUrl(ep, ids), { method: 'GET', credentials: 'include', headers: XHR });
            if (eres && eres.status === 200) Object.assign(pct, parseEnrichments(jsonOf(eres)));
          } catch (e) { /* pourcentage inconnu : compté comme vu (comme UTS) */ }
        }
        for (var f = 0; f < fresh.length; f++) { fresh[f].pct = fresh[f].gti in pct ? pct[fresh[f].gti] : 100; entries.push(fresh[f]); }
      }
      progress('history', page, entries.length);
      next = parsed.next;
      if (next) await sleep(200);
    } while (next && !reachedKnown);

    /* Fiches : seulement les éléments vus ; les plus récents d'abord */
    var todo = entries.filter(function (x) { return x.pct >= PV_DONE_PCT; });
    var skipped = Math.max(0, todo.length - PV_META_MAX);
    todo = todo.slice(0, PV_META_MAX);
    var done = 0, failed = 0, idx = 0;
    async function worker() {
      while (idx < todo.length) {
        var row = todo[idx++];
        var meta = null;
        for (var attempt = 0; attempt < 3 && meta === null; attempt++) {
          try {
            var r = await fetchFn(itemUrl(ep, row.gti, opts.deviceId, opts.uxLocale), { method: 'GET', credentials: 'include' });
            if (r && r.status === 429) { await sleep(3000 * (attempt + 1)); continue; }
            if (r && r.status === 200) meta = parseItem(jsonOf(r));
            break;
          } catch (e) { break; }
        }
        if (meta === null) failed++;
        row.meta = meta;
        done++;
        if (done % 5 === 0 || done === todo.length) progress('meta', done, todo.length);
        await sleep(100);
      }
    }
    var workers = [];
    for (var w = 0; w < PV_META_CONCURRENCY; w++) workers.push(worker());
    await Promise.all(workers);
    return { items: aggregate(todo), truncated: truncated || skipped > 0, pages: page, metaFailed: failed > 0, region: ep.region };
  }

  var api = { PV_HOST: PV_HOST, PV_DEVICE_TYPE: PV_DEVICE_TYPE, PV_META_MAX: PV_META_MAX, PV_MAX_PAGES: PV_MAX_PAGES,
    cleanTitle: cleanTitle, configUrl: configUrl, endpoints: endpoints, parseConfig: parseConfig, historyUrl: historyUrl,
    enrichUrl: enrichUrl, itemUrl: itemUrl, parseHistoryPage: parseHistoryPage, parseEnrichments: parseEnrichments,
    parseItem: parseItem, aggregate: aggregate, fetchHistory: fetchHistory };
  root.CinepisodePrime = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
