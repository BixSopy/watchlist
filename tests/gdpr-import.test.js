'use strict';
/* Import RGPD Disney+ / Apple TV (js/27-gdpr-import.js) : lecture des exports (CSV, texte, JSON,
   zip imbriqué), conversion en groupes « Détectés », suivi local de la demande. Fichiers synthétiques
   (tests/fixtures/gdpr) : les vrais formats ne sont pas documentés, voir les commentaires du module.
   Lancer : node --test tests/ */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { GDPR_CORE: G, GDPR_FILES: F } = require('../js/27-gdpr-import.js');
const D = require('../js/21-detected.js');
const ROOT = path.join(__dirname, '..');
const fx = f => fs.readFileSync(path.join(__dirname, 'fixtures/gdpr', f));
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

function zip(files) { /* zip minimal (deflate) pour les tests */
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
const groups = (p, ev) => D.groupRows(G.toRows(ev, G.PLATFORMS[p].source, D.normalizeTitle));

test('Apple : Video Play Activity.csv → séries avec épisode, films, ouvertures et bandes-annonces ignorées', () => {
  const ev = G.parseText('apple', 'Video Play Activity.csv', fx('video-play-activity.csv').toString());
  const titles = ev.map(e => e.title);
  assert.deepStrictEqual(titles, ['Ted Lasso', 'Ted Lasso', 'Severance', 'CODA']);
  assert.deepStrictEqual([ev[2].season, ev[2].episode, ev[2].type], [2, 5, 'show']);
  assert.strictEqual(ev[0].pct, 100);
  const g = groups('apple', ev);
  const ted = g.find(x => x.norm === 'ted lasso');
  assert.deepStrictEqual([ted.progress.season, ted.progress.episode], [1, 4]);
  assert.strictEqual(g.find(x => x.norm === 'coda').kind, 'movie');
  assert.deepStrictEqual(ted.sources, ['apple_gdpr']);
});

test('Disney+ : texte « Titles Watched » (profil retiré, bandes-annonces et favoris ignorés)', () => {
  const ev = G.parseDisneyText(fx('disney-export.txt').toString());
  assert.deepStrictEqual(ev.map(e => e.title), ['The Searchers', '9-1-1', 'Andor', 'Andor', 'Le Roi Lion']);
  assert.deepStrictEqual([ev[3].season, ev[3].episode], [2, 4]);
  assert.ok(!ev.some(e => /Moana/.test(e.title)), 'la liste de favoris n\'est pas un visionnage');
  const g = groups('disney', ev);
  assert.strictEqual(g.length, 4);
});

test('Disney+ : CSV « ; » avec dates JJ/MM/AAAA et JSON', () => {
  const ev = G.parseText('disney', 'export.csv', fx('disney-export.csv').toString());
  assert.deepStrictEqual(ev.map(e => [e.title, e.type, e.season, e.episode]), [['Loki', 'show', 1, 6], ['Encanto', 'movie', null, null]]);
  assert.strictEqual(new Date(ev[0].watchedAt).toISOString().slice(0, 10), '2021-07-14');
  const js = G.parseText('disney', 'x.json', JSON.stringify({ profiles: [{ viewing: [{ title: 'Bluey', dateWatched: '2024-01-01' }, { 'Title': 'Elio', 'Date Watched': '2025-07-01' }] }] }));
  assert.ok(js.some(e => e.title === 'Elio'));
});

test('épisode dans le titre : variantes reconnues', () => {
  assert.deepStrictEqual(G.splitEpisode('Severance S2 E5'), { show: 'Severance', season: 2, episode: 5 });
  assert.deepStrictEqual(G.splitEpisode('Lupin - Saison 3, épisode 2'), { show: 'Lupin', season: 3, episode: 2 });
  assert.deepStrictEqual(G.splitEpisode('Dark s01e08'), { show: 'Dark', season: 1, episode: 8 });
  assert.strictEqual(G.splitEpisode('CODA'), null);
});

test('zip Apple imbriqué (Apple_Media_Services.zip dans l\'archive) lu sans bibliothèque', async () => {
  const inner = zip([['Stores Activity/Other Activity/Video Play Activity.csv', fx('video-play-activity.csv')], ['Apple Music Activity/Play.csv', Buffer.from('a,b\n1,2')]]);
  const outer = zip([['Apple Media Services information/Apple_Media_Services.zip', inner], ['README.txt', Buffer.from('x')]]);
  const acc = await F.collect('apple', 'Apple Media Services information Part 1 of 2.zip', new Uint8Array(outer), 0, { events: [], files: [] });
  assert.strictEqual(acc.events.length, 4);
  assert.ok(acc.files.includes('Video Play Activity.csv'));
  assert.ok(!acc.files.includes('Play.csv'));
});

test('PDF simple : texte extrait (flux compressé) puis lu comme « Titles Watched »', async () => {
  const content = 'BT /F1 12 Tf (Titles Watched) Tj T* (Pierre The Searchers 2023-12-11) Tj T* (Pierre Encanto 2022-01-02) Tj ET';
  const z = zlib.deflateSync(Buffer.from(content, 'latin1'));
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n1 0 obj << /Length ' + z.length + ' /Filter /FlateDecode >>\nstream\n', 'latin1'), z, Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1')]);
  const acc = await F.collect('disney', 'export.pdf', new Uint8Array(pdf), 0, { events: [], files: [] });
  assert.deepStrictEqual(acc.events.map(e => e.title), ['The Searchers', 'Encanto']);
});

