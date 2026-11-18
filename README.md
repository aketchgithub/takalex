# Takalex

Takalex is an Android-first app for recording and verifying plastic deliveries made by
waste pickers at Chemolex collection sites. Collectors record a delivery with a photo,
site managers sort, weigh and approve or reject it, and recyclers see the approved,
verified material available by type.

The confirmed operating model and scope are in [`docs/demo-plan.md`](docs/demo-plan.md).
Rules for anyone (or any AI assistant) changing the code are in [`CLAUDE.md`](CLAUDE.md).

## Status (November 2026)

- Hosted Supabase project deployed: migrations `001`–`010` (frozen; `009` and `010`
  on 18 Nov 2026) and the Edge Functions `invite-user` and `accept-invitation`. The
  Sites and Materials screens need a new preview build.
- Android preview APK built with EAS (profile `preview`).
- "Forgot password?" by email code is built and goes live once Chemolex's email sender is
  set up on the hosted project. Reset by SMS (with email as the option) is built behind a
  switch that stays off until an SMS provider is chosen ([`docs/password-reset.md`](docs/password-reset.md)).
- Not yet available: payments, site coordinates.

## Roles

| Role | What they do |
|---|---|
| Collector (waste picker) | Belongs to one site, which is their group ("{site} group"). Records a delivery: reported material, reported weight, in-app photo, device time and (if allowed) location. Works offline; deliveries sync later. |
| Site manager | Chemolex staff assigned to one or more sites. Reviews pending deliveries for those sites, records the verified breakdown (one or more material lines with verified weights) and approves, or rejects with a reason. Reviews are final. |
| Recycler | Sees approved, verified totals by material, with optional site and date-range filters. No collector identities, photos or individual deliveries. |
| Admin | Reviews access requests, invites users, assigns roles and sites, revokes and reissues invitations. Adds, renames, deactivates and reactivates sites (an inactive site takes no new people; collectors already there keep working). Manages the material list (add, edit, reorder, deactivate; delete only unused materials). |

Accounts are invite-only. A waste picker requests access in the app and chooses their
site; an admin approves the request and the app creates an invitation code, which is
shared by WhatsApp or SMS. The invitee activates the account with their email, the code
and a new password. Every signed-in user can change their password. A forgotten password
is reset with a code sent by email, or by SMS to a phone number the user has added once SMS
is switched on ([`docs/password-reset.md`](docs/password-reset.md)).

## Materials

Materials are a lookup table (`public.materials`, seeded in migration `001`), not a
hardcoded list, and admins manage it in the app (Admin overview → Manage materials,
migration `010`). Each material has flags that the database enforces:

| Material | Collectors report | Managers verify | Recyclers see |
|---|:---:|:---:|:---:|
| PET | yes | yes | yes |
| PP | yes | yes | yes |
| HDPE | yes | yes | yes |
| LDPE | yes | yes | yes |
| Plastic bags | yes | yes | yes |
| Mixed | yes | no | no |

- A collector reports one material for the whole delivery, which may be Mixed.
- A manager's verified breakdown may use every material except Mixed.
- Recyclers see the sum of verified breakdown lines of **approved** deliveries only
  ("approved verified weight to date"). Mixed never appears. There is no stock
  deduction, pricing or purchasing.
- Reported weight never determines payment. Only approved, verified deliveries are
  payment-eligible; payments themselves are out of scope.

## Stack

- Mobile: Expo SDK 58, React Native, TypeScript, Expo Router, Expo SQLite (offline
  outbox), Zustand, Sentry. Code in `apps/mobile`.
- Backend: Supabase (Postgres with RLS on every table, Auth, Edge Functions on Deno,
  private Storage for delivery photos). Code in `supabase`.
- CI: GitHub Actions (`.github/workflows/ci.yml`).

## Repository layout

```
apps/mobile/            Expo app
  src/app/              routes: public pages, (auth), (collector), (manager), (recycler), (admin)
  src/components/       shared UI
  src/lib/              Supabase client, offline outbox, review, recycler, admin
  src/stores/           auth state
  eas.json              EAS build profile "preview" (Android APK)
supabase/
  migrations/           001–010 deployed and frozen; 011 (admin analytics) and 012 (site locations) local only; every change is a new migration
  functions/            invite-user, accept-invitation, _shared
  tests/sql/            SQL suites on a throwaway PostgreSQL 17 cluster
  tests/local-stack/    checks against the local Supabase stack
  scripts/dev-admin.sh  creates the first admin on the local stack only
docs/                   operating model and device checklists
```

## Local development

Requirements: Node 22, npm 10.9.9 (the lockfile version), Docker, the Supabase CLI,
and an Android phone with Expo Go. On Windows, run everything except `adb` inside WSL.

1. Start the local stack and Edge Functions:

   ```bash
   supabase start
   supabase functions serve
   ```

2. Create the first local admin (once per `supabase db reset`):

   ```bash
   supabase/scripts/dev-admin.sh
   ```

3. Create `apps/mobile/.env.local` with the local URL and the **publishable** key from
   `supabase status`. Never put a secret or service-role key in the app.

4. Install and start Metro:

   ```bash
   cd apps/mobile
   npm ci
   npx expo start --localhost
   ```

5. Forward ports to the phone with `adb reverse` (54321 and 8081) and open
   `exp://127.0.0.1:8081` in Expo Go.

Full step-by-step instructions and troubleshooting: [`docs/dev-device.md`](docs/dev-device.md).

## Tests

```bash
# Mobile (in apps/mobile)
npm run typecheck
npm run lint
npm run test:unit

# Database (any free port; see supabase/tests/sql/README.md)
supabase/tests/sql/run.sh 55432

# Edge Functions (in supabase/functions)
deno check --no-lock -- */*.ts
deno lint
```

CI runs all three on every push and pull request. Passing tests do not prove layout or
navigation; check those on a device (see the checklists in `docs/`).

## Builds and deployment

- Android preview APK: EAS profile `preview`, started manually from the CI workflow
  (`workflow_dispatch`). Build-time values come from EAS environment variables, not
  from `.env` files.
- The hosted Supabase project is deployed by the maintainer only. New migrations and
  Edge Functions are tested locally first.
- First admin on the hosted project: create the Auth user in the Supabase Dashboard
  (Auto Confirm User), then run `SELECT public.bootstrap_first_admin('<email>');` in the
  SQL Editor. It refuses once any admin exists. Details in
  `supabase/migrations/004_admin_bootstrap.sql`.

## License

GPL-3.0. See [`LICENSE`](LICENSE).
