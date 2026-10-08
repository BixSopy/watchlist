'use strict';
/*
 * Import de l'historique de visionnage (extension Cinepisode 0.5.0).
 * Tout reste dans le navigateur : lecture de l'historique Netflix, lecture du fichier CSV Netflix,
 * correspondance avec la liste Cinepisode, choix des fiches TMDB. Rien n'est envoyé à Cinepisode
 * tant que l'utilisateur n'a pas coché puis cliqué sur « Appliquer ».
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
var TMDB_SEARCH_MAX = 150;        /* recherches TMDB maximum par import (quota quotidien : 4 000) */
var APPLY_UPDATES_MAX = 500;      /* taille d'un lot d'application (limites de la RPC) */
var APPLY_INSERTS_MAX = 200;
var STORAGE_MAX = 3000;           /* éléments gardés dans la page « Détectés » */
var MATCH_MIN = 0.86;             /* ressemblance minimale pour retenir un candidat TMDB */
var MATCH_GAP = 0.06;             /* écart minimal avec le 2e candidat pour être « sans ambiguïté » */

var ANIME_GENRES = ['shonen', 'seinen', 'shojo', 'isekai', 'slice', 'autre'];
var KW_SHONEN = ['shonen', 'shounen', 'superpower', 'martial arts', 'ninja', 'pirate', 'demon slayer', 'dragon ball'];
var KW_SEINEN = ['seinen', 'psychological', 'thriller', 'berserk', 'vinland', 'mature', 'gore'];
var KW_SHOJO = ['shojo', 'shoujo', 'romance', 'magical girl', 'fruits basket'];
var KW_ISEKAI = ['isekai', 'another world', 'reincarnation', 'transported', 'summoned to'];
var KW_SLICE = ['slice of life', 'daily life', 'school life', 'coming of age', 'moe', 'everyday'];

/* Sources (colonne « source » de la page Détectés ; les futures plateformes s'y ajoutent) :
 * netflix (historique lu sur netflix.com), netflix_csv (fichier CSV), live (détection en direct). */
var SOURCES = ['netflix', 'netflix_csv', 'live'];

/* ---------- Normalisation des titres (identique à public.normalize_title_for_match) ---------- */
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
      title: it.seriesTitle || it.title, altTitles: [], year: '', episodes: [], dateMs: null, progress: null }; order.push(key); }
    if (it.dateMs && (g.dateMs === null || it.dateMs > g.dateMs)) g.dateMs = it.dateMs;
    if (g.kind === 'movie') continue;
    var seen = false;
    for (var j = 0; j < g.episodes.length; j++) if (g.episodes[j].movieId === it.movieId) { seen = true; break; }
    if (!seen) g.episodes.push({ movieId: it.movieId, dateMs: it.dateMs, partial: isPartial(it) });
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
    if (!best || loc.season > best.season || (loc.season === best.season && loc.episode > best.episode)) best = loc;
  }
  group.progress = best ? { season: best.season, episode: best.episode } : null;
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
 * et la fiche est marquée « approx » dans la page. */
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

/* ---------- Correspondance avec la liste Cinepisode ---------- */
function groupNorms(group) {
  var out = [];
  var titles = [group.title].concat(group.altTitles || []);
  for (var i = 0; i < titles.length; i++) { var n = normalizeTitle(titles[i]); if (n && out.indexOf(n) < 0) out.push(n); }
  return out;
}
function findListMatches(group, listItems) {
  var norms = groupNorms(group);
  var matches = [];
  for (var i = 0; i < listItems.length; i++) {
    var it = listItems[i];
    if (!it || !it.norm || norms.indexOf(it.norm) < 0) continue;
    var typeOk = group.kind === 'movie' ? it.type === 'film' : (it.type === 'serie' || it.type === 'anime');
    if (typeOk) matches.push(it);
  }
  return matches;
}
/* La progression proposée va-t-elle plus loin que celle enregistrée ? (film : pas encore terminé) */
function progressMovesForward(item, progress) {
  if (!progress) return item.type === 'film' ? item.status !== 'termine' : false;
  if (item.season === null || item.season === undefined || item.episode === null || item.episode === undefined) return true;
  if (progress.season > item.season) return true;
  if (progress.season === item.season && progress.episode > item.episode) return true;
  return progress.season === item.season && progress.episode === item.episode && (item.status === 'avoir' || item.status === 'todo');
}

