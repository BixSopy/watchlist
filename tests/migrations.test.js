'use strict';
/*
 * Migrations SQL rejouées sur un Postgres local jetable (scripts/test-migrations.sh).
 * Ignoré si Postgres n'est pas installé sur la machine.
 * Lancer : node --test tests/
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const hasPg = spawnSync('sh', ['-c', 'command -v initdb || ls /usr/lib/postgresql/*/bin/initdb'], { stdio: 'pipe' }).status === 0;

test('migrations Supabase : idempotentes, droits et garde-fous vérifiés', { skip: !hasPg && 'Postgres non installé' }, () => {
  const r = spawnSync('bash', [path.join(__dirname, '..', 'scripts', 'test-migrations.sh')], { encoding: 'utf8', timeout: 120000 });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /Tous les tests SQL sont passés/);
  assert.doesNotMatch(r.stdout + r.stderr, /not ok/);
});

test('schema.sql contient la migration d\'ouverture publique', () => {
  const schema = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8');
  for (const s of ['consume_api_quota', 'delete_my_account', 'api_cache', 'watchlist_items_tailles_check']) assert.ok(schema.includes(s), s);
});
