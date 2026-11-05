#!/usr/bin/env bash
# PostgREST smoke tests against the LOCAL Supabase stack only.
#
#   supabase/tests/local-stack/smoke.sh
#
# Reads the API URL, DB URL, publishable and secret keys at runtime from
# `supabase status -o env`. Keys and the DB password are never printed and
# never appear on a command line (keys reach curl through a config on stdin;
# the DB password reaches psql through its environment). curl ignores
# ~/.curlrc and every proxy setting. Refuses to run unless both URLs point at
# 127.0.0.1. Deletes every row it inserted on exit, including on failure or
# Ctrl-C. Exits non-zero if any check fails.
set -euo pipefail

command -v supabase >/dev/null || { echo "supabase CLI not found" >&2; exit 2; }
command -v curl >/dev/null || { echo "curl not found" >&2; exit 2; }
command -v psql >/dev/null || { echo "psql not found" >&2; exit 2; }

# Never let libpq pick up a host, port, service or options from the environment.
unset PGHOST PGHOSTADDR PGPORT PGUSER PGDATABASE PGPASSWORD PGPASSFILE \
      PGSERVICE PGSERVICEFILE PGOPTIONS PGSSLMODE PGAPPNAME || true

ENV_OUT="$(supabase status -o env 2>/dev/null)" ||
  { echo "supabase status failed (is the local stack running?)" >&2; exit 2; }
getvar() { printf '%s\n' "$ENV_OUT" | sed -n "s/^$1=\"\(.*\)\"\$/\1/p"; }
API_URL="$(getvar API_URL)"
DB_URL="$(getvar DB_URL)"
PUB_KEY="$(getvar PUBLISHABLE_KEY)"
SEC_KEY="$(getvar SECRET_KEY)"
unset ENV_OUT

