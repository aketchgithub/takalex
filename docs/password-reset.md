# "Forgot password?" by SMS or email code

Users reset their own password. No admin action is needed per reset.

- **By SMS (the default):** the user enters the phone number saved on their
  account, receives a code by SMS, and chooses a new password.
- **By email (the option):** the same with the account's email address.

Sign-in itself stays email + password. The app never handles email links,
only codes.

## The SMS switch

SMS is behind a build-time switch, `EXPO_PUBLIC_SMS_PASSWORD_RESET`
(`apps/mobile/src/lib/features.ts`). Only the value `true` turns it on.

- **Off (the default):** "Forgot password?" is by email only, and the phone
  number row, reminder and "Add phone number" button are hidden.
- **On:** SMS is the default reset way, with email as the option, and users can
  add their phone number.

Locally, set `EXPO_PUBLIC_SMS_PASSWORD_RESET=true` in `apps/mobile/.env.local`
and restart Metro with `-c` to test the SMS screens with the test numbers
below. For the APK, the maintainer sets it in the EAS environment `preview`
once an SMS provider is live on the hosted project, then makes a new build.

## Phone numbers on accounts

Signed-in users add their own number: account card > "Add phone number"
(`apps/mobile/src/app/phone-number.tsx`). An SMS code goes to the number and
the number is saved only once the code is confirmed, so it is always one the
user receives texts on. The number lives on the Auth user (`auth.users.phone`)
and is copied to `profiles.phone` by the trigger in migration 002. Until a
user adds a number, their account card reminds them. No admin work and no
database migration are involved.

## Code

- Screens: `apps/mobile/src/app/(auth)/forgot-password.tsx` (linked from the
  login screen) and `apps/mobile/src/app/phone-number.tsx`.
- Rules and messages: `apps/mobile/src/lib/passwordReset.ts`,
  `apps/mobile/src/lib/phoneNumber.ts` (Kenyan forms such as 0712 345 678 are
  converted to +254712345678).
- Supabase calls, in `apps/mobile/src/stores/authStore.ts`:
  - SMS reset: `signInWithOtp({ phone, options: { shouldCreateUser: false } })`,
    then `verifyOtp({ phone, token, type: "sms" })`
  - email reset: `resetPasswordForEmail`, then `verifyOtp({ email, token, type: "recovery" })`
  - both: `updateUser({ password })`
  - adding a number: `updateUser({ phone })`, then `verifyOtp({ phone, token, type: "phone_change" })`

Behaviour:

- The request step answers the same way whether or not the number or email has
  an account (Auth's "Signups not allowed for otp" answer for an unknown number
  is shown as "code sent").
- Checking the code signs the user in. Until the new password is saved,
  `isResettingPassword` keeps them on the reset screen; leaving signs them out.
- A code by SMS also proves the user holds that phone, so whoever has the SIM
  can reset the password. That is the intended trade-off for users without
  reliable email.

## Local testing

`supabase/config.toml`:

- **SMS:** the phone provider is on with placeholder Twilio values (local only)
  and two test numbers with fixed codes. No SMS is sent:
  - 0700 000 001, code 123456
  - 0700 000 002, code 654321
- **Email:** every email goes to the local test inbox (Mailpit; `supabase status`
  shows its URL). Template: `supabase/templates/recovery.html`.

After changing `config.toml` or the template, restart the stack:
`supabase stop && supabase start` (local data is kept).

## Going live on the hosted project (maintainer only)

Until these steps are done, the app shows "Password reset by email (or SMS) is
not switched on yet".

### SMS

1. Chemolex chooses an SMS provider and opens an account (it pays per message):
   - **Twilio:** built into Supabase; only the dashboard settings below.
   - **Africa's Talking** (Kenyan): not built in. It needs a small Edge
     Function as a "Send SMS hook", which is a separate task to build, test
     and deploy.
2. Dashboard > Authentication > Sign In / Providers > Phone: enable it, choose
   the provider, enter its credentials. Keep "Allow new users to sign up" off
   for the project.
3. Set the SMS message to `Your Takalex code is {{ .Code }}` and the SMS OTP
   expiry to a few minutes (for example 600 seconds); SMS can be slow.
4. Set `EXPO_PUBLIC_SMS_PASSWORD_RESET=true` in the EAS environment `preview`
   and make a new build (the SMS screens are hidden in builds without it).
5. Test: add your own number in the app, then reset a test account's password
   by SMS.

### Email

1. Chemolex sets up a sending service for a sender such as
   `no-reply@<chemolex domain>` and adds its DNS records (SPF, DKIM).
2. Dashboard > Authentication > SMTP Settings: enter the service's host, port,
   user, password, sender address and sender name ("Takalex").
3. Dashboard > Authentication > Email Templates > Reset password: paste the
   subject and HTML from `supabase/templates/recovery.html`. The code must
   appear as `{{ .Token }}`.
4. Dashboard > Authentication: check that the email OTP length is 8 and the
   email OTP expiry is 3600 seconds (the email says "one hour").
5. Test with an account that uses your own Gmail address: the email arrives (and
   whether it lands in spam), the code works once, the new password signs in.

### Both

- Optional, recommended: set the minimum password length to 8, matching the app.
- Email needs no app update, as long as the installed version includes the
  "Forgot password?" screen. SMS needs a new build with the switch on (SMS
  step 4).
