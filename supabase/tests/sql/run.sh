#!/usr/bin/env bash
# Throwaway PostgreSQL test runner for the Takalex migrations.
#
#   supabase/tests/sql/run.sh <port>
#
# Creates an isolated, temporary PostgreSQL cluster listening only on
# 127.0.0.1:<port> (no Unix socket), applies the Supabase stubs, every
# migration in order and the seed into a template database, then runs every
# suites/*.sql file in its own fresh copy of that template. The cluster and
# its directory are always removed afterwards, including on failure or
# Ctrl-C.
#
# It never connects to the system PostgreSQL or to Supabase: the port must
# be free, must not be 5432 or a Supabase local port, and every connection
# is checked to reach this run's own data directory.
#
# Environment:
#   PG_BIN   PostgreSQL bin directory (default: pg_config --bindir)
#   VERBOSE  1 = print full suite output, not just the summary
#   TMPDIR   where the temporary cluster directory is created
set -euo pipefail

usage() { echo "usage: $0 <port>   (1024-65535, not 5432 or 54320-54329)" >&2; exit 2; }

[[ $# -eq 1 ]] || usage
PORT="$1"
[[ "$PORT" =~ ^[0-9]+$ ]] || usage
(( PORT >= 1024 && PORT <= 65535 )) || usage

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
MIGRATIONS="$REPO/supabase/migrations"
SEED="$REPO/supabase/seed.sql"

# --- port safety ------------------------------------------------------------
if (( PORT == 5432 )); then
  echo "refusing port 5432 (system PostgreSQL)" >&2; exit 2
fi
if (( PORT >= 54320 && PORT <= 54329 )); then
  echo "refusing port $PORT (Supabase local stack range 54320-54329)" >&2; exit 2
fi
# Also refuse any port configured in supabase/config.toml.
if [[ -f "$REPO/supabase/config.toml" ]] &&
   grep -Eq "^[[:space:]]*[a-z_]*port[[:space:]]*=[[:space:]]*${PORT}[[:space:]]*(#.*)?$" \
     "$REPO/supabase/config.toml"; then
  echo "refusing port $PORT (configured in supabase/config.toml)" >&2; exit 2
fi
if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then
  echo "refusing port $PORT: something is already listening on 127.0.0.1:$PORT" >&2; exit 2
fi

# Never let libpq pick up a connection from the environment or a service file.
unset PGHOST PGHOSTADDR PGPORT PGUSER PGDATABASE PGPASSWORD PGPASSFILE \
      PGSERVICE PGSERVICEFILE PGOPTIONS PGSSLMODE PGAPPNAME || true
export PGCONNECT_TIMEOUT=10

# --- PostgreSQL binaries ----------------------------------------------------
# Detect a directory that has the server binaries (initdb, pg_ctl), not just
# client tools: on Debian/Ubuntu `pg_config --bindir` can report /usr/bin,
# which has psql but no initdb. Order: PG_BIN, pg_config --bindir, then the
# newest /usr/lib/postgresql/<version>/bin.
has_server_bins() { [[ -n "$1" && -x "$1/initdb" && -x "$1/pg_ctl" && -x "$1/psql" ]]; }
if [[ -z "${PG_BIN:-}" ]]; then
  if command -v pg_config >/dev/null && has_server_bins "$(pg_config --bindir)"; then
    PG_BIN="$(pg_config --bindir)"
  else
    for candidate in $(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V -r); do
      if has_server_bins "$candidate"; then PG_BIN="$candidate"; break; fi
    done
  fi
fi
has_server_bins "${PG_BIN:-}" ||
  { echo "no PostgreSQL server binaries (initdb, pg_ctl, psql) found (set PG_BIN)" >&2; exit 2; }
echo "using PostgreSQL: $("$PG_BIN/postgres" --version 2>/dev/null || echo "$PG_BIN")"
SHAREDIR="$("$PG_BIN/pg_config" --sharedir 2>/dev/null || true)"
# Debian layout without a per-version pg_config: /usr/lib/postgresql/N/bin
# -> /usr/share/postgresql/N.
if [[ -z "$SHAREDIR" && "$PG_BIN" =~ ^/usr/lib/postgresql/([0-9]+)/bin$ ]]; then
  SHAREDIR="/usr/share/postgresql/${BASH_REMATCH[1]}"
fi
if [[ -n "$SHAREDIR" && ! -f "$SHAREDIR/extension/dblink.control" ]]; then
  echo "the dblink extension (postgresql-contrib) is required" >&2; exit 2
fi

# --- temporary cluster ------------------------------------------------------
WORK="$(mktemp -d "${TMPDIR:-/tmp}/takalex-sqltest.XXXXXX")"
DATA="$WORK/data"
LOG="$WORK/postgres.log"
TOKEN="takalex_sqltest_$$_$RANDOM"
STARTED=0
# Point libpq at files that do not exist, so no ~/.pgpass or service file
# is ever read.
export PGPASSFILE="$WORK/no-pgpass" PGSERVICEFILE="$WORK/no-pg_service.conf"

cleanup() {
  local status=$?
  trap - EXIT INT TERM HUP
  if (( STARTED )) && [[ -f "$DATA/postmaster.pid" ]]; then
    "$PG_BIN/pg_ctl" -D "$DATA" -w -t 120 stop -m fast >/dev/null 2>&1 ||
      "$PG_BIN/pg_ctl" -D "$DATA" -w -t 60 stop -m immediate >/dev/null 2>&1 || true
  fi
  if [[ -f "$DATA/postmaster.pid" ]]; then
    echo "WARNING: cluster in $DATA may still be running" >&2
  else
    (( STARTED )) && echo "throwaway cluster stopped"
    case "$WORK" in
      */takalex-sqltest.*) rm -rf -- "$WORK" ;;
    esac
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

"$PG_BIN/initdb" -D "$DATA" -U postgres --auth=trust -E UTF8 --locale=C \
  --no-instructions >"$WORK/initdb.log" 2>&1 ||
  { cat "$WORK/initdb.log" >&2; exit 1; }

STARTED=1
if ! "$PG_BIN/pg_ctl" -D "$DATA" -l "$LOG" -w -t 120 start -o \
    "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories='' \
     -c cluster_name=$TOKEN -c fsync=off -c synchronous_commit=off \
     -c full_page_writes=off" >/dev/null; then
  echo "could not start the throwaway cluster:" >&2; tail -20 "$LOG" >&2; exit 1
fi

P() {
  "$PG_BIN/psql" -X -q -h 127.0.0.1 -p "$PORT" -U postgres "$@"
}

# Prove we are talking to this run's cluster, not something else.
ACTUAL="$(P -d postgres -At -c "SELECT current_setting('cluster_name') || '|' || current_setting('data_directory')")"
if [[ "$ACTUAL" != "$TOKEN|$DATA" ]]; then
  echo "connected to an unexpected server ($ACTUAL); aborting" >&2; exit 1
fi

# --- template database ------------------------------------------------------
echo "building template: stubs, migrations, seed, helpers"
P -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE takalex_template"
T() { P -d takalex_template -v ON_ERROR_STOP=1 "$@"; }

T -f "$HERE/lib/00_supabase_stubs.sql"

# PostGIS shim (test harness only; the migration file is not changed):
# PostGIS is not available here, so sites.location becomes TEXT and its
# GIST index a btree. Fails loudly if 001 no longer has the expected lines.
M001="$MIGRATIONS/001_initial_schema.sql"
for pattern in 'CREATE EXTENSION IF NOT EXISTS postgis' \
               'extensions.geography(POINT, 4326)' 'USING GIST (location)'; do
  grep -qF "$pattern" "$M001" ||
    { echo "PostGIS shim out of date: '$pattern' not found in 001" >&2; exit 1; }
done
SHIMMED="$WORK/001_shimmed.sql"
sed -e '/CREATE EXTENSION IF NOT EXISTS postgis/d' \
    -e 's/extensions\.geography(POINT, 4326)/TEXT/' \
    -e 's/USING GIST (location)/(location)/' "$M001" >"$SHIMMED"
if grep -qiE 'postgis|geography|gist' "$SHIMMED"; then
  echo "PostGIS shim incomplete" >&2; exit 1
fi
T -f "$SHIMMED"

# Every other migration, in file-name order (as the Supabase CLI applies them).
shopt -s nullglob
MIGRATION_FILES=("$MIGRATIONS"/[0-9][0-9][0-9]_*.sql)
shopt -u nullglob
[[ "$(basename "${MIGRATION_FILES[0]:-}")" == 001_initial_schema.sql ]] ||
  { echo "expected 001_initial_schema.sql to be the first migration" >&2; exit 1; }
for m in "${MIGRATION_FILES[@]:1}"; do
  echo "  applying $(basename "$m")"
  T -f "$m"
done
T -f "$SEED"
T -f "$HERE/lib/90_test_helpers.sql"

# --- suites -----------------------------------------------------------------
shopt -s nullglob
SUITES=("$HERE"/suites/*.sql)
(( ${#SUITES[@]} > 0 )) || { echo "no suites found" >&2; exit 1; }

TOTAL_FAILED=0
SUMMARY=()
for suite in "${SUITES[@]}"; do
  name="$(basename "$suite" .sql)"
  db="suite_${name//[^a-zA-Z0-9_]/_}"
  P -d postgres -v ON_ERROR_STOP=1 \
    -c "CREATE DATABASE \"$db\" TEMPLATE takalex_template" >/dev/null
  out="$WORK/$name.out"
  set +e
  P -d "$db" -v VERBOSITY=terse -v seed_file="$SEED" \
    -v sites_file="$MIGRATIONS/005_sites.sql" -f "$suite" >"$out" 2>&1
  psql_status=$?
  set -e
  planned=$(grep -c 'PERFORM t\.pass(' "$suite" || true)
  passed=$(grep -c 'NOTICE:  PASS: ' "$out" || true)
  errors=$(grep -cE '^psql:[^ ]*: (ERROR|FATAL):' "$out" || true)
  failed=$(( planned - passed ))
  (( failed < 0 )) && failed=0
  if (( errors > 0 && failed == 0 )); then failed=$errors; fi
  if (( psql_status != 0 && failed == 0 )); then failed=1; fi

  if [[ "${VERBOSE:-0}" == 1 ]]; then
    sed -E 's/^psql:[^ ]+ NOTICE:  //' "$out"
  fi
  if (( failed > 0 )); then
    echo "---- $name: failures ----"
    grep -E '^psql:[^ ]*: (ERROR|FATAL):' "$out" | sed -E 's/^psql:[^:]*\///' || true
  fi
  line="$(printf '%-32s %3d passed, %3d failed (%d planned)' "$name" "$passed" "$failed" "$planned")"
  SUMMARY+=("$line")
  TOTAL_FAILED=$(( TOTAL_FAILED + failed ))
done

echo
echo "==== results ===="
printf '%s\n' "${SUMMARY[@]}"
if (( TOTAL_FAILED > 0 )); then
  echo "FAILED: $TOTAL_FAILED test(s)"
  exit 1
fi
echo "all suites passed"
