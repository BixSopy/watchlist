'use strict';
/* Appairage site -> extension (0.8.0) : garde-fous statiques. Parcours complet : e2e/pairing.test.mjs ;
   base : supabase/tests/60_appairage.test.sql. Lancer : node --test tests/ */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('manifeste : seul le site de production peut parler à l\'extension', () => {
  const m = JSON.parse(read('extension/manifest.json'));
  assert.strictEqual(m.version, '0.8.1');
  assert.deepStrictEqual(m.externally_connectable, { matches: ['https://cinepisode.com/*'] });
  assert.ok(!('key' in m));
});

test('service worker : origine revérifiée, jeton au bon format et validé par le serveur avant d\'être gardé', () => {
  const bg = read('extension/background.js');
  assert.match(bg, /var PAIR_ORIGINS = \['https:\/\/cinepisode\.com'\];/);
  assert.match(bg, /DEVICE_TOKEN_RE = \/\^cpd_\[0-9a-f\]\{64\}\$\//);
  const pair = bg.slice(bg.indexOf('onMessageExternal.addListener'));
  assert.ok(pair.indexOf('pairOriginOk(sender)') < pair.indexOf('wlToken: token'));
  assert.ok(pair.indexOf("'extension_whoami'") < 0 && bg.indexOf("'extension_whoami'") > 0);
  assert.ok(pair.indexOf('whoami(token)') < pair.indexOf('wlToken: token'), 'whoami avant enregistrement');
});

test('site : le jeton ne transite que de la RPC vers l\'extension (ni URL, ni stockage, ni /api)', () => {
  const js = read('js/28-pairing.js').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/localStorage\.setItem\([^)]*token/i.test(js));
  assert.ok(!/\/api\//.test(js));
  assert.ok(!/location\.(href|assign|replace)\s*=?.*token/i.test(js));
  assert.match(js, /chrome\.runtime\.sendMessage\(id,msg/);
  assert.match(js, /OFFICIAL_EXT_IDS\.indexOf\(_pair\.ext\)>=0/, 'extension inconnue : confirmation obligatoire');
  assert.match(js, /revoke_extension_device',\{p_device_id:r\.device_id\}/, 'jeton non remis -> appareil retiré');
});

test('composant « Appareils connectés » autonome : aucune modification des Réglages / du Compte', () => {
  for (const f of ['js/17-settings-menu.js', 'js/20-account.js', 'js/10-settings-core.js']) assert.doesNotMatch(read(f), /renderDevicesPanel|extension_devices/, f);
  assert.match(read('js/28-pairing.js'), /function renderDevicesPanel\(container\)/);
});