/* ---------- Recherche TMDB : score de ressemblance et choix du candidat ---------- */
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length || !b.length) return Math.max(a.length, b.length);
  var prev = new Array(b.length + 1);
  var cur = new Array(b.length + 1);
  for (var j = 0; j <= b.length; j++) prev[j] = j;
  for (var i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (var k = 1; k <= b.length; k++) {
      var cost = a.charAt(i - 1) === b.charAt(k - 1) ? 0 : 1;
      cur[k] = Math.min(cur[k - 1] + 1, prev[k] + 1, prev[k - 1] + cost);
    }
    var tmp = prev; prev = cur; cur = tmp;
  }
  return prev[b.length];
}
/* 0..1 : égalité des titres normalisés, avec bonus année et malus de popularité faible */
function similarity(group, candidate) {
  var as = groupNorms(group);
  var bs = [normalizeTitle(candidate.title), normalizeTitle(candidate.originalTitle || '')].filter(Boolean);
  var score = 0;
  for (var i = 0; i < as.length; i++) for (var j = 0; j < bs.length; j++) {
    var a = as[i], b = bs[j];
    var sc = a === b ? 1 : 1 - levenshtein(a, b) / Math.max(a.length, b.length);
    if (sc > score) score = sc;
  }
  if (!score) return 0;
  if (group.year && candidate.year) {
    var dy = Math.abs(+candidate.year - +group.year);
    score += dy === 0 ? 0.05 : dy === 1 ? 0 : -0.12;
  }
  return Math.max(0, Math.min(1, score));
}
/* Candidats TMDB classés (type attendu uniquement), avec leur score */
function rankCandidates(group, tmdbResults) {
  var wantMovie = group.kind === 'movie';
  var out = [];
  for (var i = 0; i < (tmdbResults || []).length; i++) {
    var r = tmdbResults[i];
    var isMovie = r.media_type === 'movie' || (!r.media_type && r.title && !r.name);
    if (wantMovie !== !!isMovie) continue;
    var title = (isMovie ? r.title : r.name) || '';
    var date = (isMovie ? r.release_date : r.first_air_date) || '';
    var candidate = { tmdbId: r.id, tmdbType: isMovie ? 'movie' : 'tv', title: title,
      originalTitle: (isMovie ? r.original_title : r.original_name) || '',
      year: String(date).slice(0, 4), poster: r.poster_path || null, overview: r.overview || '',
      score: typeof r.vote_average === 'number' ? Math.round(r.vote_average * 10) / 10 : null,
      popularity: r.popularity || 0, genreIds: r.genre_ids || [], originCountry: r.origin_country || [] };
    candidate.match = similarity(group, candidate);
    if (candidate.match >= MATCH_MIN && candidate.tmdbId) out.push(candidate);
  }
  out.sort(function (x, y) { return y.match - x.match || y.popularity - x.popularity; });
  return out.slice(0, 5);
}
/* Sans ambiguïté : un seul candidat, un candidat nettement plus ressemblant, ou (titres identiques)
 * un candidat bien plus connu que les homonymes (popularité TMDB 5 fois supérieure). */
function isUnambiguous(ranked) {
  if (!ranked.length) return false;
  if (ranked.length === 1) return true;
  if (ranked[0].match - ranked[1].match >= MATCH_GAP) return true;
  return ranked[0].match >= 0.99 && ranked[0].popularity >= 5 * Math.max(ranked[1].popularity, 0.5);
}

/* ---------- Genre anime (mêmes mots-clés que le site, js/04-tmdb-api.js) ---------- */
function detectAnimeGenreFromKeywords(names) {
  var all = (names || []).join(' ').toLowerCase();
  function has(list) { for (var i = 0; i < list.length; i++) if (all.indexOf(list[i]) >= 0) return true; return false; }
  if (has(KW_ISEKAI)) return 'isekai';
  if (has(KW_SLICE)) return 'slice';
  if (has(KW_SHOJO)) return 'shojo';
  if (has(KW_SEINEN)) return 'seinen';
  if (has(KW_SHONEN)) return 'shonen';
  if (all.indexOf('action') >= 0 || all.indexOf('adventure') >= 0) return 'shonen';
  return 'autre';
}
/* Le site classe en anime une série dont le titre ou le résumé contient « anime » ; on ajoute
 * les genres TMDB animation (16) + origine JP, qui rattrapent la plupart des anime. */
