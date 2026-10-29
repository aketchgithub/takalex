# TAKALEX APP MVP TECHNICAL PLAYBOOK

This guide is divided into 4 one-week phases (sprints), each with clear goals, deliverables, and daily priorities.

![Architecture Drawing](assets/takalex_sprint_architecture.svg)

## Stack Decision Rationale
*(Could be slightly adjusted based on needs)*

- **React Native + Expo** over Flutter: We are more likely to find JS/TS talent in Nairobi, and Expo's managed workflow dramatically cuts DevOps overhead in a sprint. We get OTA updates (critical for post-launch patches without app store delays) and EAS Build handles binary generation.

- **Supabase** over Firebase: PostgreSQL's Row Level Security handles our RBAC requirements natively at the database level — a Collector literally cannot query another group's records even if they bypass the app. Firebase requires us to implement that logic ourselves in every query.

- **Mapbox** over Google Maps: We can style tiles to match Chemolex's brand colors at no extra API cost, and it performs better offline with tile caching.

## PHASE 1: FOUNDATION
The goal of this phase is to have a working skeleton that every future feature attaches to. We do not build features yet.

### Step 1: Repository & Environment Setup
Initialize the monorepo with the following structure:

```
takalex/
  apps/
    mobile/          # React Native (Expo)
  packages/
    shared/          # types, constants, API helpers
  supabase/
    migrations/      # all DB schema SQL here
    seed.sql
  .github/
    workflows/       # CI pipeline
```

Run the following command inside `apps/`:
```bash
npx create-expo-app mobile --template blank-typescript
```

Install core dependencies immediately:
```bash
npm install @supabase/supabase-js react-native-maps @rnmapbox/maps expo-sqlite expo-location zustand react-hook-form zod
```

### Step 2: Backend (Supabase Project & Database Schema)

Create the Supabase project and write the first migration in `supabase/migrations/001_initial_schema.sql`. The core schema for MVP:

```sql
-- Enums
CREATE TYPE user_role AS ENUM ('collector', 'admin', 'recycler');
CREATE TYPE material_type AS ENUM ('PET', 'HDPE', 'LDPE', 'MIXED');
CREATE TYPE collection_status AS ENUM ('pending', 'approved', 'paid');

-- Sites table (the 6 Nairobi locations)
CREATE TABLE sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  location GEOGRAPHY(POINT, 4326) NOT NULL,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

# -- User profiles (extends Supabase auth.users)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  full_name TEXT,
  phone TEXT,
  role user_role NOT NULL DEFAULT 'collector',
  site_id UUID REFERENCES sites(id),
  group_id UUID, -- FK added after groups table
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

# -- SME Groups
CREATE TABLE sme_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  site_id UUID REFERENCES sites(id),
  leader_id UUID REFERENCES profiles(id),
  member_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

# -- Waste Collection Logs
CREATE TABLE collection_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collector_id UUID REFERENCES profiles(id),
  group_id UUID REFERENCES sme_groups(id),
  site_id UUID REFERENCES sites(id),
  material material_type NOT NULL,
  weight_kg DECIMAL(10,2) NOT NULL,
  status collection_status DEFAULT 'pending',
  price_per_kg DECIMAL(8,2),
  total_payout DECIMAL(10,2) GENERATED ALWAYS AS (weight_kg * price_per_kg) STORED,
  logged_at TIMESTAMPTZ DEFAULT NOW(),
  synced_at TIMESTAMPTZ -- null means created offline
);
```

Then write RLS policies immediately:

```sql
-- Collectors only see their own logs
ALTER TABLE collection_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "collector_own_logs" ON collection_logs
  FOR SELECT USING (
    collector_id = auth.uid() OR
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );
```

### Step 3: Auth Flow
Build the AUTH screens: Login, Register (with role selection hidden; Admin creates Collector accounts via invite). Use Supabase Auth with email/password and phone OTP as fallback (important for informal waste pickers). Store the session in a Zustand store with persistence via `expo-secure-store`.

