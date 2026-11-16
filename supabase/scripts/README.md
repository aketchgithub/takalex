# Local development scripts

Scripts for the **local** Supabase stack only (`supabase start`). None of them
uses `--linked` or can reach the hosted project.

## dev-admin.sh: create the first local administrator

```bash
supabase/scripts/dev-admin.sh
```

Prompts for an email and a password (hidden, entered twice, at least 8
characters), then:

1. Creates the Auth user through the local Admin API with `email_confirm: true`.
2. Promotes it with `public.bootstrap_first_admin()` through psql as the
   database owner.

- If any admin profile already exists it says so and exits 0 without
  prompting or creating anything.
- If an Auth user with that email already exists (for example after an
  interrupted run) it is promoted as is; its password is not changed.
- If promotion fails after the script created the Auth user, that user is
  deleted again.
- Same safety rules as `../tests/local-stack/smoke.sh`: URLs and keys come from
  `supabase status -o env` at runtime; refuses unless the API URL is
  `http://127.0.0.1:<port>` and the DB URL is exactly
  `postgresql://user:pass@127.0.0.1:<port>/<db>`; curl ignores `~/.curlrc` and
  all proxies; keys reach curl through a config on stdin and the password
  through a pipe, never a command line; the DB password reaches psql through
  its environment. Nothing secret is printed.

Requires `supabase`, `curl`, `psql` and `python3` (used only to build the JSON
request body).

On the hosted project, create the first admin as described in
`supabase/migrations/004_admin_bootstrap.sql` instead.