# Local only: the host must be exactly 127.0.0.1.
[[ "$API_URL" =~ ^http://127\.0\.0\.1:[0-9]+$ ]] ||
  { echo "refusing: API_URL is not http://127.0.0.1:<port>" >&2; exit 2; }
# Anchored at both ends: no query string (e.g. ?host=) can redirect psql.
DB_RE='^postgres(ql)?://([^:@/?#]+):([^@/?#]+)@127\.0\.0\.1:([0-9]+)/([A-Za-z0-9_]+)$'
[[ "$DB_URL" =~ $DB_RE ]] ||
  { echo "refusing: DB_URL is not postgresql://user:pass@127.0.0.1:<port>/<db>" >&2; exit 2; }
DB_USER="${BASH_REMATCH[2]}" DB_PASS="${BASH_REMATCH[3]}"
DB_PORT="${BASH_REMATCH[4]}" DB_NAME="${BASH_REMATCH[5]}"
unset DB_URL
[[ -n "$PUB_KEY" && -n "$SEC_KEY" ]] ||
  { echo "publishable or secret key missing from supabase status" >&2; exit 2; }

# psql against the local DB. Connection details go through the child's
# environment only, never its argument list.
pg() {
  PGHOST=127.0.0.1 PGPORT="$DB_PORT" PGUSER="$DB_USER" PGPASSWORD="$DB_PASS" \
  PGDATABASE="$DB_NAME" psql -X -q -At -v ON_ERROR_STOP=1 "$@"
}

REST="$API_URL/rest/v1"
RUN_ID="$(date +%s)-$$-$RANDOM"
EMAIL="smoke-$RUN_ID@example.test"           # every row this run inserts
EMAIL_STATUS="smoke-status-$RUN_ID@example.test"
BODY="$(mktemp "${TMPDIR:-/tmp}/takalex-smoke.XXXXXX")"
FAILED=0

cleanup() {
  local status=$?
  trap - EXIT INT TERM HUP
  local n
  n="$(pg -v e1="$EMAIL" -v e2="$EMAIL_STATUS" 2>&1 <<'SQL'
WITH d AS (DELETE FROM public.access_requests WHERE email IN (:'e1', :'e2') RETURNING 1)
SELECT count(*) FROM d;
SQL
  )" || { echo "CLEANUP FAILED: $n" >&2; status=1; }
  [[ "$n" =~ ^[0-9]+$ ]] && echo "cleanup: deleted $n test row(s)"
  rm -f -- "$BODY"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

# check <label> <key> <method> <path> <expected status> <expected body regex|""> [json body] [Prefer]
check() {
  local label="$1" key="$2" method="$3" path="$4" want="$5" want_body="$6"
  local data="${7:-}" prefer="${8:-}"
  local args=(-s -o "$BODY" -w '%{http_code}' -X "$method" "$REST/$path"
              -H "Content-Type: application/json")
  [[ -n "$prefer" ]] && args+=(-H "Prefer: $prefer")
  [[ -n "$data" ]] && args+=(--data-raw "$data")
  local code
  # -q (must be first): ignore ~/.curlrc. --noproxy '*': never send the key to a proxy.
  code="$(printf 'header = "apikey: %s"\n' "$key" |
          curl -q --noproxy '*' -K - "${args[@]}")" || code="curl-error"
  local body; body="$(cat "$BODY")"
  local ok=1
  [[ "$code" == "$want" ]] || ok=0
  if [[ -n "$want_body" ]] && ! grep -Eq -- "$want_body" <<<"$body"; then ok=0; fi
  if (( ok )); then
    printf 'PASS  %-55s HTTP %s\n' "$label" "$code"
  else
    printf 'FAIL  %-55s HTTP %s (expected %s)\n      body: %s\n' "$label" "$code" "$want" "$body"
    FAILED=$((FAILED + 1))
  fi
}

DENIED='"code":"42501"'

echo "local stack: $API_URL"
check "anon: insert access request (return=minimal)" "$PUB_KEY" POST access_requests 201 '^$' \
  "{\"full_name\":\"Smoke Test\",\"email\":\"$EMAIL\",\"role\":\"collector\",\"site_name\":\"Smoke site\"}" \
  "return=minimal"
check "anon: select access_requests denied" "$PUB_KEY" GET "access_requests?select=id" 401 "$DENIED"
check "anon: insert that sets status denied" "$PUB_KEY" POST access_requests 401 "$DENIED" \
  "{\"full_name\":\"Smoke Status\",\"email\":\"$EMAIL_STATUS\",\"status\":\"approved\"}" \
  "return=minimal"
check "anon: rpc/review_collection denied" "$PUB_KEY" POST rpc/review_collection 401 "$DENIED" \
  '{"p_collection_id":"00000000-0000-0000-0000-000000000000","p_approved":true,"p_verified_items":[{"material_code":"PET","weight_kg":1}],"p_rejection_reason":null}'
check "anon: rpc/bootstrap_first_admin denied" "$PUB_KEY" POST rpc/bootstrap_first_admin 401 "$DENIED" \
  "{\"p_email\":\"$EMAIL\"}"
# limit=0: if this denial ever regresses, the failure output contains no hashes.
check "service_role: invitations?select=code_hash denied" "$SEC_KEY" GET "invitations?select=code_hash&limit=0" 403 "$DENIED"
check "service_role: invitations?select=id,status allowed" "$SEC_KEY" GET "invitations?select=id,status" 200 '^\['
check "service_role: rpc/verify_invitation_code junk -> generic failure" "$SEC_KEY" POST rpc/verify_invitation_code 200 \
  '^\[\{"is_valid":false,"invitation_id":null,"auth_user_id":null\}\]$' \
  "{\"p_email\":\"nobody-$RUN_ID@example.test\",\"p_code_hash\":\"junk\"}"

# The insert must have landed exactly once, with server defaults.
ROW="$(pg -v e1="$EMAIL" -v e2="$EMAIL_STATUS" <<'SQL'
SELECT (SELECT count(*) FROM public.access_requests WHERE email = :'e1') || ' ' ||
       COALESCE((SELECT status::text || '/' || (reviewed_by IS NULL)::text
                 FROM public.access_requests WHERE email = :'e1'), '-') || ' ' ||
       (SELECT count(*) FROM public.access_requests WHERE email = :'e2');
SQL
)"
if [[ "$ROW" == "1 submitted/true 0" ]]; then
  printf 'PASS  %-55s %s\n' "db: one submitted row, no status-override row" "$ROW"
else
  printf 'FAIL  %-55s %s (expected "1 submitted/true 0")\n' "db: one submitted row, no status-override row" "$ROW"
  FAILED=$((FAILED + 1))
fi

echo
if (( FAILED > 0 )); then echo "FAILED: $FAILED check(s)"; exit 1; fi
echo "all smoke checks passed"
