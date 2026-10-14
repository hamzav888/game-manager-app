#!/usr/bin/env bash
# Run the database security tests against a THROWAWAY local Postgres (15+).
# Usage: PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres scripts/test-db.sh
# It creates and drops a database called poker_ledger_test. Never point it at Supabase.
set -euo pipefail
cd "$(dirname "$0")/.."
DB=poker_ledger_test
psql -v ON_ERROR_STOP=1 -q -d postgres <<SQL
do \$\$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end \$\$;
drop database if exists $DB;
create database $DB;
SQL
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/tests/00_supabase_stubs.sql 2>&1 | grep -v -i 'wal_level\|hint' || true
for f in supabase/migrations/*.sql; do psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f"; done
out=$(psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/tests/10_security.sql 2>&1) || { echo "$out" | grep -E 'FAIL|ERROR'; exit 1; }
echo "$out" | grep -c 'PASS' | xargs -I{} echo "{} security checks passed"
psql -q -d postgres -c "drop database $DB"
