# Local Supabase stack checks

Checks that run against the **local** Supabase stack (`supabase start`,
API on `127.0.0.1:54321`, DB on `127.0.0.1:54322`), with real Supabase roles,
default privileges and PostgREST. They complement the stand-in suites in
`../sql/`, which use a throwaway plain PostgreSQL cluster.

Never point these at the remote project. Neither file uses `--linked`.

## catalog.sql: privilege matrix report (read-only)

```bash
DB_URL="$(supabase status -o env | sed -n 's/^DB_URL="\(.*\)"$/\1/p')"
[[ "$DB_URL" == *@127.0.0.1:* ]] && psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f supabase/tests/local-stack/catalog.sql
```

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
  at runtime. Keys are never printed or put on a command line.
- Refuses to run unless the API and DB URLs are on `127.0.0.1`.
- Checks anon access_request insert, select and status override; anon
  `review_collection` and `bootstrap_first_admin`; service_role `code_hash`
  denial, other invitation columns, and `verify_invitation_code` with junk
  input.
- Deletes the rows it inserted (unique per-run email) on exit, including on
  failure.
- Exits non-zero if any check fails.

Requires `supabase`, `curl` and `psql`.