```typescript
// stores/authStore.ts
interface AuthState {
  user: User | null;
  profile: Profile | null;
  role: UserRole | null;
  setSession: (user: User, profile: Profile) => void;
  signOut: () => void;
}
```

After login, immediately fetch the user's `profile` row to get their `role` and `site_id`. This drives all navigation and RLS automatically.

### Step 4: Navigation Architecture

Use Expo Router (file-based routing). Structure navigation with role-based layouts:

```
app/
  (auth)/
    login.tsx
    register.tsx
  (collector)/
    _layout.tsx    # Tab navigator
    index.tsx      # Dashboard
    log.tsx        # Log waste
    history.tsx    # My collections
  (admin)/
    _layout.tsx
    index.tsx      # Overview
    sites.tsx      # Site management
    groups.tsx     # SME groups
```

In the root `_layout.tsx`, redirect based on role:

```typescript
const { role } = useAuthStore();
if (!role) return <Redirect href="/(auth)/login" />;
if (role === 'admin') return <Redirect href="/(admin)" />;
return <Redirect href="/(collector)" />;
```

#### Step 3-4 implementation notes

- The Expo app lives in `apps/mobile`. Copy `.env.example` to `.env.local` there
  and set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
  The service-role key must never be added to the mobile app.
- Accounts are invite-only. An active admin sends collector invitations from the
  Admin workspace; the `invite-collector` Edge Function checks the caller's
  profile before using the server-side Auth Admin API. Migration
  `002_auth_profiles.sql` creates collector profiles for invited Auth users and
  lets each user read only their own profile.
- Bootstrap the first admin by creating their Auth user in the Supabase
  Dashboard, then promoting that user's generated profile to `admin` in the
  SQL Editor. Public sign-up is disabled in the hosted Auth configuration.
- Email invitations use the `takalex://auth/callback` app link. Test invitation
  links with a native development build that registers the `takalex` scheme.
  Configure Supabase email delivery and an SMS provider before testing invites
  or phone OTP. Phone OTP is available after a collector verifies a phone
  number during invitation setup.
- Start the app from `apps/mobile` with `npx expo start`. The auth store and
  Supabase Auth both persist session state through Expo SecureStore on native
  devices; web builds use browser local storage.
- Step 4 is scaffolded under `apps/mobile/src/app`: the root route selects the
  authenticated role, protected collector/admin tab layouts expose their
  respective routes, and the dashboard, logging, history, site and group
  screens are placeholders for later feature work.

#### Hybrid access model: public for discovery, invite-only for action

Takalex should not be a fully public operational app. A public-facing product is useful for discovery, education, and intake, but real operational actions (collector access, site management, payouts, claims, collection review, and admin controls) must remain controlled by invitation and authorization.

This design balances four major constraints:

- Security: it prevents fake accounts, duplicate worker identities, and fraudulent collection logs.
- Admin simplicity: non-technical Chemolex staff can review a short queue instead of managing a chaotic self-serve signup flow.
- Cost control: it limits support and SMS/email overhead from low-quality signups and abuse.
- Trust: it makes it obvious that a user is only allowed to act after an admin has validated and invited them.

The implementation should be split into two surfaces:

1. Public discovery surface
   - root landing page
   - about / how it works
   - locations and site overview
   - public FAQ
   - request access or waitlist form
   - general brand and education content

2. Invite-only action surface
   - collector dashboard
   - admin dashboard
   - site and group management
   - collection log submission and review
   - payments and payout review
   - any workflow that touches operational, financial, or sensitive record data

A simple rule for the product: if the action changes an operational state, it requires an approved identity and role assignment.

##### Recommended route and app structure

```
app/
  index.tsx                 # public landing page
  about.tsx
  how-it-works.tsx
  sites.tsx
  request-access.tsx
  waitlist.tsx
  (auth)/
    login.tsx
    register.tsx
    accept-invite.tsx
  auth/
    callback.tsx
  (collector)/
    _layout.tsx
    index.tsx
    log.tsx
    history.tsx
  (admin)/
    _layout.tsx
    index.tsx
    invite.tsx
    sites.tsx
    groups.tsx
```

