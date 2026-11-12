# Takalex: rules for AI coding assistants

Takalex is an Android-first app for recording and verifying plastic deliveries made by
waste pickers at collection sites. Stack: Expo + React Native + TypeScript (`apps/mobile`),
Supabase (Postgres, Auth, Edge Functions, Storage), Expo SQLite for offline, Sentry,
GitHub Actions. Do not introduce another backend or replace the stack without discussion.

## Hard rules
- Never run `git push`, `git reset --hard`, `git clean`, `git checkout -- <file>` or
  `git restore`, and never drop or clear stashes. The maintainer commits and pushes.
- Never deploy to or change the hosted Supabase project: no `supabase db push`, no
  `--remote` or `--linked` flags, no `functions deploy`, no `secrets set`. Supabase CLI 3
  targets the local stack by default; keep it that way. Deployments are done by the
  maintainer only.
- Never put a service-role key, secret key or any other secret in mobile code, in
  `EXPO_PUBLIC_*` variables or in chat. The app only ever holds the publishable key.
- Never read or print `.env` files.
- Ask before deleting code, files or data, and before any irreversible change.
- Do not add, remove or upgrade dependencies without asking. The lockfile is generated
  with npm 10.9.9, the version CI uses.

## How to work
- Inspect the actual files before proposing changes; never assume state from docs.
- One logical task at a time. Prefer editing existing working code over rewriting it.
- Never claim something works without running the tests, and never invent results:
  - mobile: `npm run typecheck`, `npm run lint`, `npm run test:unit` in `apps/mobile`
  - database: `supabase/tests/sql/run.sh` (throwaway PostgreSQL 17)
  - Edge Functions: `deno check` and `deno lint` in `supabase/functions`
- Passing tests do not prove layout or navigation. Say what needs checking on a device.
- Do not expand scope silently; flag anything outside the task.

## Product rules
Operating model: each waste picker belongs to one collection group (site); site
managers may cover several sites. Assignments live in `user_sites` and are admin-managed.

Enforce these in the database, not only in the UI:
- Roles: collector, site_manager, recycler, admin. RLS on every table, with explicit
  GRANTs (automatic table exposure is disabled on the project).
- Sites and materials are lookup tables, never hardcoded lists. Materials carry
  `is_reportable`, `is_verifiable`, `is_recycler_visible` and `is_active`. MIXED may be
  reported by collectors but never used in a verified breakdown or shown to recyclers.
- Collector-reported weight and manager-verified weight are separate fields. Collector
  weight never determines payment. Only approved, verified deliveries are payment-eligible.
- Status changes and verified weights go through server-side RPCs only; clients get no
  direct UPDATE on collections. Rejection requires a reason. Keep an audit trail (who, when).
- Offline: a client-generated UUID per delivery is the idempotency key (unique
  constraint); photos stay on the phone until synced; uploads are retry-safe.
- Payments are out of scope: record eligibility and status only.

## Invitations
- Admin-only, through the `invite-user` Edge Function. Codes expire after 7 days and are
  activated through `accept-invitation`. An old or revoked code can never be accepted.
- Reissue requires an inactive profile and no accepted invitation. Database changes are atomic.
- Codes are shared by WhatsApp or SMS. The app sends no email; real email needs custom SMTP.

## Migrations
- Migrations 001–008 are deployed to the hosted project and frozen. Never edit an
  applied migration.
- Every schema change is a new numbered migration, tested locally (`supabase db reset`)
  and through the SQL suites before the maintainer deploys it.

## Privilege rules
- `verify_jwt` only proves a valid project key. A function that needs a user must require
  `Authorization: Bearer`, call `getUser()` with that token and check the role (for example
  `is_active_admin()`) before using the service-role client.
- Every new SQL function must REVOKE/GRANT EXECUTE explicitly beside its definition;
  the privilege test suite fails otherwise.
- Edge Functions using the service role select explicit columns and use return-minimal
  updates; `select('*')` and bare `.select()` are denied on invitations and access_requests.

## Navigation
- Several routes resolve to `/`: `app/index.tsx` and each role group's index. Never
  redirect to `/` from inside a role group; it resolves back into the same group and loops.
  `RoleGate` sends users who are not allowed to `/(auth)/login`.

## Layout
- `apps/mobile/src/app`: Expo Router routes. Public: `index` (landing), `request-access`.
  `(auth)`: login, activate. Role areas: `(collector)`, `(manager)`, `(admin)`, `(recycler)`.
- `apps/mobile/src/components`: shared UI (`Ui.tsx`, `RoleGate`, `Landing`, `StatusBadge`, …).
- `apps/mobile/src/lib`: Supabase client (with request timeout), `outbox/` (offline
  deliveries and sync), `review/`, `recycler/`, `admin/`. Auth state: `src/stores/authStore.ts`.
- `supabase/migrations`, `supabase/functions` (`invite-user`, `accept-invitation`, `_shared`),
  `supabase/tests`, `supabase/scripts/dev-admin.sh` (local first admin only, by design).
- Android builds: EAS profile `preview` in `apps/mobile/eas.json`; build-time values come
  from EAS environment variables, not from `.env`.
