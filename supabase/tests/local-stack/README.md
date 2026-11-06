# Local Supabase stack checks

Checks that run against the **local** Supabase stack (`supabase start`,
API on `127.0.0.1:54321`, DB on `127.0.0.1:54322`), with real Supabase roles,
default privileges and PostgREST. They complement the stand-in suites in
`../sql/`, which use a throwaway plain PostgreSQL cluster.

Never point these at the remote project. None of these files uses `--linked`.

## catalog.sql: privilege matrix report (read-only)

```bash
(
  set -euo pipefail
  unset PGHOST PGHOSTADDR PGPORT PGUSER PGDATABASE PGPASSWORD PGPASSFILE \
        PGSERVICE PGSERVICEFILE PGOPTIONS PGSSLMODE || true
  DB_URL="$(supabase status -o env | sed -n 's/^DB_URL="\(.*\)"$/\1/p')"
  re='^postgres(ql)?://([^:@/?#]+):([^@/?#]+)@127\.0\.0\.1:([0-9]+)/([A-Za-z0-9_]+)$'
  [[ "$DB_URL" =~ $re ]] || { echo "refusing: DB_URL is not local" >&2; exit 2; }
  PGHOST=127.0.0.1 PGPORT="${BASH_REMATCH[4]}" PGUSER="${BASH_REMATCH[2]}" \
  PGPASSWORD="${BASH_REMATCH[3]}" PGDATABASE="${BASH_REMATCH[5]}" \
    psql -X -v ON_ERROR_STOP=1 -f supabase/tests/local-stack/catalog.sql |
    tee /dev/stderr | { ! grep -Eq 'DIFF|NOT IN MATRIX|MISSING (TABLE|FUNCTION)'; }
) && echo "catalog: matrix ok" || echo "catalog: DIFFERENCES (see above)"
```

The DB URL must be exactly `postgresql://user:pass@127.0.0.1:<port>/<db>`
(anchored, so a query string such as `?host=` cannot redirect psql), and the
password reaches psql through its environment, never its argument list. The
subshell exits non-zero if any row is not `ok`.

This prints the effective table, column and function privileges for PUBLIC,
anon, authenticated and service_role, with an `ok` or `DIFF` column compared
against a copy of the matrix in `../sql/suites/60_privileges.sql` (keep the two
in sync). It also reports RLS and ownership, the `sites.location` type, API
role membership, default ACLs and raw ACL anomalies. It runs in a `READ ONLY`
transaction.

## smoke.sh: PostgREST smoke tests

```bash
supabase/tests/local-stack/smoke.sh
```

- Reads the URLs and the publishable and secret keys from `supabase status -o env`
  at runtime. Keys and the DB password are never printed or put on a command
  line (keys go to curl through a config on stdin, the password to psql
  through its environment).
- curl runs with `-q --noproxy '*'`: `~/.curlrc` and proxy variables are
  ignored, so the secret key only ever goes to `127.0.0.1`. libpq `PG*`
  variables are unset first.
- Refuses to run unless the API URL is `http://127.0.0.1:<port>` and the DB URL
  is exactly `postgresql://user:pass@127.0.0.1:<port>/<db>` (anchored; no
  query string).
