#!/usr/bin/env bash
# Applies stub + migrations to a fresh database and runs the SQL tests.
# Usage: PSQL_ARGS="-h /tmp -p 54329 -U postgres" supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."
PSQL="psql ${PSQL_ARGS:-} -v ON_ERROR_STOP=1 -q -t"
DB=${TEST_DB:-fin_test}
psql ${PSQL_ARGS:-} -q -c "drop database if exists $DB" -c "create database $DB"
$PSQL -d $DB -f tests/00_supabase_stub.sql
for f in migrations/*.sql; do $PSQL -d $DB -f "$f"; done
# seed must be idempotent
$PSQL -d $DB -f migrations/0003_seed_categories.sql
$PSQL -d $DB -f tests/10_rls_and_constraints.sql 2>&1 | grep -E "NOTICE|ERROR" | sed 's/.*NOTICE:  //'
test "${PIPESTATUS[0]}" = 0 && echo "ALL SQL TESTS PASSED"
