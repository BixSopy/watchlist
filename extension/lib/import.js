'use strict';
/*
 * Import de l'historique de visionnage (extension Cinepisode 0.5.0).
 * L'extension lit l'historique Netflix (dans l'onglet netflix.com, avec la session de ce
 * navigateur) ou le fichier CSV Netflix, regroupe par titre (dernier épisode vu) et envoie ces
 * détections à Cinepisode (extension_push_detections). La correspondance avec la liste, la
 * recherche TMDB et l'ajout se font ensuite dans l'onglet « Détectés » du site, où l'utilisateur
 * choisit ce qui est ajouté ou mis à jour.
 * Envoyé par titre : nom, film/série, dernier épisode vu, date du dernier visionnage, pourcentage
 * vu. Rien d'autre (pas d'identifiant Netflix, pas de liste d'épisodes, pas de profil).
 *
 * Référence pour la lecture de l'historique Netflix : Universal Trakt Scrobbler (MIT,
 * Copyright (c) 2020 trakt-tools, github.com/trakt-tools/universal-trakt-scrobbler) — l'endpoint
 * aui/pathEvaluator (« viewingActivity ») et la structure des éléments (title, seriesTitle,
 * movieID, series, date en millisecondes) sont repris de NetflixApi.ts. Le code ci-dessous est
 * réécrit pour Cinepisode ; la notice MIT complète est dans extension/README.md.
 *
 * Indépendant du navigateur (ni chrome.*, ni fetch, ni DOM) pour être testable avec node --test.
 */

/* ---------- Constantes ---------- */
var NF_HISTORY_PAGE_SIZE = 100;   /* taille d'une page de l'historique Netflix */
var NF_HISTORY_MAX_PAGES = 200;   /* 20 000 éléments maximum (au-delà : import tronqué, signalé) */
var NF_METADATA_MAX = 400;        /* nombre maximum d'appels de métadonnées par import */
var PUSH_MAX = 1000;              /* éléments par appel à extension_push_detections (limite de la RPC) */

/* Sources (colonne « source » de public.detected_media) : crunchyroll et prime (0.6.0, lib/crunchyroll.js, lib/prime.js),
 * netflix (historique lu sur netflix.com), netflix_csv (fichier CSV), live (détection en direct). */
var SOURCES = ['netflix', 'netflix_csv', 'crunchyroll', 'prime', 'live'];

/* ---------- Normalisation des titres (identique à public.normalize_title_for_match ; sert ici à
 * regrouper les lignes du CSV, le serveur recalcule la sienne) ---------- */
var NF_ACCENT_FROM = 'ÀÁÂÃÄÅĀĂĄÇĆĈĊČĎĐÈÉÊËĒĔĖĘĚĜĞĠĢĤĦÌÍÎÏĨĪĬĮİĴĶĹĻĽĿŁÑŃŅŇÒÓÔÕÖØŌŎŐŔŖŘŚŜŞŠŢŤŦÙÚÛÜŨŪŬŮŰŲŴÝŸŶŹŻŽ'
  + 'àáâãäåāăąçćĉċčďđèéêëēĕėęěĝğġģĥħìíîïĩīĭįıĵķĺļľŀłñńņňòóôõöøōŏőŕŗřśŝşšţťŧùúûüũūŭůűųŵýÿŷźżž';
var NF_ACCENT_TO = 'AAAAAAAAACCCCCDDEEEEEEEEEGGGGHHIIIIIIIIIJKLLLLLNNNNOOOOOOOOORRRSSSSTTTUUUUUUUUUUWYYYZZZ'
  + 'aaaaaaaaacccccddeeeeeeeeegggghhiiiiiiiiijklllllnnnnooooooooorrrsssstttuuuuuuuuuuwyyyzzz';
