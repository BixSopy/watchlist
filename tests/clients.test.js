'use strict';
/*
 * Extension navigateur (extension/) et app de bureau (desktop/) : nom Cinepisode, adresse de
 * brand.config.json, textes de l'extension en français et en anglais (_locales).
 * Lancer : node --test tests/
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const brand = JSON.parse(read('brand.config.json'));

test('extension : textes dans _locales/fr et _locales/en, mêmes clés, toutes utilisées existent', () => {
  const manifest = JSON.parse(read('extension/manifest.json'));
  assert.strictEqual(manifest.default_locale, 'en');
  const locales = fs.readdirSync(path.join(ROOT, 'extension/_locales')).sort();
  assert.deepStrictEqual(locales, ['en', 'fr']);
  const msgs = Object.fromEntries(locales.map(l => [l, JSON.parse(read('extension/_locales/' + l + '/messages.json'))]));
  assert.deepStrictEqual(Object.keys(msgs.fr).sort(), Object.keys(msgs.en).sort());
  for (const l of locales) {
    for (const [k, v] of Object.entries(msgs[l])) assert.ok(v.message && v.message.trim(), l + ' ' + k);
    assert.ok(msgs[l].extName.message.length <= 75, l + ' : nom trop long');
    assert.ok(msgs[l].extDescription.message.length <= 132, l + ' : description trop longue (132 max)');
    assert.ok(msgs[l].extName.message.includes(brand.name), l + ' : nom');
  }
  assert.notStrictEqual(msgs.fr.save.message, msgs.en.save.message);
  const used = [
    ...JSON.stringify(manifest).matchAll(/__MSG_(\w+)__/g),
    ...read('extension/options.html').matchAll(/data-msg="(\w+)"/g),
    ...read('extension/options.js').matchAll(/msg\('(\w+)'\)/g),
  ].map(m => m[1]);
  assert.ok(used.length >= 8);
  for (const k of used) assert.ok(msgs.en[k], 'clé absente : ' + k);
  assert.strictEqual(manifest.name, '__MSG_extName__');
  assert.strictEqual(manifest.description, '__MSG_extDescription__');
  assert.strictEqual(manifest.homepage_url, brand.baseUrl);
  /* plus aucun texte d'interface en dur dans la page d'options */
  assert.doesNotMatch(read('extension/options.html').replace(/<!--[\s\S]*?-->/g, ''), /Jeton|Enregistrer|Couverture|Génère/);
});

test('ancien nom et ancienne adresse absents de l\'extension et de l\'app de bureau', () => {
  const files = ['extension/manifest.json', 'extension/options.html', 'extension/options.js', 'extension/README.md',
    'desktop/src-tauri/tauri.conf.json', 'desktop/src-tauri/Cargo.toml', 'desktop/src-tauri/src/main.rs', 'desktop/dist/index.html',
    '.github/workflows/desktop-release.yml'];
  for (const f of files) {
    assert.doesNotMatch(read(f), /Watchlist Cin|vercel\.app/i, f);
  }
});

test('app de bureau : fenêtre et mises à jour sur l\'adresse de brand.config.json', () => {
  const conf = JSON.parse(read('desktop/src-tauri/tauri.conf.json'));
  assert.strictEqual(conf.productName, brand.name);
  assert.strictEqual(conf.app.windows[0].title, brand.name);
  assert.strictEqual(conf.app.windows[0].url, brand.baseUrl);
  assert.deepStrictEqual(conf.plugins.updater.endpoints, [brand.baseUrl + '/api/releases?f=manifest']);
  /* identifiant conservé : le changer casserait la mise à jour des installations existantes */
  assert.strictEqual(conf.identifier, 'com.watchlistcine.app');
  assert.match(read('.github/workflows/desktop-release.yml'), new RegExp("releaseName: '" + brand.name + ' '));
});

test('workflows GitHub : actions épinglées sur un commit, aucune entrée interpolée dans un script', () => {
  for (const f of fs.readdirSync(path.join(ROOT, '.github/workflows'))) {
    const y = read('.github/workflows/' + f);
    for (const m of y.matchAll(/uses:\s*([^\s#]+)/g)) assert.match(m[1], /@[0-9a-f]{40}$/, f + ' : ' + m[1] + ' non épinglée');
    assert.doesNotMatch(y, /pull_request_target/, f);
    assert.match(y, /^permissions:/m, f + ' : permissions explicites');
    /* dans un bloc run:, ${{ … }} serait interprété par le shell (injection) */
    for (const block of y.split(/\n\s*- (?:name|uses):/)) {
      const run = block.split(/\n\s*run: \|/)[1];
      if (run) assert.doesNotMatch(run, /\$\{\{/, f + ' : ${{ }} dans un script run');
    }
  }
});
