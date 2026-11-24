# Admin website

The admin screens also run in a web browser, for the office administrator on a
laptop. It is the same app (Expo web): admins get a sidebar on wide screens;
every other role is told to use the phone app (`src/lib/webAccess.ts`). It talks
to the same hosted Supabase project as the preview APK, with the same
row-level security.

## Build (maintainer, from WSL)

The website is a folder of static files. The Supabase values are built into
it, like the APK, so build with the **hosted** values given on the command line
(they take precedence over `.env` / `.env.local`, which point at the local
stack). The publishable key is public by design (Dashboard > Project Settings >
API Keys > Publishable key); never use a secret or service-role key here.

```bash
cd ~/Development/code/TAKALEX/apps/mobile
rm -rf dist
EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co \
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key> \
EXPO_PUBLIC_SMS_PASSWORD_RESET=false \
npx expo export --platform web
```

Check the result before uploading:

```bash
ls dist/index.html dist/_redirects
grep -rl "127.0.0.1:54321" dist || echo "no local address: ok"
grep -rl "<project-ref>.supabase.co" dist | head -1
```

`dist/` is ignored by git; never commit it.

## Host (Netlify, upload by hand)

1. Netlify > Add new site > Deploy manually, then drag the `dist` folder onto
   the page (from Windows: `\\wsl$\Ubuntu\home\<user>\Development\code\TAKALEX\apps\mobile\dist`).
2. Site configuration > Change site name, e.g. `takalex-admin`, giving
   `https://takalex-admin.netlify.app`.
3. To update the site later: build again and drag the new `dist` onto the
   site's Deploys page. Earlier deploys stay listed and can be restored.

`public/_redirects` (copied into `dist/`) sends every path to `index.html`, so
reloading or opening a link such as `/sites` works.

## A Chemolex address (optional)

To use e.g. `admin.chemolex.co.ke`: Netlify > Domain management > Add a domain,
then add the CNAME record Netlify shows in cPanel > Zone Editor. HTTPS is set up
by Netlify once the record is live.

## Check after each upload

On the live address, signed in as the hosted admin: Overview with Analytics,
Access requests, Invitations (and Invite), Sites, Materials, Account; a
deactivate / reactivate confirms in the browser. Signed in as any other role:
"Use the Takalex app".
