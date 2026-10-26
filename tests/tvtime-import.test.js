'use strict';
/* Import TV Time (js/27-gdpr-import.js, plateforme « tvtime ») : exports RGPD officiels
   (tracking-prod-records-v2.csv, tracking-prod-records.csv, seen_episode.csv) et extension
   TV Time Out (tvtime-series-episodes.csv, tvtime-movies.csv, JSON). Fichiers synthétiques aux
   en-têtes des exports réels documentés (watchd.pro, parseur TV Time de trakt-web).
   Lancer : node --test tests/ */
const test = require('node:test');
const assert = require('node:assert');
const zlib = require('node:zlib');
const { GDPR_CORE: G, GDPR_FILES: F } = require('../js/27-gdpr-import.js');
const D = require('../js/21-detected.js');
const tmdb = require('../api/tmdb.js');

const V1_HEADER = 'watch_count,uuid,type,series_name,type-uuid-n,updated_at,user_id,created_at,series_id,watches,runtime,release_date_range_key,release_date,alpha_range_key,movie_name,entity_type,follow_date_range_key,rewatch_count,watch_date,series_uuid,season_number,episode_number,episode_id,total_movies_runtime,total_series_runtime,unitarian,watched_episode_range_key,bulk_type,watch_date_range_key,country'.split(',');
const V2_HEADER = 'ep_watch_count,updated_at,key,movie_watch_count,total_movies_runtime,series_follow_count,user_id,created_at,total_series_runtime,is_archived,is_for_later,s_id,series_name,is_followed,uuid,most_recent_ep_watched,followed_at,ep_no,ep_id,episode_number,rewatch_count,s_no,is_unitary,episode_id,season_number,gsi,runtime,bulk_type,is_special'.split(',');
const csv = (h, rows) => [h.join(','), ...rows.map(r => h.map(c => r[c] ?? '').join(','))].join('\n');

const v2 = csv(V2_HEADER, [
  { key: 'watch-episode-aaa-1', created_at: '2021-10-10 11:49:11', s_id: '82066', series_name: 'Fringe', episode_id: '1331151', season_number: '2', episode_number: '10' },
  { key: 'watch-episode-aaa-2', created_at: '2021-10-11 11:49:11', s_id: '82066', series_name: 'Fringe', episode_id: '1331152', s_no: '2', ep_no: '11' },
  { key: 'rewatch-episode-aaa-3', created_at: '2023-01-01 10:00:00', s_id: '82066', series_name: 'Fringe', episode_id: '1331151', season_number: '2', episode_number: '10' },
  { key: 'user-series-bbb', created_at: '2021-05-19 06:06:35', s_id: '353309', series_name: 'Haunted', is_followed: 'true' },
  { key: 'watch-episode-ccc-1', created_at: '2022-02-02 20:00:00', s_id: '121361', series_name: '', episode_id: '3254641', season_number: '1', episode_number: '1' },
]);
const v1 = csv(V1_HEADER, [
  { type: 'watch', 'type-uuid-n': 'watch-x-0', created_at: '2022-04-10 11:26:55', release_date: '2017-10-12', alpha_range_key: 'watch-alpha-what-happened-to-monday', movie_name: 'Seven Sisters', entity_type: 'movie', watch_date_range_key: 'watch-date-1649590015' },
  { type: 'towatch', 'type-uuid-n': 'towatch-y-0', release_date: '2020-01-01', alpha_range_key: 'towatch-alpha-tenet', movie_name: 'Tenet', entity_type: 'movie' },
  { type: 'watch', 'type-uuid-n': 'watch-z-0', created_at: '2020-03-01 10:00:00', series_name: 'Game of Thrones', series_id: '121361', entity_type: 'episode', season_number: '1', episode_number: '2', episode_id: '3254651' },
]);