The root route should redirect as follows:

- anonymous user → `index` or `request-access`
- invited collector → collector dashboard
- admin → admin dashboard
- unauthenticated public user who lands on a protected screen → login or request-access

##### Access-request and invite pipeline

The business flow should be:

1. Public visitor learns about Takalex and requests access.
2. Admin reviews a lightweight access request queue.
3. Admin approves the user and sends an invite.
4. The invited user clicks the deep link and verifies email or phone.
5. Supabase creates the auth user and profile record.
6. The app fetches that profile and routes the user to the correct dashboard.
7. The user can only access protected routes after profile validation.

This flow reduces support burden while preserving governance.

##### Required database additions for the hybrid model

Add a request and invite layer to support the public-to-private funnel:

```sql
CREATE TYPE access_status AS ENUM ('submitted', 'reviewed', 'approved', 'invited', 'rejected');

CREATE TABLE access_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'collector',
  site_name TEXT,
  referral_source TEXT,
  status access_status NOT NULL DEFAULT 'submitted',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  notes TEXT
);

CREATE TABLE invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  invited_by UUID REFERENCES auth.users(id),
  role user_role NOT NULL DEFAULT 'collector',
  site_id UUID REFERENCES sites(id),
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  token TEXT UNIQUE
);
```

RLS rules should enforce the following:

- admins can create or review access requests and invites
- collectors can only read their own profile and logs
- admins can read site and group data required for operations
- public users should never be able to query protected tables or operational records

##### Admin workflow for non-technical team

The admin UI should be intentionally small and predictable:

- Review access requests in one list
- Filter by status: submitted / approved / invited / rejected
- Click Approve and Send Invite
- Use a single standardized invite template
- View invite status and accepted users
- Manage site assignment and role assignment without exposing raw SQL or technical settings

Avoid any admin UI that requires the team to manage database rows manually. The admin function should be a guided workflow, not a spreadsheet of raw system data.

##### Security model for the hybrid approach

Public discovery pages must never expose:

- collection data
- payout data
- private group data
- private collector status
- sensitive site operation details
- invite or onboarding data

The security boundary should be enforced in Supabase as the system of record:

- Auth users are separate from profiles and role assignments
- profiles hold role, site_id, and group membership
- collection logs are owned by the collector and restricted by site or group access
- admin-only Edge Functions are allowed to create invites and update access status
- mobile app code should never contain the service-role key

##### Rollout plan for this repo

Phase 1: Public entry and intake

- Build the public app shell (`/`, `/about`, `/how-it-works`, `/request-access`)
- Create `access_requests` table and admin review flow
- Add `invite` screen for admin-only invite sends
- Add a lightweight review dashboard for new access requests
- Keep the operational app closed to non-invited users

Phase 2: Invite-driven onboarding

- Implement the invite acceptance flow in the mobile app
- Add OTP/email verification for invited users
- Fetch profile after auth and redirect by role
- Create a first admin manually in Supabase, then promote them via SQL
- Lock down public sign-up in Auth settings

Phase 3: Collector operational workspace

- Build the collector dashboard and history view
- Enable log creation and offline pending state
- Add site assignment and group association
- Ensure collections are tied to the current collector and site

Phase 4: Admin operations and review

- Add site management and group management screens
- Add approval queues and manager notes
- Add payout review and finance-ready summaries
- Improve onboarding and support flows for admin staff

Phase 5: Production hardening

- Add email/SMS config and delivery checks
- Add real error logging and admin notifications
- Add automated tests for auth, access request processing, and invite flow
- Add monitoring for failed invitations and rejected sign-ins
- Prepare the beta release with public landing + invite-only operations

##### Implementation checklist for the next sprint

