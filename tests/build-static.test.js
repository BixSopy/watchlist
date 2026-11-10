'use strict';
/* Build de déploiement (scripts/build-static.mjs) : minifie js/ et css/, ne touche pas à /vendor/ (SRI),
   ne déploie jamais un fichier cassé. Les sources du dépôt restent non minifiées. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'dist-site');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('vercel.json : build statique minifié, publié depuis dist-site', () => {
  const v = JSON.parse(read('vercel.json'));
  assert.strictEqual(v.buildCommand, 'node scripts/build-static.mjs');
  assert.strictEqual(v.outputDirectory, 'dist-site');
  /* le script de build doit être envoyé à Vercel (.vercelignore ne doit pas l'exclure : cause du premier échec de PR #143) */
  assert.doesNotMatch(read('.vercelignore'), /^scripts\/?$/m);
  assert.doesNotMatch(read('.vercelignore'), /build-static/);
  assert.match(read('.gitignore'), /^dist-site$/m);
  assert.match(read('.gitignore'), /^node_modules\/$/m);
});

test('build-static : fichiers minifiés valides, vendor identique, sources intactes', () => {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-static.mjs')], {stdio: 'pipe'});
  for (const f of ['index.html', 'landing/landing.css', 'css/app.css', 'sw.js', 'manifest.json', 'robots.txt', 'fonts/fonts.css', 'js/00-landing-gate.js'])
    assert.ok(fs.existsSync(path.join(OUT, f)), f + ' publié');
  /* /vendor/ : octet pour octet (intégrité SRI dans index.html) */
  for (const f of fs.readdirSync(path.join(ROOT, 'vendor')))
    assert.ok(fs.readFileSync(path.join(ROOT, 'vendor', f)).equals(fs.readFileSync(path.join(OUT, 'vendor', f))), 'vendor/' + f + ' inchangé');
  /* chaque script minifié est plus petit et se compile encore */
  let gain = 0;
  const files = [...fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js')).map(f => 'js/' + f),
                 ...fs.readdirSync(path.join(ROOT, 'js', 'i18n')).map(f => 'js/i18n/' + f)];
  for (const f of files) {
    const a = read(f), b = fs.readFileSync(path.join(OUT, f), 'utf8');
    assert.ok(b.length <= a.length, f);
    new vm.Script(b, {filename: f});
    gain += a.length - b.length;
  }
  assert.ok(gain > 100000, 'le build minifie réellement les scripts (gain ' + gain + ')');
  assert.ok(fs.statSync(path.join(OUT, 'css/app.css')).size < fs.statSync(path.join(ROOT, 'css/app.css')).size);
  /* les fonctions globales partagées entre scripts ne sont pas renommées (pas de renommage d'identifiants) */
  assert.match(fs.readFileSync(path.join(OUT, 'js/18-bootstrap.js'), 'utf8'), /function _bootApp\(/);
  assert.match(fs.readFileSync(path.join(OUT, 'js/23-landing.js'), 'utf8'), /function lpShowAuth\(/);
  /* sources du dépôt non minifiées */
  assert.ok(read('js/18-bootstrap.js').split('\n').length > 100);
  fs.rmSync(OUT, {recursive: true, force: true});
});

test('empreintes : chaque script/feuille locale des pages a ?v=<sha256 du fichier publié>, cache immuable seulement avec ?v=', () => {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-static.mjs')], {stdio: 'pipe'});
  const crypto = require('node:crypto');
  for (const page of ['index.html', 'privacy.html', 'conditions.html']) {
    const html = fs.readFileSync(path.join(OUT, page), 'utf8');
    const refs = [...html.matchAll(/<(?:script|link)\b[^>]*?\s(?:src|href)="(\/?(?:js|css|landing|fonts)\/[^"]+\.(?:js|css)(?:\?[^"]*)?)"/g)].map(m => m[1]);
    assert.ok(refs.length > 0, page);
    for (const ref of refs) {
      const m = /^(\/?[^?]+)\?v=([0-9a-f]{10})$/.exec(ref);
      assert.ok(m, page + ' : ' + ref + ' sans empreinte');
      const sum = crypto.createHash('sha256').update(fs.readFileSync(path.join(OUT, m[1].replace(/^\//, '')))).digest('hex').slice(0, 10);
      assert.strictEqual(m[2], sum, ref + ' : empreinte du fichier publié');
    }
    assert.doesNotMatch(html, /vendor\/[^"]+\?v=/, 'vendor/ : version déjà dans le nom (SRI)');
  }
  assert.doesNotMatch(read('index.html'), /\?v=/, 'source non modifiée');
  const headers = JSON.parse(read('vercel.json')).headers;
  for (const dir of ['js', 'css', 'landing', 'fonts']) {
    const r = headers.find(h => h.source === '/' + dir + '/(.*)' && h.has);
    assert.ok(r, dir);
    assert.deepStrictEqual(r.has, [{type: 'query', key: 'v'}]);
    assert.match(r.headers.find(h => h.key === 'Cache-Control').value, /max-age=31536000, immutable/);
  }
  assert.ok(!headers.some(h => /^\/(js|css)\//.test(h.source) && !h.has), 'sans ?v= : pas de cache long sur js/css');
  const fonts = headers.find(h => h.source === '/fonts/(.*)' && !h.has);
  assert.deepStrictEqual(fonts.missing, [{type: 'query', key: 'v'}]);
  assert.strictEqual(headers.find(h => h.source === '/sw.js').headers[0].value, 'no-cache');
});
