# Takalex — Working Multi-Role Demo Plan

Client: Chemolex (contact: Owino Aketch). Developer: Cynthia Chepkemoi Langat.
This document is the standing brief for building the first working Takalex demo.
Every Claude Code session working on the demo must read it together with `CLAUDE.md`.

The goal is a credible, working multi-role demo that can be shown to Chemolex — not a
collection of screens. It must use the real Supabase backend, real authentication,
real database records, role-based access control and real workflows. No mock screens,
hardcoded demo users, fake collections, mock API responses or buttons that do nothing.
Local development seed data is acceptable only when clearly labelled as local test data
and created through the approved development process (`supabase/seed.sql`).

---

## 0. Confirmed operating model (5 Nov 2026) — read first

Confirmed with Chemolex on 5 Nov 2026. Where this conflicts with sections 1–5 below,
this section wins.

**Collectors (waste pickers)**
- Each collector is an individual with their own phone and email address, and their
  own account. Collectors are members of one group (e.g. the Kiyambea women's group);
  each group belongs to one site. Groups are shown for context; deliveries are
  **credited to the individual collector**.
- The collector records their own delivery in the app: reported material type,
  reported weight, an in-app camera photo, the device capture time and (when permission
  is granted) the device location.

**Site managers**
- Chemolex employees. **Waste is weighed at each site**, so managers are assigned to
  sites (a manager may cover more than one site) and only review deliveries for their
  assigned sites.
- The manager confirms the delivery, sorts and weighs it, and records the **verified
  breakdown**: one or more lines of verified material type and verified weight (a single
  delivery can contain several material types after sorting, e.g. 3 kg PET + 2 kg plastic
  bags). The breakdown is separate from the collector's reported type and weight.
- If everything is correct, the manager approves and the collection becomes eligible
  for payment. Otherwise the manager rejects it with a reason. Reviewed records are
  final.

**Recyclers**
- See the **available sorted material by type** with its verified weight (PET, PP,
  HDPE, LDPE, plastic bags, as in the earlier concept demo). Totals are the sum of the
  verified breakdown lines of approved collections. A site filter is optional.
- Recyclers must **not** see an "Other" category for now.
- Recycler purchasing, stock deductions, pricing and payments are **out of scope** for now.
  Totals therefore accumulate; label them clearly (e.g. "approved verified weight to
  date") and allow a date-range filter rather than implying live stock.

**Sites**
- Real sites: Kariadudu, Ng'omong'o, Kiyambea, Komb Green, Mathare, Babadogo, Njiru,
  Kariobangi. Remaining slots stay as clearly labelled TEST sites; more real sites will
  be added later by administrators.
- Exact site coordinates are not yet known. Do not invent coordinates.

**Traceability (agreed for the first version)**
- Timestamps: device capture time (untrusted), server submission time, server
  verification time.
- A full audit trail of every record (`collection_events`): submission, verification,
  approval/rejection, with who, when, previous and new values.
- Device location on each delivery, stored as untrusted metadata, optional if the
  user denies permission.
- Not in the first version: third-party verification, plastic credits, impact
  analytics, payments. (The Chemolex website describes some of these; they are later
  phases.)

**Schema implications to plan (not yet implemented)**
- Material types become a lookup table instead of the `material_type` enum, so types can
  be added later. Columns include whether a type can be reported by collectors, whether
  it can be used in a verified breakdown, and whether it is visible to recyclers.
  Initial verified types: PET, PP, HDPE, LDPE, PLASTIC_BAGS. Collectors report one
  material type for the whole delivery, which may be MIXED.
- An OTHER type, if kept at all, is for unclassified residue only and is never visible
  to recyclers (assumption; confirm with Chemolex whether managers need it).
- New table for the verified breakdown, e.g. `collection_verified_items`
  (collection, verified material, verified weight > 0, one line per material per
  collection). Insert-only, written only by `review_collection`; no client writes.
- `collection_logs.verified_weight_kg` becomes the verified total, set by
  `review_collection` as the sum of the breakdown lines (tests must assert they match).
  `collection_logs` also gains device location fields (latitude, longitude, accuracy),
  all untrusted.
- `review_collection` takes the breakdown (e.g. a JSON array of material + weight). On
  approval it requires at least one line, valid verifiable materials, no duplicates and
  positive weights. On rejection it records no breakdown and requires a reason. The
  review event records the reported type and weight and the full verified breakdown.
- Payment eligibility remains on the delivery and is credited to the individual collector.
- `sites.location` must allow NULL until real coordinates are supplied, or real sites
  cannot be created.
- Collector group membership: `profiles.group_id` and `sme_groups` (already exist) need
  RLS, admin management and a site link check; collectors can belong to one group only.
- Recycler availability: a narrow read-only function returning totals of approved
  breakdown lines by material (only materials visible to recyclers), optionally by site
  and date range, with no collector identities or photos.
- Real sites go in a migration (not `seed.sql`) so they reach the hosted project.

**Confirmed 5 Nov:** one delivery can contain several material types after sorting;
recyclers do not see an "Other" category.

**Still to confirm with Chemolex**
1. Whether managers need an OTHER/residue line in the verified breakdown (it would never
   be shown to recyclers).
2. Site coordinates, and the list of groups per site.

Role-independent work (invitations, auth, device connectivity, storage, CI) can proceed.

**Decisions (5 Nov, assessment)**
- Order: Phase 0, then schema round S1 (in-place edits to 001 plus one local reset),
  then Phase 1, then schema round S2 (new migrations 005–008), then Phase 2.
- Recyclers see totals for all sites, with an optional site filter, and have no site
  assignments. `register_invitation` and `consume_invitation` (and their tests) change so
  that sites are required for collector and site_manager and optional for recycler.
- No OTHER material for now.
- TEST sites stay in the local seed (`supabase/seed.sql`) only. The hosted project gets
  the 8 real sites through a migration.
- Phone OTP is dropped. The invitation code is shown to the admin once and never stored
  in plain form (only its SHA-256 hash).
- Deletions approved: the stray `apps/package.json` and its lockfile (Phase 0), and
  `apps/mobile/src/app/auth/callback.tsx` with the deep-link and OTP paths (Phase 1).
- Trims accepted: Phase 4 is limited to site reassignment and deactivation; groups
  management is minimal; offline retry is retry-on-open plus a "Sync now" button.

---

## 1. Roles and workflows

### 1.1 Administrator
- Sign in securely and view the administration dashboard.
- View registered users and their roles.
- Invite new users, assign roles, assign collectors to a group (and so a site) and
  site managers to one or more sites.
- View and manage collection sites (eight real sites plus labelled TEST sites; more
  sites added later) and the groups at each site.
- View, approve or reject access requests.
- View invitations and their statuses; revoke and reissue invitations.
- View collection activity and approval history across the platform.
- The administrator must not be able to bypass database security rules through the app.

Invitation flow (code-based design, already implemented in the database):
1. Admin creates an invitation (Edge Function creates the unconfirmed Auth user, generates
   a random code, stores only its SHA-256 hash via `register_invitation`).
2. The invitee receives the code (development: shown to the admin and/or captured by
   Mailpit; production: email via verified SMTP, or passed on by SMS/WhatsApp).
3. The invitee enters email + code + new password in the app; a public Edge Function
   (`accept-invitation`) calls `verify_invitation_code`, then `claim_invitation` (a
   short lease only one request can hold), then, as the claim holder only, sets the
   password and confirms the email, then calls `consume_invitation` with the claim token.
4. The account is active, with the correct role and site assignments, and the user signs in.

Never expose invitation code hashes or service-role credentials to the mobile app.

### 1.2 Collector / Waste Picker — highest priority
- Accept an invitation, activate the account, sign in.
- See their group and site.
- Start a new submission: select the reported material type, enter reported weight
  in kg, capture a photo with the device camera inside the app, preview, retake, submit.
  The device location is attached when permission is granted.
- See a clear "pending review" indication, submission status and collection history.

Each submission captures: collector ID (server-set), site, reported material, reported
weight, photo evidence, client-generated record ID (`client_record_id`, for duplicate
prevention), device capture timestamp (`captured_at`, untrusted) and device location
(untrusted, optional).

Rules (enforced by the database, not only the UI):
- Reported weight is not the verified weight.
- A collector cannot approve, edit after submission, or mark anything payment eligible.
- Submissions must never be silently discarded when connectivity is lost.

### 1.3 Site Manager
- Sign in; see assigned site(s); view pending submissions for those sites.
- Open a record; view the collector's information and photo evidence.
- Confirm the delivery, sort and weigh it, record the verified breakdown (one or more
  material types with their verified weights); approve (payment eligible), or reject
  with a reason.
- View reviewed collection history.

Rules: only managers assigned to the collection's site may review; verified weight and
material are distinct from the reported weight and material; approval makes the
collection payment eligible; rejection does not; every review is recorded in
`collection_events`; reviewed collections are final and cannot be reviewed again.
Review goes through `review_collection()` only. No payment gateway or M-Pesa.

### 1.4 Recycler
- Sign in; view available sorted material by type (PET, PP, HDPE, LDPE, plastic bags)
  with its verified weight. No "Other" category.
- Optionally filter by site and date range.
- Totals are the sum of approved collections' verified breakdown lines, grouped by
  material. There is no stock deduction, pickup, pricing, bidding or purchasing; those
  are not agreed scope.
- Recyclers cannot submit, verify, approve/reject, edit, or access admin functions, and
  must not see collector identities or photos.

### 1.5 Shared requirements
- One app and one backend for all roles.
- Real Supabase Auth, role-aware navigation, protected screens, role- and site-based
  access restrictions.
- Loading, empty, success and error states; useful validation; session persistence;
  logout; consistent visual design.

---

## 2. Agreed technical decisions

- **Submission path (offline-ready from day one):** every collector submission is written
  first to a local Expo SQLite outbox (record + photo file stored on the device), then a
  sync step uploads it — even when online. Sync is idempotent on `client_record_id`; a
  duplicate-key response means "already synced". Retry/backoff polish comes in Week 3,
  but no submission may exist only in memory.
- **Evidence storage:** private `collection-evidence` bucket; object path
  `{collector_uid}/{client_record_id}/{photo_uuid}.jpg`; uploads only into the collector's
  own folder and only for their own pending collection; no client update or delete;
  managers view through short-lived signed URLs; recyclers have no access;
  `collection_evidence` gets a column-restricted INSERT with server-set `uploaded_at`;
  `review_collection` requires at least one evidence row before approval. Photos are
  compressed on device (about 1280 px, JPEG quality ~0.6) to respect free-plan storage.
- **Admin user management** (role change, site reassignment, deactivation) goes through
  audited SECURITY DEFINER functions. Protect against deactivating or demoting the last
  active admin. No direct table write grants.
- **Recycler availability** is served by a narrow read-only function or view returning
  aggregates only.
- **Edge Functions** using service_role select explicit columns and use return-minimal
  updates (see CLAUDE.md "Privilege rules").
- **Device connectivity:** local URLs live in `apps/mobile/.env.local` only. The app on an
  Android emulator or physical phone must reach the local Supabase stack running under
  WSL / Docker Desktop (emulator: `10.0.2.2`; phone: Windows LAN IP + firewall rule).
  Decide whether Expo Go suffices or a development build is required.

## 3. Technical constraints

Stack: React Native, Expo, TypeScript, Supabase Auth/Postgres/Edge Functions/Storage,
Expo SQLite.

- Keep the existing security model, migrations and privilege matrix intact. Follow the
  CLAUDE.md migration policy and privilege rules. Any new function or table must be added
  to `supabase/tests/sql/suites/60_privileges.sql` and `supabase/tests/local-stack/catalog.sql`.
- Never weaken RLS or grants to make the UI work. Never expose the service-role key or
  put privileged operations in client code. No `select('*')` on sensitive tables.
- Never connect to or modify the hosted Supabase project without explicit approval.
  Never use `--linked`. Ask before any destructive local reset.
- Never commit, push or deploy without approval. Never modify tests just to make them pass.

## 4. Implementation phases

Each phase is delivered as small, reviewable rounds: explain what and why, list files,
make focused changes, explain security decisions, run tests, report exact pass/fail,
list remaining issues, stop for review.

- **Phase 0 — Housekeeping:** security review of `supabase/tests/local-stack/` scripts;
  Auth experiments; CI fix (typecheck + lint, no failing `npm test`); correct
  `.env.example`; local `.env.local` for device connectivity.
- **Phase 1 — Authentication and invitations:** invite, verify/accept, activation, login,
  logout, role and site assignment, access-request review.
- **Phase 2 — Collector:** dashboard, assigned site, SQLite outbox, camera capture,
  evidence storage, upload/sync, status and history.
- **Phase 3 — Site Manager:** pending queue, signed-URL evidence viewing, verified
  breakdown entry, approve/reject, review history.
- **Phase 4 — Administrator:** user management RPCs and screens, invitations list,
  site and group assignments, access requests, collection overview.
- **Phase 5 — Recycler:** availability aggregates, site/material filters, read-only enforcement.
- **Phase 6 — Integration and testing:** full four-role journey, unauthorized access,
  wrong-site assignments, failed uploads/network errors, invitation failures and expiry,
  approval/rejection, backend-controlled payment eligibility, all test suites.

Expected timing: Phases 0–3 are the critical path (Week 2). Phases 4–5 stay lean
(Week 3, alongside offline polish). Phase 6 and release preparation are Week 4.

## 5. Definition of a successful demo

On a real Android device or emulator:
1. An administrator signs in.
2. The administrator invites a collector and assigns a site.
3. The collector accepts the invitation and activates their account.
4. The collector signs in and sees their assigned site.
5. The collector selects a material, enters reported weight, takes a real photo and submits.
6. The collection is saved in Supabase and appears as pending.
7. The assigned site manager signs in and sees the submission.
8. The manager opens the evidence, records the verified breakdown (one or more material
   types and weights) and approves, or rejects with a reason.
9. Collection status and event history reflect the decision, including reported vs
   verified breakdown.
10. The administrator sees the updated collection and its status.
11. The recycler sees available sorted material by type and weight but cannot perform
    admin or verification actions.

The demo must also show that unauthorized users cannot access or manipulate another
role's data.
