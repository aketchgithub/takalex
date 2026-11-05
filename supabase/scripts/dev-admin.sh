#!/usr/bin/env bash
# Create the first administrator on the LOCAL Supabase stack (dev bootstrap).
#
#   supabase/scripts/dev-admin.sh
#
# Prompts for the admin email and password (password hidden, entered twice);
# never takes them as arguments. Creates the Auth user through the local
# Admin API with email_confirm: true, then promotes it with
# public.bootstrap_first_admin() through psql as the database owner.
#
# Safety, as in supabase/tests/local-stack/smoke.sh:
# - URLs and keys come from `supabase status -o env` at runtime; refuses unless
#   the API URL is http://127.0.0.1:<port> and the DB URL is exactly
#   postgresql://user:pass@127.0.0.1:<port>/<db> (anchored).
# - curl ignores ~/.curlrc (-q) and every proxy (--noproxy '*'). Keys reach
#   curl through a config on stdin; the request body (with the password)
#   through a pipe on fd 3. The DB password reaches psql through its
#   environment. Nothing secret is printed or put on a command line.
# - If any admin profile already exists, it says so and exits 0 without
#   creating anything.
# - If promotion fails after this script created the Auth user, that user is
#   deleted again.
set -euo pipefail

command -v supabase >/dev/null || { echo "supabase CLI not found" >&2; exit 2; }
command -v curl >/dev/null || { echo "curl not found" >&2; exit 2; }
command -v psql >/dev/null || { echo "psql not found" >&2; exit 2; }
command -v python3 >/dev/null || { echo "python3 not found" >&2; exit 2; }

unset PGHOST PGHOSTADDR PGPORT PGUSER PGDATABASE PGPASSWORD PGPASSFILE \
      PGSERVICE PGSERVICEFILE PGOPTIONS PGSSLMODE PGAPPNAME || true

ENV_OUT="$(supabase status -o env 2>/dev/null)" ||
  { echo "supabase status failed (is the local stack running?)" >&2; exit 2; }
getvar() { printf '%s\n' "$ENV_OUT" | sed -n "s/^$1=\"\(.*\)\"\$/\1/p"; }
API_URL="$(getvar API_URL)"
DB_URL="$(getvar DB_URL)"
SR_KEY="$(getvar SERVICE_ROLE_KEY)"
unset ENV_OUT

