#!/usr/bin/env bash
# Monte une base de test neuve : éléments Supabase simulés, structure
# (supabase/schema.sql), migrations, puis cartes synthétiques neutres.
# Usage : PGURL=postgres://postgres@127.0.0.1:5432 tests/db/setup.sh [nom_base]
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
DB=${1:-protocol_test}
PGURL=${PGURL:-postgres://postgres@127.0.0.1:5432}
PSQL=(psql -X -q -v ON_ERROR_STOP=1)

"${PSQL[@]}" "$PGURL/postgres" -c "drop database if exists $DB" -c "create database $DB"

# les rôles sont globaux au serveur : ne les créer qu'une fois
if ! "${PSQL[@]}" "$PGURL/postgres" -tAc "select 1 from pg_roles where rolname='authenticated'" | grep -q 1; then
  "${PSQL[@]}" "$PGURL/postgres" -f "$ROOT/tests/db/roles.sql"
fi

"${PSQL[@]}" "$PGURL/$DB" -f "$ROOT/tests/db/prelude.sql"

# extensions propres à l'hébergement Supabase, absentes d'un Postgres
# standard ; droit MAINTAIN inconnu avant Postgres 17 (Supabase : 17)
SKIP='EXTENSION IF NOT EXISTS "(pg_stat_statements|supabase_vault)"'
if [ "$("${PSQL[@]}" "$PGURL/$DB" -tAc 'show server_version_num')" -lt 170000 ]; then
  SKIP="$SKIP|^GRANT MAINTAIN "
fi
grep -vE "$SKIP" "$ROOT/supabase/schema.sql" | "${PSQL[@]}" "$PGURL/$DB" -f -

for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "migration $(basename "$f")"
  "${PSQL[@]}" "$PGURL/$DB" -f "$f"
done

"${PSQL[@]}" "$PGURL/$DB" -f "$ROOT/tests/db/seed.sql"
echo "base $DB prête"
