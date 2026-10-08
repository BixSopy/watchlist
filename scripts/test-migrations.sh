#!/usr/bin/env bash
# Teste les migrations Supabase sur un Postgres LOCAL jetable (jamais sur le vrai projet).
# Pré-requis : Postgres 15+ installé (initdb, pg_ctl, psql dans le PATH ou /usr/lib/postgresql/*/bin).
#   bash scripts/test-migrations.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="$(dirname "$(command -v initdb 2>/dev/null || ls -d /usr/lib/postgresql/*/bin/initdb 2>/dev/null | sort -V | tail -1)")"
[ -x "$PGBIN/initdb" ] || { echo "Postgres introuvable (initdb) : test ignoré"; exit 0; }
TMP="$(mktemp -d)"; PORT=$(( 20000 + RANDOM % 20000 ))
cleanup() { "$PGBIN/pg_ctl" -D "$TMP/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT
"$PGBIN/initdb" -D "$TMP/data" -U postgres -A trust >/dev/null
"$PGBIN/pg_ctl" -D "$TMP/data" -o "-p $PORT -k $TMP -c listen_addresses=''" -l "$TMP/log" -w start >/dev/null
export PGOPTIONS="-c client_min_messages=warning"
PSQL=("$PGBIN/psql" -h "$TMP" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X)
"${PSQL[@]}" -f "$ROOT/supabase/tests/00_stub_supabase.sql"
"${PSQL[@]}" -f "$ROOT/supabase/schema.sql"
# Migrations dans l'ordre ; 20260925 et la nouvelle migration sont rejouées deux fois (idempotence).
for f in "$ROOT"/supabase/migrations/20260925*.sql "$ROOT"/supabase/migrations/20260925*.sql \
         "$ROOT"/supabase/migrations/20261008*.sql "$ROOT"/supabase/migrations/20261008*.sql; do
  echo "→ $(basename "$f")"; "${PSQL[@]}" -f "$f" >/dev/null
done
PGOPTIONS="" "${PSQL[@]}" -f "$ROOT/supabase/tests/10_ouverture_publique.test.sql" 2>&1 >/dev/null | sed -E "s/^psql:[^ ]+ NOTICE:  //"
exit "${PIPESTATUS[0]}"
