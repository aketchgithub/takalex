# Running the app on an Android phone against the local stack

This setup runs the local Supabase stack and Metro inside WSL, with a phone
connected over USB. `adb reverse` maps the phone's own `127.0.0.1` ports to
the Windows host. WSL2 forwards Windows `localhost` to WSL, and Docker
Desktop publishes the stack's ports there too. The app can then use
`http://127.0.0.1:54321` on the phone exactly as it does on the computer: there
is no LAN IP, firewall rule or Wi-Fi network involved.

Nothing here touches the hosted project.

## 1. Local stack (WSL, Terminal 1)

```bash
cd ~/Development/code/TAKALEX
supabase start                       # if not already running
supabase functions serve             # leave running (invite-user, accept-invitation)
```

The first admin, once per database reset:

```bash
supabase/scripts/dev-admin.sh
```

## 2. `apps/mobile/.env.local`

`.env.local` is gitignored and overrides `.env`. For the local stack it needs:

```
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<the sb_publishable_... key from `supabase status`>
```

Only the **publishable** key goes here. Never put the secret or service-role key
here: every `EXPO_PUBLIC_*` value is bundled into the app. After changing the
file, restart Metro with `-c` so the new values are picked up.

## 3. USB port forwarding (Windows, PowerShell)

Use `adb.exe` from the Windows
[Android SDK Platform-Tools](https://developer.android.com/tools/releases/platform-tools),
not an `adb` inside WSL, since WSL cannot see the USB device.

1. On the phone, enable Developer options and USB debugging. Connect the
   cable and accept the "Allow USB debugging" prompt.
2. In PowerShell, from the Platform-Tools folder:

   ```powershell
   .\adb.exe devices                        # the phone must be listed as "device"
   .\adb.exe reverse tcp:54321 tcp:54321    # Supabase API (Auth, REST, Edge Functions)
   .\adb.exe reverse tcp:8081 tcp:8081      # Metro bundler
   .\adb.exe reverse --list                 # check both are there
   ```

The mappings are lost when the cable is unplugged or adb restarts. Run the two
`reverse` commands again after that.

## 4. Metro (WSL, Terminal 2)

```bash
cd ~/Development/code/TAKALEX/apps/mobile
npx expo start --localhost
```

`--localhost` makes the dev server advertise `127.0.0.1:8081`, which `adb reverse`
maps to the phone.

## 5. Open the app in Expo Go

In Expo Go on the phone, choose **Enter URL manually** and open:

```
exp://127.0.0.1:8081
```

Or start it from PowerShell:

```powershell
.\adb.exe shell am start -a android.intent.action.VIEW -d exp://127.0.0.1:8081
```

## Troubleshooting

- **"Network request failed" on sign-in:** check `adb reverse --list` shows
  54321, that `supabase status` reports the stack running, and that
  `.env.local` uses `http://127.0.0.1:54321`. As a quick check, open
  `http://127.0.0.1:54321/auth/v1/health` in the phone's browser. It should
  answer with JSON.
- **Activation or invite fails with "Could not reach Takalex":** check that
  `supabase functions serve` is still running.
- **Expo Go cannot load the bundle:** check that `adb reverse --list` shows
  8081, and that Metro was started with `--localhost`.
- **Expo Go reports a missing native module:** the app then needs a
  development build instead of Expo Go (see `apps/mobile/AGENTS.md`).
