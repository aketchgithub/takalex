# Takalex — project rules for Claude Code

Waste collection tracking and verification MVP for Chemolex (client: Owino Aketch).
Developer: Cynthia Chepkemoi Langat. Four-week, fixed-scope engagement.
Android-first. Stack: Expo + React Native + TypeScript (apps/mobile), Supabase
(Postgres, Auth, Edge Functions, Storage), Expo SQLite for offline, Sentry, GitHub Actions.
Do not introduce another backend or replace the stack without explicit discussion.
The demo brief and confirmed operating model are in docs/demo-plan.md; read it before demo work.

## Hard rules — never break these
- Never run `git push`, `git reset --hard`, `git clean`, `git checkout -- <file>`,
  `git restore`, or drop/clear stashes. Uncommitted work on
  `feat/takalex-database-foundation` is intentional and must be preserved.
- Never deploy to the remote Supabase project (`omtmqtgmbtkutadbkjzv`):
  no `supabase db push`, no `--linked` resets, no `functions deploy`, no `secrets set`.
  Migrations are tested locally (`supabase start`, `supabase db reset`) and deployed
  only after Cynthia explicitly agrees.
- Never put the Supabase service-role key, Resend API key or any secret in mobile code,
  in `EXPO_PUBLIC_*` variables, or in chat. Server secrets live in Supabase Edge Function secrets.
- Never read or print `.env` files.
- Ask before deleting code, files or data, or before any irreversible change.

## How to work
- Inspect the actual files before proposing changes; never assume state from docs.
- One logical task at a time. State the directory, give exact commands, give the test
  command after each change, and wait for output when it affects the next step.
- Prefer editing existing working code over rewriting it.
- Never claim something works without a test. Never invent test results.
- Flag scope creep and timeline risk honestly. Do not silently expand scope.

## Product rules the database must enforce (not just the UI)
- Roles: collector, site_manager, recycler, admin. RLS on every table; explicit GRANTs
  are needed because automatic table exposure is disabled on the project.
- Users can be assigned to multiple sites via `user_sites` (admin-managed). 8 real sites (see migration 005); admins add more later.
- Materials are rows in the `materials` lookup table (not an enum or hardcoded list), with
  `is_reportable`, `is_verifiable`, `is_recycler_visible` and `is_active` flags, so types can be
  added later. PET, PP, HDPE, LDPE and PLASTIC_BAGS are reportable, verifiable and
  recycler-visible. MIXED is reportable by collectors but can never be used in a verified
  breakdown or shown to recyclers. OTHER/residue stays excluded pending Chemolex confirmation.
- Collector-reported weight and site-manager-verified weight are separate fields.
  Collector weight must never determine payout. Only approved + verified collections
  are payment-eligible. Status changes and verified weight go through a server-side
  RPC only; clients get no direct UPDATE on collections.
- Rejection requires a reason. Keep an audit trail (who, when).
- Offline: client-generated UUID per collection as idempotency key (unique constraint),
  photos stored locally until sync, retry-safe uploads. No advanced conflict resolution.
- Payment gateway / M-Pesa is out of scope; only record eligibility/status.

## Invitations
- Admin-only, via Edge Function. 7-day expiry. Atomic DB changes; old invitation can
  never be accepted.
- Reissue requires an inactive profile and no accepted invitation. Email confirmation
  is not the test, because a failed acceptance can leave a confirmed but inactive user.
- Do NOT assume `auth.admin.generateLink({ type: "invite" })` or `inviteUserByEmail`
  works for an existing Auth user — verify empirically on the local stack first.
- Supabase's built-in email only reaches project team members. Real invites need
  custom SMTP (planned: Resend, once a domain is verified).

## Known issues found in review (pushed commit ac7c20e)
- README mentions 6 sites, SME groups and Mapbox; the agreed brief has 9 sites and no SME groups or maps. Confirm with Chemolex before building them.

## Migration policy
- Before the first database deployment, existing migrations (currently 001–004) may be edited in place while the schema is still under development.
- Before editing an existing migration, verify that it has not been applied to any relevant local or remote database.
- Once the first migration is deployed to takalex-development, freeze all existing migration files permanently.
- After that first deployment, every schema change must be introduced through a new migration. Never edit or rewrite an applied migration.

## Privilege rules
- Edge Functions: `verify_jwt` only proves a valid project key (the public anon key passes it). Any function that needs a user must itself require `Authorization: Bearer`, call `getUser()` with that token, and check the role (e.g. `is_active_admin()`) before using the service-role client.
- PostgreSQL's built-in PUBLIC EXECUTE default on new functions is not overridden; every new
  function must REVOKE/GRANT explicitly beside its definition, and 60_privileges fails if one
  doesn't.
- Edge Functions using service_role must select explicit columns and use return-minimal
  updates; `select('*')` and bare `.select()` are denied on invitations and access_requests.

## Layout
- apps/mobile/src/app — Expo Router routes: public pages, (auth), (collector), (admin), auth/callback
- apps/mobile/src/stores/authStore.ts — Zustand auth state
- apps/mobile/src/lib — supabase client, secure storage, access/sites helpers
- supabase/migrations — 001..004; editing rules in "Migration policy" above
- supabase/functions/invite-user — admin invite Edge Function (create/reissue, code-based)
- supabase/scripts/dev-admin.sh — local-only first-admin bootstrap