function normalizeTitle(title) {
  if (typeof title !== 'string') return null;
  var v = title.replace(/Œ/g, 'oe').replace(/œ/g, 'oe').replace(/Æ/g, 'ae').replace(/æ/g, 'ae').replace(/ß/g, 'ss');
  v = v.replace(/./g, function (ch) { var i = NF_ACCENT_FROM.indexOf(ch); return i < 0 ? ch : NF_ACCENT_TO.charAt(i); });
  v = v.toLowerCase();
  v = v.replace(/\s*[([]\s*(18|19|20)\d{2}\s*[)\]]\s*$/, '');
  v = v.replace(/[[\]\s!"#$%&'()*+,./:;<=>?@\\^_`{|}~’‘‛`´“”„«»‹›¡¿…–—―·•°-]+/g, ' ');
  v = v.trim();
  var m = v.match(/^(the|le|la|les|l) (.)/);
  if (m) v = v.replace(/^(the|le|la|les|l) /, '');
  return v === '' ? null : v;
}

/* ---------- Décodage des échappements JavaScript d'une page Netflix (authURL arrive en \x3D) ---------- */
function decodeJsString(value) {
  return String(value)
    .replace(/\\x([0-9A-Fa-f]{2})/g, function (_, h) { return String.fromCharCode(parseInt(h, 16)); })
    .replace(/\\u([0-9A-Fa-f]{4})/g, function (_, h) { return String.fromCharCode(parseInt(h, 16)); })
    .replace(/\\\//g, '/');
}
function firstGroup(text, re) {
  var m = re.exec(text);
  return m ? m[1] : null;
}
/* Session lue dans le HTML d'une page Netflix (netflix.com/browse ou /viewingactivity) */
function extractNetflixSession(html) {
  if (typeof html !== 'string' || html.length > 5 * 1024 * 1024) return null;
  var auth = firstGroup(html, /"authURL":"([^"\\]*(?:\\.[^"\\]*)*)"/);
  if (!auth) return null;
  var name = firstGroup(html, /"name":"([^"\\]*(?:\\.[^"\\]*)*)"/);
  var guid = firstGroup(html, /"userGuid":"([^"\\]+)"/);
  return { authUrl: decodeJsString(auth), profileName: name ? decodeJsString(name) : null, userGuid: guid || null };
}

/* ---------- Historique Netflix (endpoint aui/pathEvaluator, une page) ---------- */
function netflixHistoryRequest(page, pageSize, userGuid) {
  var size = Math.max(1, Math.min(100, pageSize || NF_HISTORY_PAGE_SIZE));
  var callPath = '["aui","viewingActivity",' + Math.max(0, page | 0) + ',' + size + ']';
  return {
    url: 'https://www.netflix.com/api/aui/pathEvaluator/web/%5E2.0.0?method=call&callPath=' +
      encodeURIComponent(callPath) + '&falcor_server=0.1.0',
    headers: { 'x-netflix.request.routing': '{"path":"/nq/aui/endpoint/%5E1.0.0-web/pathEvaluator","control_tag":"auinqweb"}',
      'content-type': 'application/x-www-form-urlencoded' },
    body: 'param=' + encodeURIComponent(JSON.stringify({ guid: userGuid || '' })),
  };
}
/* Élément brut -> {movieId, title, seriesTitle|null, seriesId|null, dateMs|null, bookmarkMs|null, durationMs|null} */
function parseNetflixHistoryItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  var movieId = typeof raw.movieID === 'number' && Number.isInteger(raw.movieID) ? raw.movieID : null;
  if (movieId === null || movieId <= 0) return null;
  var isShow = typeof raw.series === 'number' && raw.series > 0;
  var title = typeof raw.title === 'string' ? raw.title.trim() : '';
  var seriesTitle = isShow && typeof raw.seriesTitle === 'string' ? raw.seriesTitle.trim() : '';
  if (isShow ? !seriesTitle : !title) return null;
  function ms(v) { return typeof v === 'number' && isFinite(v) && v >= 0 ? v : null; }
  return {
    movieId: movieId,
    title: (title || seriesTitle).slice(0, 300),
    seriesTitle: isShow ? seriesTitle.slice(0, 300) : null,
    seriesId: isShow ? raw.series : null,
    dateMs: typeof raw.date === 'number' && isFinite(raw.date) && raw.date > 0 ? raw.date : null,
    bookmarkMs: ms(raw.bookmark),
    durationMs: ms(raw.duration),
  };
}
function parseNetflixHistoryPage(json) {
  var items = json && json.jsonGraph && json.jsonGraph.aui && json.jsonGraph.aui.viewingActivity
    && json.jsonGraph.aui.viewingActivity.value && json.jsonGraph.aui.viewingActivity.value.viewedItems;
  if (!Array.isArray(items)) return null; /* réponse illisible : erreur, pas « fin de l'historique » */
  var out = [];
  for (var i = 0; i < items.length; i++) { var it = parseNetflixHistoryItem(items[i]); if (it) out.push(it); }
  return out;
}

/* ---------- Métadonnées Netflix (fiche d'une série ou d'un film : saison/épisode, année) ---------- */
/* Adresse essayée en premier (route « release », d'après Universal Trakt Scrobbler). Les anciennes
 * adresses (/nq/website/memberapi/<build>, /api/shakti/...) servent de repli si celle-ci échoue. */
function netflixMetadataUrls(kind, id) {
  var q = 'languages=en-US&movieid=' + encodeURIComponent(String(id));
  var bases = ['https://www.netflix.com/nq/website/memberapi/release', 'https://www.netflix.com/api/shakti/mre'];
  var out = [];
  for (var i = 0; i < bases.length; i++) out.push(bases[i] + '/metadata?' + q);
  return out;
}
/* Réponse metadata -> {type:'show'|'movie', id, title, year, hiddenNumbers, seasons:[{seq, episodes:[{id, seq, title}]}]} */
function parseNetflixMetadata(json) {
  var video = json && json.video;
  if (!video || (video.type !== 'show' && video.type !== 'movie')) return null;
  var out = { type: video.type, id: typeof video.id === 'number' ? video.id : null,
    title: typeof video.title === 'string' ? video.title.trim().slice(0, 300) : '',
    year: typeof video.year === 'number' && video.year >= 1800 && video.year <= 2100 ? String(video.year) : '' };
  if (video.type === 'movie') return out;
  out.hiddenNumbers = video.hiddenEpisodeNumbers === true;
  out.seasons = [];
  var seasons = Array.isArray(video.seasons) ? video.seasons : [];
  for (var i = 0; i < seasons.length; i++) {
    var s = seasons[i];
    var season = { seq: typeof s.seq === 'number' ? s.seq : null, episodes: [] };
    var eps = Array.isArray(s.episodes) ? s.episodes : [];
    for (var j = 0; j < eps.length; j++) {
      var e = eps[j];
      if (typeof e.id === 'number') season.episodes.push({ id: e.id, seq: typeof e.seq === 'number' ? e.seq : null,
        title: typeof e.title === 'string' ? e.title.trim().slice(0, 300) : '' });
    }
    out.seasons.push(season);
  }
  return out;
}
/* movieId d'un épisode -> {season, episode} (null si numéro masqué : collection Netflix) */
function locateEpisode(meta, movieId) {
  if (!meta || meta.type !== 'show') return null;
  for (var i = 0; i < meta.seasons.length; i++) {
    for (var j = 0; j < meta.seasons[i].episodes.length; j++) {
      if (meta.seasons[i].episodes[j].id === movieId) {
        if (meta.hiddenNumbers) return { season: null, episode: null, hidden: true };
        var season = meta.seasons[i].seq, episode = meta.seasons[i].episodes[j].seq;
        if (typeof season !== 'number' || typeof episode !== 'number' || season < 0 || episode < 0) return null;
        return { season: season, episode: episode, hidden: false };
      }
    }
  }
  return null;
}

/* Épisode commencé mais pas fini : position connue et inférieure à 80 % de la durée.
 * Une position nulle ou absente reste « inconnue » (comptée vue) : Netflix ne la renseigne pas
 * toujours pour un épisode terminé. */
var EPISODE_DONE_RATIO = 0.8;
function isPartial(it) {
  return typeof it.bookmarkMs === 'number' && typeof it.durationMs === 'number' && it.durationMs > 0
    && it.bookmarkMs > 0 && it.bookmarkMs / it.durationMs < EPISODE_DONE_RATIO;
}
/* Pourcentage vu (0-100) quand la position et la durée sont connues, sinon null */
function percentWatched(it) {
  if (typeof it.bookmarkMs !== 'number' || typeof it.durationMs !== 'number' || it.durationMs <= 0 || it.bookmarkMs <= 0) return null;
  return Math.max(0, Math.min(100, Math.round(100 * it.bookmarkMs / it.durationMs)));
}
/* Regroupe l'historique par série (ou par film) : on ne garde que la position la plus avancée,
 * et la date la plus récente (sert au réimport : seuls les éléments plus récents sont relus). */
function aggregateHistory(items) {
  var byKey = {};
  var order = [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    var key = it.seriesId ? 'show:' + it.seriesId : 'movie:' + it.movieId;
    var g = byKey[key];
    if (!g) { g = byKey[key] = { key: key, kind: it.seriesId ? 'show' : 'movie', seriesId: it.seriesId,
      title: it.seriesTitle || it.title, altTitles: [], year: '', episodes: [], dateMs: null, progress: null, pct: null }; order.push(key); }
    if (it.dateMs && (g.dateMs === null || it.dateMs > g.dateMs)) g.dateMs = it.dateMs;
    if (g.kind === 'movie') { if (g.pct === null) g.pct = percentWatched(it); continue; } /* historique du plus récent au plus ancien */
    var seen = false;
    for (var j = 0; j < g.episodes.length; j++) if (g.episodes[j].movieId === it.movieId) { seen = true; break; }
    if (!seen) g.episodes.push({ movieId: it.movieId, dateMs: it.dateMs, partial: isPartial(it), pct: percentWatched(it) });
  }
  var out = [];
  for (var k = 0; k < order.length; k++) out.push(byKey[order[k]]);
  return out;
}
/* Complète un groupe avec ses métadonnées : saison/épisode exacts, dernière position, année */
function applyMetadata(group, meta) {
  if (!meta) return group;
  /* Titre de la fiche (en anglais) gardé en second : le titre de l'historique est dans la langue
   * du profil Netflix, souvent la même que la liste Cinepisode */
  if (meta.title && normalizeTitle(meta.title) !== normalizeTitle(group.title) && group.altTitles.indexOf(meta.title) < 0) group.altTitles.push(meta.title);
  if (meta.year) group.year = meta.year;
  if (group.kind !== 'show') return group;
  var best = null;
  for (var i = 0; i < group.episodes.length; i++) {
    var loc = locateEpisode(meta, group.episodes[i].movieId);
    if (!loc || loc.hidden || loc.season === null) continue;
    if (group.episodes[i].partial) continue; /* commencé, pas fini : ne compte pas comme vu */
    group.episodes[i].season = loc.season;
    group.episodes[i].episode = loc.episode;
    if (!best || loc.season > best.season || (loc.season === best.season && loc.episode > best.episode)) best = { season: loc.season, episode: loc.episode, pct: group.episodes[i].pct };
  }
  group.progress = best ? { season: best.season, episode: best.episode } : null;
  group.pct = best ? (best.pct === undefined ? null : best.pct) : null;
  group.hiddenNumbers = meta.hiddenNumbers === true && !best;
  return group;
}

/* ---------- Fichier CSV Netflix (NetflixViewingHistory.csv, bouton « Télécharger tout ») ----------
 * Colonnes « Title,Date ». Formats des titres :
 *   « Stranger Things: Season 1: Chapter One: The Vanishing of Will Byers »   (anglais)
 *   « Stranger Things : Saison 1 : Chapitre un : La disparition de Will Byers » (français)
 *   « Chernobyl: Limited Series: 1:23:45 », « Lupin : Partie 2 : Chapitre 6 », « Inception » (film).
 * Le CSV ne donne PAS le numéro de l'épisode, seulement son titre : on compte les épisodes
 * différents vus dans la saison la plus avancée (exact si la saison a été regardée dans l'ordre),
 * marqué « approx » (le site affiche « ≈ » pour la source netflix_csv). */
function parseCsv(text) {
  if (typeof text !== 'string') return [];
  var rows = [];
  var row = [];
  var cell = '';
  var quoted = false;
  var s = text.replace(/^\uFEFF/, '');
  for (var i = 0; i < s.length; i++) {
    var c = s.charAt(i);
    if (quoted) {
      if (c === '"') { if (s.charAt(i + 1) === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',' || c === ';') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s.charAt(i + 1) === '\n') i++;
      row.push(cell); cell = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); if (row.length > 1 || row[0] !== '') rows.push(row); }
  return rows;
}
/* Ordre jour/mois deviné sur tout le fichier : 'dmy' (FR : 25/10/2016) ou 'mdy' (US : 10/25/16) */
function guessDateOrder(values) {
  var dmy = 0, mdy = 0, longYear = 0, n = 0;
  for (var i = 0; i < values.length; i++) {
    var m = String(values[i] || '').trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
    if (!m) continue;
    n++;
    if (+m[1] > 12) dmy++;
    if (+m[2] > 12) mdy++;
    if (m[3].length === 4) longYear++;
  }
  if (dmy > mdy) return 'dmy';
  if (mdy > dmy) return 'mdy';
  return n && longYear === n ? 'dmy' : 'mdy';
}
function parseDateFlexible(value, order) {
  var v = String(value || '').trim();
  var m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (!m) return null;
  var y = +m[3]; if (y < 100) y += 2000;
  var day = order === 'mdy' ? +m[2] : +m[1], month = order === 'mdy' ? +m[1] : +m[2];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return Date.UTC(y, month - 1, day);
}
/* Segment « saison » : Saison 2, Season 2, Partie 2, Part 2, Volume 2, Livre 2, Série limitée... */
var CSV_SEASON_RE = /^(?:saison|season|partie|part|volume|vol\.?|livre|book|staffel|temporada|stagione|collection)\s+(\d{1,4})$/i;
var CSV_LIMITED_RE = /^(?:limited series|miniseries|mini-series|série limitée|serie limitee|mini-série|minisérie|mini série|miniserie)$/i;
var CSV_EPISODE_RE = /^(?:épisode|episode|ep\.?|folge|episodio|chapitre|chapter|capítulo|capitulo)\s+(\d{1,5})$/i;
/* Un titre du CSV -> {kind:'show'|'movie'|'unknown', title, season, episode, episodeTitle} */
function parseCsvTitle(raw) {
  var parts = String(raw || '').split(/\s*[:：]\s+|\s+[:：]\s*/).map(function (p) { return p.trim(); }).filter(Boolean);
  if (!parts.length) return null;
  for (var i = 1; i < parts.length; i++) {
    var sm = parts[i].match(CSV_SEASON_RE);
    var limited = CSV_LIMITED_RE.test(parts[i]);
    if (!sm && !limited) continue;
    var rest = parts.slice(i + 1);
    var em = rest.length ? rest[0].match(CSV_EPISODE_RE) : null;
    return { kind: 'show', title: parts.slice(0, i).join(': ').slice(0, 300), season: sm ? +sm[1] : 1,
      episode: em ? +em[1] : null, episodeTitle: rest.join(': ').slice(0, 300) };
  }
  /* Pas de saison : film (« Inception »), ou épisode sans saison (« Our Planet: Jungles ») — décidé
   * sur l'ensemble du fichier (plusieurs lignes avec la même première partie = une série). */
  if (parts.length === 1) return { kind: 'movie', title: parts[0].slice(0, 300), season: null, episode: null, episodeTitle: '' };
  return { kind: 'unknown', title: parts.join(': ').slice(0, 300), head: parts[0].slice(0, 300),
    season: null, episode: null, episodeTitle: parts.slice(1).join(': ').slice(0, 300) };
}
/* CSV complet -> mêmes groupes que l'historique en ligne (clé = titre normalisé) */
function parseNetflixCsv(text) {
  var rows = parseCsv(text);
  if (!rows.length) return { items: [], error: 'empty' };
  var header = rows[0].map(function (c) { return c.trim().toLowerCase(); });
  var titleCol = header.indexOf('title') >= 0 ? header.indexOf('title') : header.indexOf('titre');
  var dateCol = header.indexOf('date');
  if (titleCol < 0) return { items: [], error: 'no_title_column' };
  var body = rows.slice(1, 50001);
  var order = guessDateOrder(body.map(function (r) { return dateCol >= 0 ? r[dateCol] : ''; }));
  var parsedRows = [];
  var headCount = {};
  for (var i = 0; i < body.length; i++) {
    var p = parseCsvTitle(body[i][titleCol]);
    if (!p) continue;
    p.dateMs = dateCol >= 0 ? parseDateFlexible(body[i][dateCol], order) : null;
    parsedRows.push(p);
    if (p.kind === 'unknown') { var hk = normalizeTitle(p.head); if (hk) headCount[hk] = (headCount[hk] || {}); if (hk) headCount[hk][normalizeTitle(p.episodeTitle) || ''] = true; }
  }
  var groups = {};
  var keys = [];
  for (var j = 0; j < parsedRows.length; j++) {
    var r = parsedRows[j];
    if (r.kind === 'unknown') {
      var hn = normalizeTitle(r.head);
      if (hn && Object.keys(headCount[hn] || {}).length >= 2) r = { kind: 'show', title: r.head, season: 1, episode: null, episodeTitle: r.episodeTitle, dateMs: r.dateMs };
      else r = { kind: 'movie', title: r.title, season: null, episode: null, episodeTitle: '', dateMs: r.dateMs };
    }
    var norm = normalizeTitle(r.title);
    if (!norm) continue;
    var key = (r.kind === 'movie' ? 'movie:' : 'show:') + norm;
    var g = groups[key];
    if (!g) { g = groups[key] = { key: key, kind: r.kind, seriesId: null, title: r.title, altTitles: [], year: '',
      episodes: [], dateMs: null, progress: null, seasons: {} }; keys.push(key); }
    if (r.dateMs && (g.dateMs === null || r.dateMs > g.dateMs)) g.dateMs = r.dateMs;
    if (r.kind !== 'show') continue;
    var sKey = String(r.season);
    var seasonSet = g.seasons[sKey] || (g.seasons[sKey] = { numbered: 0, titles: {} });
    if (r.episode !== null) seasonSet.numbered = Math.max(seasonSet.numbered, r.episode);
    else seasonSet.titles[normalizeTitle(r.episodeTitle) || ('#' + j)] = true;
  }
  var items = [];
  for (var k = 0; k < keys.length; k++) {
    var gr = groups[keys[k]];
    if (gr.kind === 'show') {
      var maxSeason = null;
      for (var sk in gr.seasons) if (maxSeason === null || +sk > maxSeason) maxSeason = +sk;
      if (maxSeason !== null) {
        var ss = gr.seasons[String(maxSeason)];
        var counted = Object.keys(ss.titles).length;
        var ep = Math.max(ss.numbered, counted);
        if (ep > 0) gr.progress = { season: maxSeason, episode: ep, approx: ss.numbered < counted || ss.numbered === 0 };
      }
    }
    delete gr.seasons;
    items.push(gr);
  }
  return { items: items, error: null };
}

/* ---------- Ce qui est envoyé à Cinepisode (extension_push_detections) ---------- */
/* Groupe (historique Netflix ou CSV) -> élément envoyé : {source, title, type, season, episode,
 * watched_at, progress_pct}. Série sans numéro connu (collection Netflix, fiche illisible) :
 * envoyée sans saison/épisode, le site ne proposera pas de progression inventée. */
function pushItemFromGroup(group, source) {
  if (!group || typeof group.title !== 'string' || !group.title.trim()) return null;
  if (SOURCES.indexOf(source) < 0) return null;
  var isShow = group.kind === 'show';
  var p = isShow && group.progress && Number.isInteger(group.progress.season) && Number.isInteger(group.progress.episode) ? group.progress : null;
  return {
    source: source,
    title: group.title.trim().slice(0, 300),
    type: isShow ? 'show' : 'movie',
    season: p ? p.season : null,
    episode: p ? p.episode : null,
    watched_at: typeof group.dateMs === 'number' && isFinite(group.dateMs) && group.dateMs > 0 ? group.dateMs : null,
    progress_pct: typeof group.pct === 'number' && group.pct >= 0 && group.pct <= 100 ? group.pct : null,
  };
}
function pushItemsFromGroups(groups, source) {
  var out = [];
  for (var i = 0; i < (groups || []).length; i++) { var it = pushItemFromGroup(groups[i], source); if (it) out.push(it); }
  return out;
}
/* Détection en direct restée sans correspondance (« pas dans ta liste », « plusieurs titres ») */
function pushItemFromLive(det, atMs) {
  if (!det || typeof det.title !== 'string' || !det.title.trim()) return null;
  var isShow = det.kind === 'episode';
  if (isShow && !(Number.isInteger(det.season) && Number.isInteger(det.episode))) return null;
  return { source: 'live', title: det.title.trim().slice(0, 300), type: isShow ? 'show' : 'movie',
    season: isShow ? det.season : null, episode: isShow ? det.episode : null,
    watched_at: typeof atMs === 'number' ? atMs : null, progress_pct: null };
}
/* Lots acceptés par la RPC (1 000 éléments au plus) */
function chunkItems(items, size) {
  var n = size || PUSH_MAX;
  var out = [];
  for (var i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}
/* Date la plus récente d'un import (sert au réimport incrémental) */
function latestDate(groups, previous) {
  var m = typeof previous === 'number' ? previous : 0;
  for (var i = 0; i < (groups || []).length; i++) if (groups[i].dateMs && groups[i].dateMs > m) m = groups[i].dateMs;
  return m || null;
}

/* ---------- Orchestration (fetch injecté : testable, et exécuté dans l'onglet Netflix) ---------- */
/* Charge tout l'historique Netflix. Renvoie {items, truncated, pages} ou lève une erreur. */
/* opts.sinceMs : réimport, on s'arrête aux éléments déjà lus ; opts.onProgress(pages, éléments) */
async function fetchNetflixHistory(fetchFn, session, opts) {
  opts = opts || {};
  var sinceMs = typeof opts.sinceMs === 'number' ? opts.sinceMs : null;
  var all = [];
  var truncated = false;
  var reachedKnown = false;
  var page = 0;
  for (; page < NF_HISTORY_MAX_PAGES && !reachedKnown; page++) {
    var req = netflixHistoryRequest(page, NF_HISTORY_PAGE_SIZE, session && session.userGuid);
    var res = await fetchFn(req.url, { method: 'POST', headers: req.headers, body: req.body, credentials: 'include' });
    if (!res || res.status === 401 || res.status === 403) { var e = new Error('auth'); e.code = 'netflix_auth'; throw e; }
    if (!res || res.status < 200 || res.status >= 300) { var e2 = new Error('http ' + (res && res.status)); e2.code = 'netflix_http'; throw e2; }
    var json = null;
    try { json = JSON.parse(res.body); } catch (err) { json = null; }
    var items = parseNetflixHistoryPage(json);
    if (items === null) { var e3 = new Error('parse'); e3.code = 'netflix_parse'; throw e3; }
    if (!items.length) break;
    for (var i = 0; i < items.length; i++) {
      if (sinceMs !== null && items[i].dateMs !== null && items[i].dateMs < sinceMs) { reachedKnown = true; continue; }
      all.push(items[i]);
    }
    if (opts.onProgress) opts.onProgress(page + 1, all.length);
  }
  if (page >= NF_HISTORY_MAX_PAGES && !reachedKnown) truncated = true;
  return { items: aggregateHistory(all), truncated: truncated, pages: page };
}
/* Complète les groupes avec saison/épisode/année (au plus NF_METADATA_MAX fiches). */
async function fetchNetflixMetadata(fetchFn, groups, onProgress) {
  var fetched = 0, failed = false;
  for (var i = 0; i < groups.length; i++) {
    if (onProgress) onProgress(i, groups.length);
    var g = groups[i];
    /* Films : pas de fiche (elle n'apporterait que l'année) ; séries : saison/épisode exacts */
    var id = g.kind === 'show' ? g.seriesId : null;
    if (!id || fetched >= NF_METADATA_MAX) { if (id && fetched >= NF_METADATA_MAX) g.metaSkipped = true; continue; }
    var urls = netflixMetadataUrls(g.kind, id);
    var meta = null;
    for (var u = 0; u < urls.length && !meta; u++) {
      try {
        var res = await fetchFn(urls[u], { method: 'GET', credentials: 'include' });
        if (res && res.status >= 200 && res.status < 300) meta = parseNetflixMetadata(JSON.parse(res.body));
      } catch (err) { meta = null; }
    }
    fetched++;
    if (!meta) { failed = true; continue; }
    applyMetadata(g, meta);
  }
  return { fetched: fetched, failed: failed };
}

var CinepisodeImport = {
  NF_HISTORY_PAGE_SIZE: NF_HISTORY_PAGE_SIZE, NF_HISTORY_MAX_PAGES: NF_HISTORY_MAX_PAGES,
  NF_METADATA_MAX: NF_METADATA_MAX, PUSH_MAX: PUSH_MAX, SOURCES: SOURCES,
  normalizeTitle: normalizeTitle, decodeJsString: decodeJsString, extractNetflixSession: extractNetflixSession,
  netflixHistoryRequest: netflixHistoryRequest, parseNetflixHistoryItem: parseNetflixHistoryItem,
  parseNetflixHistoryPage: parseNetflixHistoryPage, netflixMetadataUrls: netflixMetadataUrls,
  parseNetflixMetadata: parseNetflixMetadata, locateEpisode: locateEpisode,
  isPartial: isPartial, percentWatched: percentWatched, aggregateHistory: aggregateHistory, applyMetadata: applyMetadata,
  parseCsv: parseCsv, guessDateOrder: guessDateOrder, parseDateFlexible: parseDateFlexible, parseCsvTitle: parseCsvTitle,
  parseNetflixCsv: parseNetflixCsv,
  pushItemFromGroup: pushItemFromGroup, pushItemsFromGroups: pushItemsFromGroups, pushItemFromLive: pushItemFromLive,
  chunkItems: chunkItems, latestDate: latestDate,
  fetchNetflixHistory: fetchNetflixHistory, fetchNetflixMetadata: fetchNetflixMetadata,
};
if (typeof module !== 'undefined' && module.exports) module.exports = CinepisodeImport;