function isAnimeCandidate(candidate) {
  var text = ((candidate.title || '') + ' ' + (candidate.overview || '')).toLowerCase();
  if (text.indexOf('anime') >= 0) return true;
  var genres = candidate.genreIds || [];
  var jp = (candidate.originCountry || []).indexOf('JP') >= 0;
  return genres.indexOf(16) >= 0 && jp;
}

/* ---------- Série terminée ? (dernier épisode vu = dernier épisode diffusé selon TMDB) ---------- */
function isSeriesFinished(progress, tmdbDetails) {
  if (!progress || !tmdbDetails) return false;
  var seasons = Array.isArray(tmdbDetails.seasons) ? tmdbDetails.seasons : [];
  var regular = [];
  for (var i = 0; i < seasons.length; i++) if (seasons[i] && seasons[i].season_number > 0) regular.push(seasons[i]);
  if (!regular.length) return false;
  regular.sort(function (a, b) { return a.season_number - b.season_number; });
  var last = regular[regular.length - 1];
  if (!last.episode_count || progress.season !== last.season_number || progress.episode < last.episode_count) return false;
  /* Série encore en production : le dernier épisode diffusé n'est pas la fin */
  if (tmdbDetails.status && tmdbDetails.status !== 'Ended' && tmdbDetails.status !== 'Canceled') return false;
  if (tmdbDetails.in_production === true) return false;
  return true;
}

/* ---------- Construction des fiches de la page « Détectés » ---------- */
var SOURCES_LABEL = { netflix: 'netflix', netflix_csv: 'netflix_csv', live: 'live' };
function newDetected(partial) {
  return {
    key: partial.key,                 /* identifiant stable (déduplication) */
    source: SOURCES_LABEL[partial.source] || 'netflix',
    kind: partial.kind,               /* 'show' | 'movie' */
    title: partial.title,
    altTitles: Array.isArray(partial.altTitles) ? partial.altTitles.slice(0, 3) : [],
    year: partial.year || '',
    dateMs: partial.dateMs || null,   /* visionnage le plus récent (réimport incrémental) */
    progress: partial.progress || null, /* {season, episode} ou null */
    hiddenNumbers: partial.hiddenNumbers === true,
    list: partial.list || null,       /* {state:'update'|'ambiguous'|'unchanged', matches:[{id,title,type,status,season,episode}]} */
    tmdb: partial.tmdb || null,       /* {state:'unambiguous'|'ambiguous'|'none', candidates:[...]} */
    firstSeen: partial.firstSeen || Date.now(),
  };
}
/* Groupe d'historique + liste Cinepisode -> fiche (sans TMDB : fait ensuite pour les titres absents) */
function detectedFromGroup(group, listItems, source) {
  var matches = findListMatches(group, listItems);
  var base = { key: detectedKey(group.kind, group.title) || (source + ':' + group.key), source: source, kind: group.kind, title: group.title, altTitles: group.altTitles,
    year: group.year, dateMs: group.dateMs, progress: group.progress || null, hiddenNumbers: group.hiddenNumbers === true };
  if (matches.length > 1) {
    base.list = { state: 'ambiguous', matches: matches.map(compactMatch) };
    return newDetected(base);
  }
  if (matches.length === 1) {
    var m = matches[0];
    base.list = { state: progressMovesForward(m, group.kind === 'movie' ? null : group.progress) ? 'update' : 'unchanged',
      matches: [compactMatch(m)] };
    return newDetected(base);
  }
  base.tmdb = { state: 'pending', candidates: [] };
  return newDetected(base);
}
function compactMatch(m) {
  return { id: m.id, title: m.title, type: m.type, status: m.status,
    poster: typeof m.poster_path === 'string' && /^\/[A-Za-z0-9_.-]{1,200}$/.test(m.poster_path) ? m.poster_path : null,
    season: m.season === undefined ? null : m.season, episode: m.episode === undefined ? null : m.episode };
}
/* Résultat TMDB -> complète la fiche (appelé seulement pour les titres absents de la liste) */
function applyTmdbResults(detected, tmdbResults) {
  var ranked = rankCandidates(detected, tmdbResults);
  detected.tmdb = { state: ranked.length === 0 ? 'none' : isUnambiguous(ranked) ? 'unambiguous' : 'ambiguous',
    candidates: ranked.slice(0, isUnambiguous(ranked) ? 1 : 4).map(function (c) { return { tmdbId: c.tmdbId, tmdbType: c.tmdbType, title: c.title,
      originalTitle: c.originalTitle, popularity: c.popularity,
      year: c.year, poster: c.poster, overview: (c.overview || '').slice(0, 300), score: c.score,
      genreIds: c.genreIds, originCountry: c.originCountry, match: Math.round(c.match * 1000) / 1000 }; }) };
  return detected;
}