- Add public pages for discovery and request access
- Add `access_requests` table and admin review UI
- Add admin-only `invite` flow already scaffolded in the app
- Add invite acceptance / callback handling for `takalex://auth/callback`
- Add retention and audit log on invitation status changes
- Add RLS rules for admin-only invite creation
- Add route guarding for public vs protected screens
- Test invite flow end-to-end with a native build
- Confirm admin-only role assignment and no self-signup path

This is the correct long-term model for Takalex: discoverable to the public, but operationally gated for security, trust, and cost control.

### Step 5: CI/CD Pipeline
Set up GitHub Actions. Create `.github/workflows/ci.yml`:

```yaml
name: CI
on: [push, pull_request]
jobs:
  lint-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm run lint
      - run: npm test -- --passWithNoTests
  
  eas-preview:
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: expo/expo-github-action@v8
        with:
          eas-version: latest
          token: ${{ secrets.EXPO_TOKEN }}
      - run: eas build --profile preview --platform android --non-interactive
```

At this point, also configure Sentry: Run `npx expo install @sentry/react-native` and initialize in `app/_layout.tsx`. This catches crashes in production from Day 1 of beta.

## PHASE 2: CORE DASHBOARDS
This is the MVP delivery phase: two dashboards. Build one screen at a time, test it, and commit.

### Collector Dashboard: Key Screens
The home screen shows three stat cards: *Today's Weight*, *this month's weight*, *pending payout*, and a quick-log button.

Pull data from Supabase in real-time using `supabase.channel()`:

```typescript
useEffect(() => {
  const channel = supabase
    .channel('my-logs')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'collection_logs',
      filter: `collector_id=eq.${userId}`
    }, (payload) => {
      // update local state
    })
    .subscribe();
  return () => supabase.removeChannel(channel);
}, [userId]);
```

The waste logging form is the most critical screen in the app. We will use `react-hook-form` + `zod` validation.
- Fields: material type (segmented control), weight (numerical input with decimal), date (defaults to today), optional notes.
- On submit, write to the local SQLite queue first, then attempt Supabase sync. If offline, show a "Saved locally: will sync when online" badge.

#### Offline-First Pattern for Field Collectors

```typescript
// offlineQueue.ts
export async function logWasteOfflineFirst(log: WasteLogInput) {
  // 1. Always write to SQLite immediately
  await db.runAsync(
    'INSERT INTO pending_logs VALUES (?, ?, ?, ?, ?)',
    [log.id, log.material, log.weight_kg, log.logged_at, 'pending']
  );
  
  // 2. Try to sync immediately
  const isOnline = await NetInfo.fetch();
  if (isOnline.isConnected) {
    await syncPendingLogs();
  }
  // 3. Register background sync for when connectivity returns
  await BackgroundFetch.registerTaskAsync('SYNC_LOGS');
}
```

### Admin Dashboard: Key Screens
The admin home screen has a summary strip:
- Total sites: 10
- Active Collectors: 248
- Total Waste This Month: X kg
- Pending Payouts: KES X

List of all 10 sites with their current inventory levels. Pull this from an aggregated Postgres view:

```sql
CREATE VIEW site_summary AS
SELECT
  s.id,
  s.name,
  COUNT(DISTINCT p.id) AS active_collectors,
  COALESCE(SUM(cl.weight_kg) FILTER (WHERE cl.logged_at > NOW() - INTERVAL '30 days'), 0) AS monthly_kg,
  COALESCE(SUM(cl.total_payout) FILTER (WHERE cl.status = 'pending'), 0) AS pending_payout_kes
FROM sites s
LEFT JOIN profiles p ON p.site_id = s.id AND p.is_active = true
LEFT JOIN collection_logs cl ON cl.site_id = s.id
GROUP BY s.id, s.name;
```

The Approve Payouts flow is straightforward: Admin sees a list of *pending* logs grouped by collector, taps to batch-approve, which runs a Supabase Edge Function that updates statuses and triggers a payout record.

#### Map & Analytics