test('suivi de la demande : en attente, prêt, rappel une fois par jour, importé', () => {
  const day = 86400000, t0 = Date.UTC(2026, 9, 13);
  assert.strictEqual(G.status({}, 'apple', t0).kind, 'none');
  const st = { requestedAt: t0 };
  const w = G.status(st, 'apple', t0 + 2 * day);
  assert.deepStrictEqual([w.kind, w.daysLeft], ['waiting', 5]);
  assert.strictEqual(G.status(st, 'apple', t0 + 7 * day).kind, 'due');
  assert.strictEqual(G.status(st, 'disney', t0 + 7 * day).kind, 'waiting');
  assert.deepStrictEqual(G.dueReminders({ apple: st }, t0 + 8 * day), ['apple']);
  assert.deepStrictEqual(G.dueReminders({ apple: { ...st, remindedDay: G.dayKey(t0 + 8 * day) } }, t0 + 8 * day), []);
  assert.strictEqual(G.status({ ...st, importedAt: t0 + 9 * day, count: 3 }, 'apple', t0 + 10 * day).kind, 'imported');
});

test('liens officiels, câblage et confidentialité (aucun envoi du fichier)', () => {
  assert.strictEqual(G.PLATFORMS.apple.url, 'https://privacy.apple.com/');
  assert.match(G.PLATFORMS.disney.url, /^https:\/\/privacy\.thewaltdisneycompany\.com\//);
  const html = read('index.html');
  assert.match(html, /<script src="js\/27-gdpr-import\.js"><\/script>/);
  assert.match(html, /id="gdprMbk"/);
  assert.match(html, /prefers-reduced-motion:reduce\)\{\.gd-card/);
  const src = read('js/27-gdpr-import.js');
  assert.doesNotMatch(src, /fetch\(|XMLHttpRequest|sendBeacon|supa\./, 'le fichier n\'est jamais envoyé');
});

test('TV Time Out : tvtime-series-episodes.csv réel (« title » = nom de la série, trakt-web fixture)', () => {
  const csv = 'series_tvdb_id,series_imdb_id,series_uuid,title,season,episode,tvdb_id,is_watched,watched_at,rewatch_count,special\n'
    + '346328,,u0,Elite,1,1,6671792,true,2019-10-04 03:43:42,0,false\n'
    + '346328,,u1,Elite,6,1,9367539,false,,0,false\n'
    + '248736,,u8,Grimm,1,1,4099457,true,2018-07-15 04:59:42,0,false\n';
  const ev = G.tvtimeFinalize(G.parseText('tvtime', 'tvtime-series-episodes.csv', csv));
  assert.deepStrictEqual(ev.map(e => [e.title, e.season, e.episode, e.tvdb]), [['Elite', 1, 1, 346328], ['Grimm', 1, 1, 248736]]);
});