/* Titre absent par son nom mais présent par sa fiche TMDB (titre traduit différemment dans la
 * liste) : devient une mise à jour du titre existant au lieu d'un doublon. */
function linkByTmdbId(detected, listItems, candidateIndex) {
  if (detected.list || !detected.tmdb || !detected.tmdb.candidates.length) return detected;
  if (candidateIndex === -1) return detected; /* candidat pas encore choisi */
  var c = detected.tmdb.candidates[candidateIndex || 0];
  if (!c) return detected;
  for (var i = 0; i < listItems.length; i++) {
    var it = listItems[i];
    if (it && it.tmdb_id === c.tmdbId && it.tmdb_type === c.tmdbType) {
      var typeOk = detected.kind === 'movie' ? it.type === 'film' : (it.type === 'serie' || it.type === 'anime');
      if (!typeOk) continue;
      detected.list = { state: progressMovesForward(it, detected.kind === 'movie' ? null : detected.progress) ? 'update' : 'unchanged',
        matches: [compactMatch(it)], viaTmdb: true };
      return detected;
    }
  }
  return detected;
}

/* Recalcule l'état d'une fiche par rapport à la liste actuelle (la liste a pu changer depuis) */
function refreshAgainstList(d, listItems) {
  var group = { title: d.title, altTitles: d.altTitles || [], kind: d.kind, progress: d.progress };
  var matches = findListMatches(group, listItems);
  d.list = null;
  if (matches.length > 1) d.list = { state: 'ambiguous', matches: matches.map(compactMatch) };
  else if (matches.length === 1) {
    d.list = { state: progressMovesForward(matches[0], d.kind === 'movie' ? null : d.progress) ? 'update' : 'unchanged',
      matches: [compactMatch(matches[0])] };
  } else {
    if (!d.tmdb) d.tmdb = { state: 'pending', candidates: [] };
    linkByTmdbId(d, listItems, d.tmdb.state === 'unambiguous' ? 0 : -1);
  }
  return d;
}

/* Case cochée par défaut ? Uniquement quand il n'y a aucun choix à faire. */
function defaultChecked(d) {
  if (d.list && d.list.state === 'update') return true;
  if (!d.list && d.tmdb && d.tmdb.state === 'unambiguous' && (d.kind === 'movie' || d.progress)) return true;
  return false;
}
/* Famille d'affichage pour les filtres de la page */
function detectedFilter(d) {
  if (d.list && d.list.state === 'ambiguous') return 'ambiguous';
  if (d.list && d.list.state === 'update') return 'updates';
  if (d.list && d.list.state === 'unchanged') return 'unchanged';
  if (d.tmdb && d.tmdb.state === 'ambiguous') return 'ambiguous';
  if (d.tmdb && d.tmdb.state === 'pending') return 'pending';
  return 'new'; /* unambiguous, none, ou pas encore cherché */
}