test('TV Time v2 : épisodes vus, revisionnages fusionnés, suivis ignorés, id TVDB de la série', () => {
  const ev = G.tvtimeFinalize(G.parseText('tvtime', 'tracking-prod-records-v2.csv', v2));
  const fringe = ev.filter(e => e.title === 'Fringe');
  assert.strictEqual(fringe.length, 2);
  assert.deepStrictEqual(fringe.map(e => [e.season, e.episode, e.tvdb]), [[2, 10, 82066], [2, 11, 82066]]);
  assert.ok(!ev.some(e => e.title === 'Haunted'), 'user-series = suivi, pas un visionnage');
  assert.strictEqual(new Date(fringe[0].watchedAt).getUTCFullYear(), 2021, 'premier visionnage gardé');
});

test('TV Time v1 : film (titre localisé, date dans la clé), « à voir » ignoré, épisode avec series_id', () => {
  const ev = G.parseText('tvtime', 'tracking-prod-records.csv', v1);
  const movies = ev.filter(e => e.type === 'movie');
  assert.deepStrictEqual(movies.map(m => m.title), ['Seven Sisters']);
  assert.strictEqual(movies[0].watchedAt, 1649590015000);
  assert.strictEqual(movies[0].year, 2017);
  const got = ev.find(e => e.type === 'show');
  assert.deepStrictEqual([got.title, got.season, got.episode, got.tvdb], ['Game of Thrones', 1, 2, 121361]);
});

test('nom de série manquant retrouvé par l\'id TVDB dans un autre fichier', () => {
  const ev = G.tvtimeFinalize(G.parseText('tvtime', 'tracking-prod-records-v2.csv', v2).concat(G.parseText('tvtime', 'tracking-prod-records.csv', v1)));
  const got = ev.filter(e => e.tvdb === 121361);
  assert.strictEqual(got.length, 2);
  assert.ok(got.every(e => e.title === 'Game of Thrones'));
});

test('seen_episode.csv (anciennes archives) et colonnes alternatives', () => {
  const t = 'tv_show_name;episode_season_number;episode_number;created_at;tv_show_id\nLost;1;4;2015-06-01 12:00:00;73739\nLost;1;5;0001-01-01 00:00:00;73739';
  const ev = G.parseText('tvtime', 'seen_episode.csv', t);
  assert.deepStrictEqual(ev.map(e => [e.title, e.season, e.episode, e.tvdb]), [['Lost', 1, 4, 73739], ['Lost', 1, 5, 73739]]);
  assert.strictEqual(ev[1].watchedAt, null, 'date zéro de Go = inconnue');
});

test('TV Time Out : CSV is_watched seulement, tvdb_id d\'épisode jamais pris pour la série', () => {
  const eps = 'series_name,season_number,episode_number,tvdb_id,is_watched,watched_at\nDark,1,1,6252450,true,2020-05-01T20:00:00Z\nDark,1,2,6252451,false,';
  const ev = G.parseText('tvtime', 'tvtime-series-episodes.csv', eps);
  assert.strictEqual(ev.length, 1);
  assert.strictEqual(ev[0].tvdb, null);
  const mv = G.parseText('tvtime', 'tvtime-movies.csv', 'title,year,watched_at,is_watched\nInception,2010,2019-01-01,true\nDune,2021,,false');
  assert.deepStrictEqual(mv.map(m => [m.title, m.year]), [['Inception', 2010]]);
});

test('TV Time Out : JSON série → saisons → épisodes', () => {
  const json = JSON.stringify([{ name: 'Dark', tvdb_id: 334824, seasons: [{ number: 1, episodes: [{ number: 1, is_watched: true, watched_at: '2020-05-01' }, { number: 2, is_watched: false }] }] }]);
  const ev = G.parseText('tvtime', 'tvtime-series.json', json);
  assert.deepStrictEqual(ev.map(e => [e.title, e.season, e.episode, e.tvdb]), [['Dark', 1, 1, 334824]]);
  const mv = G.parseText('tvtime', 'tvtime-movies.json', JSON.stringify([{ title: 'Inception', year: 2010, is_watched: true }]));
  assert.strictEqual(mv[0].title, 'Inception');
});

