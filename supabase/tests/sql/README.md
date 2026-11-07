# SQL tests (temporary PostgreSQL stand-in)

These tests check the database rules in `supabase/migrations` against a
**throwaway plain PostgreSQL cluster**. They are a stopgap until pgTAP tests
can run against the real Supabase stack (`supabase start` + `supabase test db`).
At that point these suites should be ported to pgTAP and this harness removed.

## Run

```bash
supabase/tests/sql/run.sh 55432        # any free port, see below
VERBOSE=1 supabase/tests/sql/run.sh 55432   # also print every PASS line
```

Requirements: PostgreSQL server binaries (`initdb`, `pg_ctl`, `psql`) and the
`dblink` extension (`postgresql-contrib`). Set `PG_BIN` if the binaries are not
found via `pg_config --bindir`. Tested with PostgreSQL 14.

`run.sh`:

1. Refuses port 5432, the Supabase local range 54320–54329, any port in
   `supabase/config.toml`, and any port something is already listening on.
2. Creates a temporary cluster (`mktemp -d`, honours `TMPDIR`) listening only
   on `127.0.0.1:<port>` with no Unix socket, then verifies that it is talking
   to that cluster (`cluster_name` + `data_directory`) before doing anything.
3. Builds a template database: `lib/00_supabase_stubs.sql`, every migration
   in file-name order (001 through the PostGIS shim below), `seed.sql`,
   `lib/90_test_helpers.sql` (which also creates the test-only
   `FIXTURE Site 1`–`9` rows that the suites use via `t.site(n)`).
4. Runs every `suites/*.sql` in its own fresh copy of the template and prints
   passed/failed counts per suite.
5. Stops the cluster and deletes the temporary directory on exit, failure,
   Ctrl-C or `kill`.

It never connects to the system PostgreSQL or to Supabase, never uses Docker,
and never touches a remote project.

## Suites

| Suite | Covers |
|---|---|
| `10_access_requests` | anon submission, column grants, validation, site rules (`site_id`), `public_site_options()`, admin review rights, reviewer trigger |
| `20_collections` | insert integrity, offline idempotency, `review_collection()`, payout eligibility, finality, audit events, RLS reads, evidence rows (exact path, stored object, active collector) |
| `30_bootstrap_and_seed` | the 8 real sites (005) and their idempotency, empty seed, `bootstrap_first_admin()` eligibility, concurrency, permissions |
| `40_invitations` | register, verify, failed attempts, lockout, expiry, consume (Auth checks), reissue, revoke (audit), constraints, permissions |
| `50_invitations_concurrency` | concurrent register / reissue / verify / consume / revoke |
| `60_privileges` | exact grant and EXECUTE matrix for every table and function in `public`, ACLs, ownership, RLS, default privileges |
| `70_evidence_storage` | the `collection-evidence` bucket row and the RLS policies on `storage.objects` (against the storage stub) |

Writing a test: one top-level `DO` block per test, ending in
`PERFORM t.pass('description');`. The runner counts `t.pass(` calls in the
file as the plan and `PASS` notices as passes, so a test that errors or never
runs is reported as failed.

Concurrency tests are deterministic: one session takes a real lock inside an
open transaction, and a second session (dblink) is either refused by
`lock_timeout` or observed blocked through `pg_blocking_pids()` before the
first session commits. No test result depends on sleep timing.

## Differences from Supabase (what this does NOT prove)

- **Stubs, not Supabase.** `auth.users` has only the columns the migrations
  use; `auth.uid()` reads `request.jwt.claim.sub`/`request.jwt.claims` like
  Supabase's. No GoTrue, PostgREST, Storage, Realtime or Edge Functions.
  Roles are simulated with `SET ROLE`, not real JWTs through PostgREST.
- **Storage stub.** `storage.buckets` and `storage.objects` are minimal
  tables, so the real RLS policies from 006 are evaluated by PostgreSQL, but
  the Storage API is not: MIME and size limits, signed URLs, upsert, move
  and delete behaviour are tested only in `../local-stack/functions.mjs`.
- **Privileges are worst case.** The stubs grant ALL on new tables and
  functions in `public` to `anon`, `authenticated` and `service_role` by
  default (classic Supabase automatic exposure), so only explicit REVOKEs
  protect anything. The real project has automatic table exposure disabled,
  so `service_role` table access there may be narrower than here.
- **PostGIS shim.** PostGIS is not installed, so `sites.location` is created
  as `TEXT` with a btree index instead of `geography(POINT, 4326)` with GIST.
  Geometry validation, SRID handling and spatial queries are not tested
  (the real sites have no coordinates yet).
- **PostgreSQL version.** Runs on whatever local server is installed (14
  here); the Supabase project may run a newer major version.