/* ---------- Ce qui part dans « Appliquer » (rien d'autre n'est envoyé) ---------- */
/* Sélection : {checked: bool, candidate: indice du candidat TMDB choisi ou null} */
function buildApplyPayload(detected, selection) {
  var out = { updates: [], inserts: [] };
  var seenIds = {};
  var seenTmdb = {};
  for (var i = 0; i < detected.length; i++) {
    var d = detected[i];
    var sel = selection[d.key];
    if (!sel || !sel.checked) continue;
    if (d.list && d.list.state === 'update' && d.list.matches.length === 1) {
      var m = d.list.matches[0];
      if (seenIds[m.id]) continue;
      if (d.kind === 'movie') { out.updates.push({ id: m.id, kind: 'movie' }); seenIds[m.id] = true; }
      else if (d.progress) { out.updates.push({ id: m.id, kind: 'episode', season: d.progress.season, episode: d.progress.episode }); seenIds[m.id] = true; }
      continue;
    }
    if (d.list && d.list.state === 'ambiguous' && sel.target) {
      /* Plusieurs titres de la liste portent ce nom : l'utilisateur a choisi lequel mettre à jour */
      var target = null;
      for (var t = 0; t < d.list.matches.length; t++) if (d.list.matches[t].id === sel.target) target = d.list.matches[t];
      if (!target || seenIds[target.id]) continue;
      if (d.kind === 'movie') out.updates.push({ id: target.id, kind: 'movie' });
      else if (d.progress) out.updates.push({ id: target.id, kind: 'episode', season: d.progress.season, episode: d.progress.episode });
      else continue;
      seenIds[target.id] = true;
      continue;
    }
    if (d.list) continue; /* ambigu sans choix, ou inchangé : rien à écrire */
    var idx = sel.candidate === undefined || sel.candidate === null ? 0 : sel.candidate;
    var c = d.tmdb && d.tmdb.candidates[idx];
    if (!c) continue;
    var tmdbKey = c.tmdbType + ':' + c.tmdbId;
    if (seenTmdb[tmdbKey]) continue;
    seenTmdb[tmdbKey] = true;
    var isMovie = c.tmdbType === 'movie';
    var anime = !isMovie && isAnimeCandidate(c);
    var finished = !isMovie && d.finished === true;
    var entry = { tmdb_id: c.tmdbId, tmdb_type: c.tmdbType, type: isMovie ? 'film' : anime ? 'anime' : 'serie',
      status: isMovie || finished ? 'termine' : 'encours', title: c.title.slice(0, 500), year: /^\d{4}$/.test(c.year || '') ? c.year : '',
      poster_path: typeof c.poster === 'string' && /^\/[A-Za-z0-9_.-]{1,200}$/.test(c.poster) ? c.poster : null,
      overview: (c.overview || '').slice(0, 10000), tmdb_score: typeof c.score === 'number' && c.score >= 0 && c.score <= 10 ? c.score : null };
    if (!isMovie) {
      if (!d.progress) continue; /* série sans saison/épisode connue : on n'invente pas de progression */
      entry.saison = d.progress.season; entry.episode = d.progress.episode;
      if (anime) entry.anime_genre = ANIME_GENRES.indexOf(d.animeGenre) >= 0 ? d.animeGenre : 'autre';
    }
    out.inserts.push(entry);
  }
  return out;
}
/* Découpe le payload en lots acceptés par la RPC */
function chunkPayload(payload) {
  var chunks = [];
  var u = payload.updates, ins = payload.inserts, ui = 0, ii = 0;
  while (ui < u.length || ii < ins.length) {
    chunks.push({ updates: u.slice(ui, ui + APPLY_UPDATES_MAX), inserts: ins.slice(ii, ii + APPLY_INSERTS_MAX) });
    ui += APPLY_UPDATES_MAX; ii += APPLY_INSERTS_MAX;
  }
  return chunks;
}

/* ---------- Détections en direct (marquage pendant la lecture) qui n'ont pas abouti ---------- */
function detectedFromLive(last) {
  if (!last || (last.status !== 'not_found' && last.status !== 'ambiguous')) return null;
  if (typeof last.title !== 'string' || !last.title.trim()) return null;
  var kind = last.kind === 'movie' ? 'movie' : 'show';
  var progress = kind === 'show' && Number.isInteger(last.season) && Number.isInteger(last.episode)
    ? { season: last.season, episode: last.episode } : null;
  if (kind === 'show' && !progress) return null;
  var norm = normalizeTitle(last.title.trim());
  if (!norm) return null;
  return newDetected({ key: detectedKey(kind, last.title.trim()), source: 'live', kind: kind, title: last.title.trim().slice(0, 300),
    progress: progress, dateMs: typeof last.at === 'number' ? last.at : null,
    tmdb: { state: 'pending', candidates: [] } });
}

/* ---------- Fusion dans la liste locale ----------
 * Clé indépendante de la source (« show:dark », « movie:inception ») : un même titre vu dans
 * l'historique, le CSV et en direct ne forme qu'une ligne. On garde la position la plus avancée,
 * la date la plus récente, et les résultats TMDB déjà obtenus. « Ignorer » est définitif ; un titre
 * déjà appliqué ne revient que si un visionnage plus récent apparaît. */
