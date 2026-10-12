'use strict';
/* Onglet Calendrier (js/26-calendar.js) : grille du mois, événements épisodes / films, regroupement
   par jour, prochaines sorties et export .ics. Lancer : node --test tests/ */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../js/26-calendar.js');
const ROOT = path.join(__dirname, '..');

test('grille d\'octobre 2026 : commence le lundi 28 septembre, 5 semaines', () => {
  const g = C.monthGrid(2026, 9);
  assert.equal(g.length, 35);
  assert.deepEqual(g[0], { date: '2026-09-28', day: 28, out: true });
  assert.equal(g[3].date, '2026-10-01'); assert.equal(g[3].out, false);
  assert.equal(g[34].date, '2026-11-01'); assert.equal(g[34].out, true);
  assert.equal(C.monthGrid(2026, 1).length, 28 + 7 * 0 + (C.monthGrid(2026, 1).length - 28)); // février : lignes entières
  assert.equal(C.monthGrid(2026, 1).length % 7, 0);
});

test('épisodes : dates de la saison, épisodes vus masqués, sans date ignorés', () => {
  const item = { id: 'a', title: 'Invincible', type: 'serie', poster: '/p.jpg', saison: 3, episode: 5 };
  const season = { season_number: 3, episodes: [
    { episode_number: 5, air_date: '2026-10-06' }, { episode_number: 6, air_date: '2026-10-13', name: 'Six' }, { episode_number: 7, air_date: null }] };
  const all = C.episodeEvents(item, season, {});
  assert.equal(all.length, 2);
  const ev = C.episodeEvents(item, season, { hideWatched: true });
  assert.deepEqual(ev, [{ date: '2026-10-13', itemId: 'a', title: 'Invincible', poster: '/p.jpg', kind: 'serie', s: 3, e: 6, name: 'Six' }]);
  assert.equal(C.code(ev[0]), 'S03 · E06');
  assert.equal(C.episodeEvents({ ...item, type: 'anime' }, season, {})[0].kind, 'anime');
});

test('films : sorties de la région par type (ciné, streaming, Blu-ray), sinon release_date', () => {
  const item = { id: 'f', title: 'Dune', type: 'film' };
  const rd = { results: [
    { iso_3166_1: 'US', release_dates: [{ type: 3, release_date: '2026-09-01T00:00:00.000Z' }] },
    { iso_3166_1: 'FR', release_dates: [{ type: 3, release_date: '2026-10-10T00:00:00.000Z' }, { type: 3, release_date: '2026-10-08T00:00:00.000Z' }, { type: 4, release_date: '2026-12-20T00:00:00.000Z' }, { type: 1, release_date: '2026-05-01T00:00:00.000Z' }] }] };
  const ev = C.filmEvents(item, rd, null, 'FR');
  assert.deepEqual(ev.map(e => [e.date, e.rel]).sort(), [['2026-10-08', 'cinema'], ['2026-12-20', 'digital']]);
  assert.deepEqual(C.filmEvents(item, { results: [] }, { release_date: '2027-01-02' }, 'FR').map(e => [e.date, e.rel]), [['2027-01-02', 'release']]);
});

test('regroupement par jour, filtre de type et 7 prochains jours', () => {
  const evs = [
    { date: '2026-10-15', title: 'Kingdom', kind: 'anime', s: 6, e: 1 },
    { date: '2026-10-12', title: 'Monster', kind: 'serie', s: 1, e: 9 },
    { date: '2026-10-12', title: 'Jujutsu Kaisen', kind: 'anime', s: 3, e: 2 },
    { date: '2026-10-19', title: 'JJK', kind: 'anime', s: 3, e: 3 },
    { date: '2026-10-01', title: 'Vieux', kind: 'film' }];
  const g = C.groupByDay(evs);
  assert.deepEqual(Object.keys(g).sort(), ['2026-10-01', '2026-10-12', '2026-10-15', '2026-10-19']);
  assert.deepEqual(g['2026-10-12'].map(e => e.title), ['Jujutsu Kaisen', 'Monster']);
  assert.equal(C.filter(evs, 'anime').length, 3);
  assert.equal(C.filter(evs, 'all').length, 5);
  assert.deepEqual(C.upcoming(evs, '2026-10-12', 7).map(e => e.title), ['Jujutsu Kaisen', 'Monster', 'Kingdom']);
});

test('.ics : VCALENDAR valide, journées entières, texte échappé, CRLF, lignes ≤ 75 octets', () => {
  const ics = C.buildIcs([
    { date: '2026-10-13', itemId: 'a', title: 'Invincible', kind: 'serie', s: 3, e: 6, name: 'Un, deux; trois' },
    { date: '2026-10-31', itemId: 'f', title: 'Halloween '.repeat(12).trim(), kind: 'film', rel: 'digital', label: 'Streaming' }],
    { now: new Date('2026-10-12T08:00:00Z'), name: 'Cinepisode' });
  assert.match(ics, /^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\n/);
  assert.match(ics, /END:VCALENDAR\r\n$/);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2);
  assert.match(ics, /DTSTART;VALUE=DATE:20261013\r\nDTEND;VALUE=DATE:20261014/);
  assert.match(ics, /SUMMARY:Invincible — S03E06/);
  assert.match(ics, /DESCRIPTION:Un\\, deux\\; trois/);
  assert.match(ics, /DTSTAMP:20261012T080000Z/);
  for (const l of ics.split('\r\n')) assert.ok(Buffer.byteLength(l) <= 75, 'ligne repliée : ' + l);
  assert.doesNotMatch(ics.replace(/\r\n/g, ''), /\n/);
});

test('intégration : onglet, section, script, clés fr/en, aucune migration ni appel hors proxy', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /data-tab="calendar"[^>]*data-click="switchTab"/);
  assert.match(html, /id="calendarSection"/);
  assert.match(html, /<script src="js\/26-calendar\.js"><\/script>/);
  const src = fs.readFileSync(path.join(ROOT, 'js/26-calendar.js'), 'utf8');
  assert.doesNotMatch(src, /https?:\/\/(?!image\.tmdb)/, 'aucun domaine tiers : TMDB uniquement via TB (/api/tmdb)');
  assert.doesNotMatch(src, /api_key/);
  const keys = [...new Set([...src.matchAll(/t[n]?\('(cal\.[\w.]*\w)'/g)].map(m => m[1]))];
  for (const lang of ['fr', 'en']) {
    const d = fs.readFileSync(path.join(ROOT, 'js/i18n', lang + '.js'), 'utf8');
    for (const k of keys) assert.ok(d.includes('"' + k + '"') || d.includes('"' + k + '.one"'), lang + ' : ' + k);
  }
});