test('fichiers lus dans le zip : historique seulement, jamais access_token ni le reste', () => {
  assert.strictEqual(G.wanted('tvtime', 'gdpr/tracking-prod-records-v2.csv'), 'text');
  assert.strictEqual(G.wanted('tvtime', 'seen_episode.csv'), 'text');
  assert.strictEqual(G.wanted('tvtime', 'tvtime-series.json'), 'text');
  for (const f of ['access_token.csv', 'ip_address.csv', 'user.csv', 'comment.csv', 'followed_tv_show.csv'])
    assert.strictEqual(G.wanted('tvtime', f), null, f);
});

function zip(files) {
  const locals = [], centrals = []; let off = 0;
  for (const [name, data] of files) {
    const nb = Buffer.from(name), comp = zlib.deflateRawSync(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nb.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, nb, comp); centrals.push(ch, nb); off += 30 + nb.length + comp.length;
  }
  const cd = Buffer.concat(centrals), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, e]);
}

test('zip officiel → groupes « Détectés » avec progression et id TVDB', async () => {
  const z = zip([['gdpr-data/tracking-prod-records-v2.csv', Buffer.from(v2)], ['gdpr-data/tracking-prod-records.csv', Buffer.from(v1)], ['gdpr-data/access_token.csv', Buffer.from('token\nSECRET')]]);
  const acc = await F.collect('tvtime', 'tv-time-personal-data.zip', new Uint8Array(z), 0, { events: [], files: [] });
  assert.ok(!acc.files.includes('access_token.csv'));
  const rows = G.toRows(G.tvtimeFinalize(acc.events), G.PLATFORMS.tvtime.source, D.normalizeTitle);
  const groups = D.groupRows(rows);
  const fringe = groups.find(g => g.title === 'Fringe');
  assert.deepStrictEqual([fringe.progress.season, fringe.progress.episode, fringe.tvdb], [2, 11, 82066]);
  assert.deepStrictEqual(fringe.sources, ['tvtime_gdpr']);
  assert.ok(groups.find(g => g.kind === 'movie' && g.title === 'Seven Sisters'));
  assert.strictEqual(groups.find(g => g.title === 'Game of Thrones').tvdb, 121361);
});

test('TV Time fermé : pas de demande, pas de rappel', () => {
  assert.strictEqual(G.status({ requestedAt: 1 }, 'tvtime', Date.now()).kind, 'none');
  assert.deepStrictEqual(G.dueReminders({ tvtime: { requestedAt: 1 } }, Date.now()), []);
});

test('/find TMDB : candidat exact, ou vide', () => {
  const g = { kind: 'show', norm: 'fringe', title: 'Fringe' };
  const c = D.findCandidates(g, { tv_results: [{ id: 1705, name: 'Fringe', first_air_date: '2008-09-09' }], movie_results: [] });
  assert.deepStrictEqual([c[0].tmdbId, c[0].tmdbType, c[0].match, c[0].year], [1705, 'tv', 1, '2008']);
  assert.ok(D.isUnambiguous(c));
  assert.deepStrictEqual(D.findCandidates(g, { tv_results: [] }), []);
});

test('proxy /api/tmdb : /find seulement avec external_source=tvdb_id', () => {
  const ok = tmdb._buildUpstream(new URLSearchParams('path=/find/82066&external_source=tvdb_id&language=fr-FR'));
  assert.ok(!ok.error);
  assert.match(ok.query, /external_source=tvdb_id/);
  assert.strictEqual(tmdb._buildUpstream(new URLSearchParams('path=/find/82066')).error, 'param');
  assert.strictEqual(tmdb._buildUpstream(new URLSearchParams('path=/find/82066&external_source=imdb_id')).error, 'param');
  assert.strictEqual(tmdb._buildUpstream(new URLSearchParams('path=/find/tt123&external_source=tvdb_id')).error, 'path');
});
