# Local Supabase stack checks

Checks that run against the **local** Supabase stack (`supabase start`,
API on `127.0.0.1:54321`, DB on `127.0.0.1:54322`), with real Supabase roles,
default privileges and PostgREST. They complement the stand-in suites in
`../sql/`, which use a throwaway plain PostgreSQL cluster.

Never point these at the remote project. Neither file uses `--linked`.

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