##### Interactive Map
Initialize Mapbox in `(admin)/sites.tsx`. The sites are seeded in `supabase/seed.sql` with exact GPS coordinates for Kariadudud, Ngomongo, Kariobangi, Babadogo, Mathare, and Njiru. Render them as custom markers with a color indicating capacity status: (green=under 50%), (amber=50-80%), (red=over 80%).

On marker tap, render a bottom sheet (use `@gorhom/bottom-sheet`) showing the site card: name, active groups count, current inventory, and a "View Records" button that pushes to the detailed site screen.

```typescript
const siteMarkerColor = (fillPercent: number) => {
  if (fillPercent < 50) return '#1D9E75';  // teal
  if (fillPercent < 80) return '#BA7517';  // amber
  return '#A32D2D';                         // red
};
```

##### Analytics Charts
Use `react-native-chart-kit` or `victory-native` for charts. For MVP, deliver three charts on the Admin dashboard: a bar chart (for weekly waste volume per site), a pie chart (for material type breakdown: PET vs HDPE vs LDPE), and a line chart (monthly trend over 3 months). All three are computed server-side via Postgres views to minimize client-side processing.

The impact metrics strip:
- Jobs created: 248
- Women empowered: 156
- Youth engaged: 92
- Rivers restored: 3
- Water quality: 45%

Should be a horizontally scrollable card row at the top of the Admin analytics screen. These numbers are stored in a `kpi_overrides` table that Admins can update manually for now. (Real-time computation is a key Phase 2 Feature.)

#### SME Group Management
Build the group management screen for Admin:
- List all groups.
- View a group's members and their individual collection history.
- Add/remove members.

This should be a standard CRUD against the `sme_groups` and `profiles` tables.

Use optimistic UI updates: Update local state first, then sync in the background, rollback on error.

### Hardening & Deployment

#### Testing
Write tests at three levels:
1. Unit tests with Jest for all utility functions: Weight calculations, payout computations, offline queue logic.
2. Integration tests with Supabase's local emulator (`supabase start`) for all RLS policies; test that a Collector with `group_id = X` cannot read logs from `group_id = Y`.
3. E2E tests with Detox for the three critical user flows: Collector logs waste ⇒ Admin sees it ⇒ Admin approves payout.

Run the test suite against a seed database with all the sites, 10 SME groups, and 50 test users across roles.

#### Performance & Edge Cases
Profile the app with Flipper and the React Native Performance Monitor.

Watch for the following specific issues:
- FlatList re-renders on the Admin site list. Use `React.memo` and `keyExtractor`.
- Mapbox performance with all markers and clustering enabled.
- SQLite sync queue under poor network conditions. Test with Network Link Conditioner on iOS Simulator set to "Very Bad Network."

Handle the following edge cases explicitly:
- Zero collections on a new site (empty state screens, not blank screens).
- Duplicate log submissions when offline queue syncs twice.
- Session expiry mid-use (auto-refresh token, fallback to re-login).

#### Staging Deployment
Create 3 Supabase environments: dev (local), staging, and production.

Run the full migration set against staging. Configure EAS Build profiles:

```json
// eas.json
{
  "build": {
    "development": { "developmentClient": true, "distribution": "internal" },
    "staging": { "distribution": "internal", "env": { "APP_ENV": "staging" } },
    "production": { "distribution": "store" }
  }
}
```

Generate the staging APK with `eas build --profile staging --platform android`.

Distribute to Chemolex stakeholders via Expo's internal distribution link for UAT (User Acceptance Testing) to get real field feedback on Android usage before production.

### PRODUCTION LAUNCH
Run the production migration: `supabase db push --db-url $PROD_URL`.

Seed the sites and create the first Admin account. Enable Supabase's built-in database backup for daily snapshots.

Submit the Android APK to Play Store internal testing track, but do not go public yet.

Configure Sentry alerts for crash rate >2% and API error rate >5%. Set up a Supabase `pg_cron` job to run the analytics aggregation views nightly so dashboards load instantly.