- Checks anon access_request insert, select and status override; anon
  `review_collection` and `bootstrap_first_admin`; service_role `code_hash`
  denial (with `limit=0`, so a regression cannot print hashes), other
  invitation columns, and `verify_invitation_code` with junk input for a
  per-run email (so no existing invitation's `failed_attempts` changes).
- Deletes the rows it inserted (unique per-run email) on exit, including on
  failure.
- Exits non-zero if any check fails.

Requires `supabase`, `curl` and `psql`.

## functions.mjs: Edge Function checks (invite-user, accept-invitation)

Order matters:

1. **Stack up:** `supabase start` (and `supabase db reset` for a clean seed; it
   needs at least 3 active sites).
2. **Functions served:** in Terminal 1, `supabase functions serve`, left running.
   The script probes `accept-invitation` first and refuses if it does not answer.
3. **Dev admin exists:** `supabase/scripts/dev-admin.sh` (once per reset).

Then, in Terminal 2, from the repo root:

```bash
read -r -s -p "Dev admin password: " DEV_ADMIN_PASSWORD; echo; export DEV_ADMIN_PASSWORD
node supabase/tests/local-stack/functions.mjs
unset DEV_ADMIN_PASSWORD
```

If `DEV_ADMIN_PASSWORD` is unset, the script asks for the password itself
(hidden). It never takes it as an argument. The admin email is looked up in the
database. If several active admins exist, set `DEV_ADMIN_EMAIL` to choose one.
A full run takes a few minutes: each accept-invitation failure is padded to 1.5 s.

What it checks:

- **invite-user callers:** a missing `Authorization` header, a malformed
  token, the anon key and the service role key as bearer all get 401. An active
  collector gets 403 for create and for reissue. None of them creates an Auth
  user.
- **Every role:** collector (two sites), site_manager, recycler with one
  site, recycler with `siteIds` omitted, and recycler with `siteIds: []`. Each
  returns 201 with a well-formed code, a 7-day expiry and `Cache-Control: no-store`.
  Each also leaves an inactive, unconfirmed profile with the right role, a
  trimmed name and exactly the sites sent, plus a pending invitation
  (lowercased email, `invited_by` = the admin). GoTrue stores a random password
  hash at `createUser`, so "no password" is not testable. Instead, the user cannot
  sign in with the code, the normalised code or a random password. The stored
  hash is also unchanged by a duplicate invite, a refused reissue and successful
  reissues.
- **Invalid input:** bad JSON, a non-object body, a missing or unknown action,
  a malformed email, bad names, role `admin` or missing, missing or empty sites
  for collector or site_manager, non-UUID, duplicate or too many site IDs. Each
  gets a specific 400 and creates no Auth user.
- **Registration failure:** an unknown site passes validation, so the Auth
  user is created and the RPC then fails. That user must be deleted again, and
  the email must then be invitable. Inviting the email of an existing invited
  user returns 409 and leaves that user and invitation untouched.
- **Codes stored only as hashes:** every issued code's invitation row holds
  SHA-256 of the normalised code. No plain code (raw or normalised) appears in
  the run's `invitations`, `auth.users`, `auth.identities` or `profiles` rows,
  or in the logs of the edge runtime, Auth, Kong, PostgREST and DB containers.
  No test email appears in the Edge Function logs either.
- **Reissue rules:**
  - A pending, unexpired invitation gets 409 and is unchanged.
  - An unknown ID gets 404; a malformed ID gets 400.
  - An expired invitation is reissued with name, role and sites carried over.
    The old row becomes `superseded` and points at the new one, and its code no
    longer works.
  - A revoked invitation is reissued with overrides. The revocation audit is
    kept, and the role, name and sites are replaced.
  - A collector with `siteIds: []` gets 400; a recycler with no sites is
    allowed. Role `admin` gets 400.
  - A superseded or accepted invitation gets 409.
  - A revoked row for an active user gets 409 ("already active"). For an
    inactive user who has an accepted invitation, it gets 409 ("already
    accepted"); this row is inserted directly, because the API cannot produce
    it.
  - A confirmed but inactive user (left by a failed acceptance) can be
    revoked, reissued and activated.
- **accept-invitation:**
  - Happy path, with the code typed lowercase with spaces.
  - Reuse of an accepted code, and a wrong email.
  - Lockout after 5 wrong codes, with the password unchanged.
  - Expired, revoked and superseded codes.
  - A held claim, and three rounds of two simultaneous accepts (exactly one wins).
  - Specific validation errors.
  - The consume-failure path and its recovery.
  - Every invitation-validity failure is byte-identical and takes at least 1500 ms.

Safety, as in `smoke.sh`:

- URLs and keys are read from `supabase status -o env` at runtime. The script
  refuses unless the API URL is `http://127.0.0.1:<port>` and the DB URL is
  exactly `postgresql://user:pass@127.0.0.1:<port>/<db>` (anchored).
- It refuses if Node is set to use proxy variables (`NODE_USE_ENV_PROXY` or
  `--use-env-proxy`), and fetch never follows redirects.
- libpq `PG*` variables are dropped, and the DB password reaches psql through
  its environment only. `DEV_ADMIN_PASSWORD` is removed from the environment
  before any child process starts.
- Keys, codes, passwords and tokens are never printed or put on a command line.
  Codes and hashes are compared inside the Node process.
- Test users all have emails `fn-<run>-*@example.test`. They are deleted on exit
  (Admin API, falling back to SQL), including on failure or Ctrl-C. The script
  also checks that no test users or invitations are left.
- The dev admin is only signed in as. A fingerprint of its Auth row and profile
  is compared before and after the run.
- Exits 1 if any check fails, and 2 if it refuses to run.

It needs Node 22+ (built-ins only) and the `supabase`, `psql` and `docker` CLIs.
Docker is used for the log scan.