function furthest(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  if (b.season > a.season || (b.season === a.season && b.episode > a.episode)) return b;
  if (b.season === a.season && b.episode === a.episode && a.approx && !b.approx) return b;
  return a;
}
function mergeDetected(existing, incoming) {
  var byKey = {};
  var order = [];
  for (var i = 0; i < existing.length; i++) { byKey[existing[i].key] = existing[i]; order.push(existing[i].key); }
  for (var j = 0; j < incoming.length; j++) {
    var inc = incoming[j];
    var prev = byKey[inc.key];
    if (!prev) { byKey[inc.key] = inc; order.push(inc.key); continue; }
    if (prev.dismissed) continue;
    var newer = inc.dateMs && (!prev.dateMs || inc.dateMs > prev.dateMs);
    if (prev.applied && !newer) continue;
    var merged = prev.applied ? inc : prev;
    merged.applied = false;
    merged.progress = furthest(prev.applied ? null : prev.progress, inc.progress);
    merged.dateMs = prev.dateMs && inc.dateMs ? Math.max(prev.dateMs, inc.dateMs) : (inc.dateMs || prev.dateMs || null);
    merged.source = newer ? inc.source : prev.source;
    merged.year = prev.year || inc.year || '';
    merged.firstSeen = prev.firstSeen || inc.firstSeen;
    var alts = (prev.altTitles || []).concat(inc.altTitles || []);
    merged.altTitles = alts.filter(function (a, k) { return alts.indexOf(a) === k && normalizeTitle(a) !== normalizeTitle(merged.title); }).slice(0, 3);
    if (prev.tmdb && prev.tmdb.state !== 'pending') merged.tmdb = prev.tmdb;
    merged.hiddenNumbers = !merged.progress && (prev.hiddenNumbers || inc.hiddenNumbers);
    byKey[inc.key] = merged;
  }
  var out = [];
  for (var k = 0; k < order.length && out.length < STORAGE_MAX; k++) out.push(byKey[order[k]]);
  return out;
}
/* Clé de déduplication d'une fiche */
function detectedKey(kind, title) {
  var n = normalizeTitle(title);
  return n ? (kind === 'movie' ? 'movie:' : 'show:') + n : null;
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
  NF_METADATA_MAX: NF_METADATA_MAX, TMDB_SEARCH_MAX: TMDB_SEARCH_MAX,
  APPLY_UPDATES_MAX: APPLY_UPDATES_MAX, APPLY_INSERTS_MAX: APPLY_INSERTS_MAX, STORAGE_MAX: STORAGE_MAX,
  SOURCES: SOURCES, ANIME_GENRES: ANIME_GENRES,
  normalizeTitle: normalizeTitle, decodeJsString: decodeJsString, extractNetflixSession: extractNetflixSession,
  netflixHistoryRequest: netflixHistoryRequest, parseNetflixHistoryItem: parseNetflixHistoryItem,
  parseNetflixHistoryPage: parseNetflixHistoryPage, netflixMetadataUrls: netflixMetadataUrls,
  parseNetflixMetadata: parseNetflixMetadata, locateEpisode: locateEpisode,
  aggregateHistory: aggregateHistory, applyMetadata: applyMetadata,
  parseCsv: parseCsv, parseDateFlexible: parseDateFlexible, parseCsvTitle: parseCsvTitle, parseNetflixCsv: parseNetflixCsv,
  findListMatches: findListMatches, progressMovesForward: progressMovesForward,
  similarity: similarity, rankCandidates: rankCandidates, isUnambiguous: isUnambiguous,
  detectAnimeGenreFromKeywords: detectAnimeGenreFromKeywords, isAnimeCandidate: isAnimeCandidate,
  isSeriesFinished: isSeriesFinished,
  detectedFromGroup: detectedFromGroup, applyTmdbResults: applyTmdbResults, detectedFromLive: detectedFromLive,
  linkByTmdbId: linkByTmdbId, refreshAgainstList: refreshAgainstList, guessDateOrder: guessDateOrder, isPartial: isPartial,
  defaultChecked: defaultChecked, detectedFilter: detectedFilter,
  buildApplyPayload: buildApplyPayload, chunkPayload: chunkPayload, mergeDetected: mergeDetected,
  detectedKey: detectedKey, furthest: furthest,
  fetchNetflixHistory: fetchNetflixHistory, fetchNetflixMetadata: fetchNetflixMetadata,
};
if (typeof module !== 'undefined' && module.exports) module.exports = CinepisodeImport;
