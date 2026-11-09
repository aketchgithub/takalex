# Phase 3 device checklist: site manager verification

Run on an Android phone or emulator against the **local** stack
(`docs/dev-device.md`). Nothing here touches the hosted project.
Migration `007_reviewable_collector_names.sql` must be applied locally
(`supabase migration up`, with no `--remote` or `--linked`).

Record the result of each step (pass/fail, with a note or screenshot on failure).

## Setup (as admin)

Use real invitations through the app (no hand-made users):

| Account | Role | Site |
|---|---|---|
| Collector A | collector | Mathare |
| Manager M | site_manager | Mathare |
| Manager N | site_manager | Njiru (not Mathare) |

As Collector A, submit **two** deliveries at Mathare, each with a photo
(e.g. reported MIXED 6.00 kg and reported PET 2.00 kg). Wait until History
shows both as **Pending review** (not "Waiting to upload").

## 1. Manager M sees only their sites' deliveries

- [ ] Sign in as Manager M. The **Pending** tab opens and shows "Your sites: Mathare".
- [ ] Both of Collector A's deliveries are listed, newest first.
- [ ] Each card shows Collector A's **name** (not "Name not available"), the site
      (Mathare), reported material, reported weight and submission time.
- [ ] No delivery from any other site appears.

## 2. Delivery detail and photo

- [ ] Tap the newest delivery. The screen shows the collector's name and site.
- [ ] "Reported by collector" shows the reported material and weight, each labelled
      "(reported by collector)".
- [ ] "Device-reported" shows capture time and location, each labelled
      "(device-reported)"; location shows "Not recorded" if the collector denied it.
- [ ] The photo loads and is the photo the collector took.
- [ ] Wait more than 2 minutes, then tap **Reload photo**: the photo loads again
      (a new signed URL is created; the old one has expired).
- [ ] Optional: in Metro logs or a proxy, the photo URL contains `/object/sign/`
      and a `token=`; it is never a `/object/public/` URL.

## 3. Breakdown validation

On the same delivery, in "Verified breakdown":

- [ ] The material chips show only PET, PP, HDPE, LDPE and Plastic bags (no Mixed).
- [ ] Tap **Approve** with no material chosen: "Choose a material." appears and nothing is sent.
- [ ] Enter weight `1.234`: "at most 2 decimals" error on Approve. Enter `0`: same error.
- [ ] After choosing PET on line 1, PET is greyed out on line 2.

## 4. Approve with a two-line breakdown

- [ ] Line 1: PET, `3.25`. Tap **Add material line**. Line 2: Plastic bags, `2.5`.
- [ ] The running total shows **5.75 kg** ("Sum of 2 of 2 lines").
- [ ] Tap **Approve (eligible for payment)**. The confirmation says the verified
      total of 5.75 kg will be recorded and the delivery becomes **eligible for payment**.
- [ ] Confirm. "Delivery approved" appears; OK returns to Pending.
- [ ] The delivery is no longer in Pending.
- [ ] **Reviewed** tab: the delivery shows Status "Approved", Verified PET 3.25 kg,
      Verified Plastic bags 2.50 kg, Verified total 5.75 kg (= the sum), and the
      reported values.

## 5. Reject with a reason

Open the second delivery:

- [ ] Tap **Reject** with an empty reason (or only spaces): "Enter a reason for
      rejecting." appears and nothing is sent.
- [ ] Enter "Bags were wet and full of soil" and tap **Reject**. The confirmation
      repeats the reason and says it will **not** be eligible for payment.
- [ ] Confirm. "Delivery rejected" appears; it leaves Pending.
- [ ] **Reviewed** tab shows "Rejected: Bags were wet and full of soil" and no breakdown.

## 6. Server errors are shown

- [ ] Sign in as Manager M on a second device (or emulator), open a pending delivery
      on both, approve on one, then try to approve or reject on the other: the
      message "Not saved: Only pending collections can be reviewed." appears under
      the button pressed.
- [ ] Optional: open a delivery whose photo has not uploaded yet (e.g. the
      collector submitted offline, the record synced but the photo is still on the
      phone). The photo section and the area under Approve both show "Waiting for
      the collector’s photo to upload", and **Approve** is disabled (tapping it does
      nothing). **Reject** still works: enter a reason, confirm, and the delivery
      leaves Pending and shows as Rejected.
- [ ] Turn on airplane mode and try to review: "Not saved: no connection to Takalex…".

## 7. A manager at another site cannot see it

As Collector A, submit one more delivery at Mathare and leave it pending.

- [ ] Sign in as Manager N (Njiru). Pending shows "Your sites: Njiru" and does
      **not** list Collector A's delivery.
- [ ] Reviewed shows none of Manager M's reviews.

## 8. Collector's History shows the decision

- [ ] Sign in as Collector A and open **History** (it reloads each time the tab is shown).
- [ ] The approved delivery shows Status **Approved** and Verified total 5.75 kg.
- [ ] The rejected delivery shows **Rejected: Bags were wet and full of soil**.
- [ ] The third delivery still shows **Pending review**.

## Database spot check (local, optional)

```sql
-- in `supabase db` psql / Studio, local only
SELECT status, verified_weight_kg, payment_eligible, rejection_reason
FROM collection_logs ORDER BY submitted_at DESC LIMIT 3;
SELECT material_code, weight_kg FROM collection_verified_items;   -- 2 rows, sum 5.75
SELECT action, details->'verified_items', details->>'rejection_reason'
FROM collection_events ORDER BY created_at DESC LIMIT 3;
```
