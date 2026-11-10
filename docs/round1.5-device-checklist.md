# Round 1.5 device checklist: access requests and invitations

Run on an Android phone or emulator against the **local** stack
(`docs/dev-device.md`), with `supabase functions serve` running so the app
uses the updated `invite-user`. Nothing here touches the hosted project.
Record pass/fail for each step, with a note or screenshot on failure.

## 1. Public request with a group

- [ ] Signed out, open **Request access**. Choose role Collector, fill in a full name,
      an email you control (e.g. `picker1@example.test`) and a phone number, and
      choose the group **Njiru**.
- [ ] Submit: the success message appears.
- [ ] Optional: submit a second collector request with a phone number only (no email),
      group Njiru, for step 3.

## 2. Admin approves; code shared; waste picker activates

- [ ] Sign in as the admin. Open **Access**. The **Submitted** filter is selected and the
      new request is at the top (newest first).
- [ ] The card shows the name, contact (email · phone), requested role "Collector" and
      group "Njiru group".
- [ ] Tap **Approve and invite**. The form is pre-filled: name, email, role Collector,
      site Njiru selected. All fields are editable.
- [ ] Change the email to a different address and submit: "The email must match the one
      on the request" appears and nothing is created. Put the original email back.
- [ ] Tap **Approve and create invitation**. The "Request approved" screen shows the
      one-time code, its expiry and "Send it by WhatsApp or SMS to the requester's phone
      (…): that is the expected channel."
- [ ] Tap **Share code**: the share sheet opens with the email, code and instructions.
- [ ] Tap **Done**: back on Access. The request is no longer under Submitted; it is
      under **Invited**.
- [ ] **Invitations** tab (filter Pending): the invitation is listed as Pending, role
      Collector, with its expiry.
- [ ] Sign out. Tap **I have an invitation code**, enter the email, the shared code and a
      new password. Activation succeeds and the app lands on the collector **Home**
      showing the **Njiru group**.

## 3. Request without an email

- [ ] As admin, open the phone-only request from step 1. The card says it has no email.
- [ ] **Approve and invite**: the form shows "No email on this request: confirm it with
      the requester by phone and enter it below", with the email field empty.
- [ ] Submit with the email empty: "Enter the email you confirmed with the requester."
- [ ] Enter an email and submit: the code appears; the request moves to **Invited**.

## 4. Reject with a note

- [ ] Submit another public request (any role). As admin, tap **Reject** on it.
- [ ] Tap **Reject request** with the note empty: "Enter a note explaining the rejection."
- [ ] Enter a note, confirm: the request leaves Submitted and appears under **Rejected**
      with the note shown.

## 5. Revoke a pending invitation; its code then fails

- [ ] Create an invitation (Invite tab or from a request) and note the code.
- [ ] **Invitations** → Pending: tap **Revoke** on it, confirm. It now shows **Revoked**
      (filter Revoked) with the revocation time.
- [ ] Signed out, try to activate with that email and code: activation fails with the
      generic invalid-invitation message.

## 6. Reissue an expired invitation

Expiry is 7 days, so for the test make one invitation expire on the local database
only (Studio SQL editor or `psql` against the local DB, never the hosted project):

```sql
UPDATE public.invitations SET expires_at = now() - interval '1 minute'
WHERE email = '<the test invitation email>' AND status = 'pending';
```

- [ ] Refresh **Invitations**: filter **Expired** shows it as Expired (computed from its
      expiry; no Revoke button, a **Reissue** button).
- [ ] Tap **Reissue**, confirm: "Invitation reissued" shows a new code once, with a new
      7-day expiry and Share.
- [ ] The old code no longer activates; the new code does.
- [ ] A **Revoked** invitation (from step 5) also offers **Reissue**; Accepted ones
      offer no actions.