[[ "$API_URL" =~ ^http://127\.0\.0\.1:[0-9]+$ ]] ||
  { echo "refusing: API_URL is not http://127.0.0.1:<port>" >&2; exit 2; }
DB_RE='^postgres(ql)?://([^:@/?#]+):([^@/?#]+)@127\.0\.0\.1:([0-9]+)/([A-Za-z0-9_]+)$'
[[ "$DB_URL" =~ $DB_RE ]] ||
  { echo "refusing: DB_URL is not postgresql://user:pass@127.0.0.1:<port>/<db>" >&2; exit 2; }
DB_USER="${BASH_REMATCH[2]}" DB_PASS="${BASH_REMATCH[3]}"
DB_PORT="${BASH_REMATCH[4]}" DB_NAME="${BASH_REMATCH[5]}"
unset DB_URL
[[ -n "$SR_KEY" ]] || { echo "service role key missing from supabase status" >&2; exit 2; }

pg() {
  PGHOST=127.0.0.1 PGPORT="$DB_PORT" PGUSER="$DB_USER" PGPASSWORD="$DB_PASS" \
  PGDATABASE="$DB_NAME" psql -X -q -At -v ON_ERROR_STOP=1 "$@"
}

# admin_api <method> <path> <out file> [body fd]: prints the HTTP status.
admin_api() {
  local method="$1" path="$2" out="$3" body="${4:-}"
  local args=(-s -o "$out" -w '%{http_code}' -X "$method" "$API_URL/auth/v1/admin/$path"
              -H "Content-Type: application/json")
  [[ -n "$body" ]] && args+=(--data-binary "@$body")
  printf 'header = "apikey: %s"\nheader = "Authorization: Bearer %s"\n' "$SR_KEY" "$SR_KEY" |
    curl -q --noproxy '*' -K - "${args[@]}" || echo "curl-error"
}

json_field() { # json_field <file> <key>: top-level string field, or empty
  python3 -I -c 'import json,sys
try: v = json.load(open(sys.argv[1])).get(sys.argv[2])
except Exception: v = None
print(v if isinstance(v, str) else "")' "$1" "$2"
}

echo "local stack: $API_URL"

if [[ "$(pg -c "SELECT EXISTS (SELECT 1 FROM public.profiles WHERE role = 'admin')")" == "t" ]]; then
  echo "An administrator already exists on the local stack; nothing to do."
  exit 0
fi

read -r -p "Admin email: " ADMIN_EMAIL
ADMIN_EMAIL="$(printf '%s' "$ADMIN_EMAIL" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
[[ "$ADMIN_EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] ||
  { echo "That is not a valid email address." >&2; exit 2; }

read -r -s -p "Admin password (min 8 characters): " ADMIN_PASSWORD; echo
(( ${#ADMIN_PASSWORD} >= 8 )) || { echo "Password must be at least 8 characters." >&2; exit 2; }
read -r -s -p "Repeat password: " ADMIN_PASSWORD2; echo
[[ "$ADMIN_PASSWORD" == "$ADMIN_PASSWORD2" ]] || { echo "Passwords do not match." >&2; exit 2; }
unset ADMIN_PASSWORD2

OUT="$(mktemp "${TMPDIR:-/tmp}/takalex-dev-admin.XXXXXX")"
CREATED_ID=""
PROMOTED=0
cleanup() {
  local status=$?
  trap - EXIT INT TERM HUP
  if [[ -n "$CREATED_ID" && "$PROMOTED" -eq 0 ]]; then
    local code
    code="$(admin_api DELETE "users/$CREATED_ID" "$OUT")"
    if [[ "$code" == "200" ]]; then
      echo "rolled back: deleted the Auth user created by this run"
    else
      echo "WARNING: could not delete Auth user $CREATED_ID (HTTP $code)" >&2
    fi
  fi
  rm -f -- "$OUT"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

# Body built from the environment of python3 only; delivered on fd 3.
CODE="$(admin_api POST users "$OUT" /dev/fd/3 3< <(
  ADMIN_EMAIL="$ADMIN_EMAIL" ADMIN_PASSWORD="$ADMIN_PASSWORD" python3 -I -c '
import json, os
print(json.dumps({"email": os.environ["ADMIN_EMAIL"],
                  "password": os.environ["ADMIN_PASSWORD"],
                  "email_confirm": True,
                  "user_metadata": {"full_name": "Local Dev Admin"}}))'
))"
unset ADMIN_PASSWORD

case "$CODE" in
  200|201)
    CREATED_ID="$(json_field "$OUT" id)"
    [[ "$CREATED_ID" =~ ^[0-9a-f-]{36}$ ]] ||
      { echo "Auth user created but no id was returned." >&2; exit 1; }
    echo "created Auth user $ADMIN_EMAIL (email confirmed)"
    ;;
  422)
    if [[ "$(json_field "$OUT" error_code)" == "email_exists" ]]; then
      echo "An Auth user with this email already exists; promoting it (its password is unchanged)."
    else
      echo "Admin API rejected the user: $(json_field "$OUT" msg)" >&2; exit 1
    fi
    ;;
  *)
    echo "Admin API request failed (HTTP $CODE): $(json_field "$OUT" msg)" >&2; exit 1 ;;
esac

if ADMIN_ID="$(pg -v email="$ADMIN_EMAIL" <<'SQL' 2>&1
SELECT public.bootstrap_first_admin(:'email');
SQL
)"; then
  PROMOTED=1
  echo "promoted $ADMIN_EMAIL to active administrator (profile $ADMIN_ID)"
else
  echo "bootstrap_first_admin failed: ${ADMIN_ID#*ERROR:  }" >&2
  exit 1
fi
