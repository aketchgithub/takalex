# Phase 5 device checklist: recycler material availability

Run on an Android phone or emulator against the **local** stack
(`docs/dev-device.md`). Migration `008_recycler_material_totals.sql` must be
applied locally (`supabase migration up`, no `--remote` or `--linked`).
Nothing here touches the hosted project. Record pass/fail for each step.

## Setup

Active accounts, invited through the app:

| Account | Role | Site |
|---|---|---|
| Kamau | collector | Njiru |
| Njiru manager | site_manager | Njiru |
| Recycler R | recycler | none |
| Admin | admin | none |

Before starting, sign in as Recycler R and note the **All time / All sites**
totals per material (they may not be zero if earlier tests approved deliveries).
Call these the starting values.

## 1. Approve a two-line delivery from Kamau (Njiru)

- [ ] As Kamau, record a delivery (reported Mixed, 6 kg, with a photo) and wait until
      History shows **Pending review**.
- [ ] As the Njiru manager, open it and approve with two lines: **PET 3.25 kg** and
      **Plastic bags 2.50 kg** (total 5.75 kg).

## 2. The recycler sees those kilograms under the right materials

- [ ] Sign in as Recycler R. The heading reads **"Approved, verified material (all time)"**,
      with the note "All sites. Every approved delivery so far. Totals add up approved
      deliveries; no sales or pickups are deducted."
- [ ] Pull down to refresh: a spinner shows, then the numbers update.
- [ ] PET = starting value + **3.25 kg**; Plastic bags = starting value + **2.50 kg**;
      PP, HDPE and LDPE unchanged. Every row reads "Material: N.NN kg".
- [ ] The **Total** row = the sum of the rows (starting total + 5.75 kg).
- [ ] There is **no Mixed and no Other** row, and no collector names, photos or
      individual deliveries anywhere on the screen.

## 3. Site filter: Njiru shows them, Mathare does not

- [ ] Tap **Njiru**: the note says "Njiru."; PET and Plastic bags include the 3.25 and
      2.50 kg from step 1.
- [ ] Tap **Mathare**: the note says "Mathare."; the step 1 kilograms are **not**
      included (all zeros if Mathare has no approved deliveries).
- [ ] Tap **All sites** again: back to the step 2 numbers.

## 4. Date presets

- [ ] **This month**: the heading changes to "(this month)" and the note to
      "Verified 1 <month> to <today> (Nairobi time)"; step 1's kilograms are included.
- [ ] **Last 30 days**: heading "(last 30 days)"; step 1's kilograms are included.
- [ ] **All time**: back to the step 2 numbers.

## 5. A rejected delivery adds nothing

- [ ] Note the current All time / All sites totals.
- [ ] As Kamau, record another delivery; as the Njiru manager, **reject** it with a reason.
- [ ] As Recycler R, pull to refresh: every total is **unchanged**.

## 6. Empty, loading and error states

- [ ] Choose a site with no approved deliveries (or a period with none): all rows show
      0.00 kg and the message "No approved, verified material yet for this selection."
- [ ] Turn on airplane mode and pull to refresh: "Could not load material totals. Check
      your connection and try again." with **Try again**; turn it off and tap Try again:
      the totals load.

## 7. The recycler cannot open collector or manager screens

- [ ] As Recycler R, there is no navigation to New delivery, History, Pending or Reviewed.
- [ ] Optional (dev build / Expo Go with a deep link): open `/(collector)/log`,
      `/(collector)/history`, `/(manager)` and `/(manager)/reviewed`; each one redirects
      back to the recycler home and shows no data.

## 8. Admin summary (optional)

- [ ] As the admin, the Overview shows the same **"Approved, verified material (all time)"**
      card with the same numbers as the recycler's All time / All sites view.

## Database spot check (local, optional)

```sql
-- local only (Studio SQL editor or psql against the local DB)
SELECT vi.material_code, sum(vi.weight_kg)
FROM collection_verified_items vi JOIN collection_logs c ON c.id = vi.collection_id
WHERE c.status = 'approved' GROUP BY 1 ORDER BY 1;
```
