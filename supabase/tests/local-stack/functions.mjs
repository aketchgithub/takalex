#!/usr/bin/env node
// Edge Function checks for invite-user and accept-invitation, against the
// LOCAL Supabase stack only.
//
//   node supabase/tests/local-stack/functions.mjs
//
// Needs, in this order: the local stack running (`supabase start`), the
// functions being served (`supabase functions serve`), and an active dev
// admin (supabase/scripts/dev-admin.sh). The dev admin's password is read
// from DEV_ADMIN_PASSWORD or, if that is unset, from a hidden prompt; its
// email is looked up in the database (or taken from DEV_ADMIN_EMAIL when
// several admins exist).
//
// Safety, as in smoke.sh:
// - URLs and keys come from `supabase status -o env` at runtime; refuses
//   unless the API URL is http://127.0.0.1:<port> and the DB URL is exactly
//   postgresql://user:pass@127.0.0.1:<port>/<db> (anchored).
// - Refuses if Node is told to use proxy variables (NODE_USE_ENV_PROXY or
//   --use-env-proxy); fetch never follows redirects.
// - libpq PG* variables are dropped; the DB password reaches psql through
//   its environment only. DEV_ADMIN_PASSWORD is removed from the environment
//   before any child process starts.
// - Keys, codes, passwords and tokens are never printed or put on a command
//   line. Codes and code hashes are compared inside this process.
// - Every test user has an email fn-<run>-*@example.test; all of them are
//   deleted on exit, including on failure or Ctrl-C. The dev admin is never
//   modified (checked before and after).
// - Exits 1 if any check fails, 2 if it refuses to run.
//
// Uses Node built-ins only (Node 22+), plus the supabase, psql and docker CLIs.
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function refuse(message) {
  console.error(`refusing: ${message}`);
  process.exit(2);
}

// ------------------------------------------------------------------ env
if (process.env.NODE_USE_ENV_PROXY || /--use-env-proxy/.test(process.env.NODE_OPTIONS ?? "")) {
  refuse("Node is configured to use proxy variables (NODE_USE_ENV_PROXY / --use-env-proxy)");
}

// Read and remove the admin password before any child process inherits it.
let adminPassword = process.env.DEV_ADMIN_PASSWORD;
delete process.env.DEV_ADMIN_PASSWORD;

let envOut;
try {
  envOut = execFileSync("supabase", ["status", "-o", "env"], {
    cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
  });
} catch {
  refuse("`supabase status` failed (is the local stack running?)");
}
const env = Object.fromEntries(
  [...envOut.matchAll(/^([A-Z_]+)="(.*)"$/gm)].map((m) => [m[1], m[2]]),
);
envOut = undefined;
const API = env.API_URL ?? "";
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(API)) refuse("API_URL is not http://127.0.0.1:<port>");
const dbm = /^postgres(?:ql)?:\/\/([^:@/?#]+):([^@/?#]+)@127\.0\.0\.1:(\d+)\/([A-Za-z0-9_]+)$/.exec(env.DB_URL ?? "");
if (!dbm) refuse("DB_URL is not postgresql://user:pass@127.0.0.1:<port>/<db>");
const SR = env.SERVICE_ROLE_KEY;
const ANON = env.ANON_KEY;
if (!SR || !ANON) refuse("ANON_KEY or SERVICE_ROLE_KEY missing from supabase status");

const projectId = /^project_id\s*=\s*"([A-Za-z0-9_-]+)"/m.exec(
  readFileSync(join(REPO, "supabase", "config.toml"), "utf8"),
)?.[1];
if (!projectId) refuse("project_id not found in supabase/config.toml");

const pgEnv = {
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("PG"))),
  PGHOST: "127.0.0.1", PGUSER: dbm[1], PGPASSWORD: dbm[2], PGPORT: dbm[3], PGDATABASE: dbm[4],
};
// SQL text may contain test emails and UUIDs, never codes, hashes or passwords.
function sql(query) {
  return execFileSync("psql", ["-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-c", query], {
    env: pgEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

// ------------------------------------------------------------------ http
async function call(method, path, { body, rawBody, bearer, apikey = ANON } = {}) {
  const headers = { apikey, "Content-Type": "application/json" };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const t0 = performance.now();
  const res = await fetch(API + path, {
    method, headers, redirect: "error",
    body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const text = await res.text();
  return { status: res.status, text, headers: res.headers, ms: performance.now() - t0 };
}
const parse = (r) => { try { return JSON.parse(r.text); } catch { return null; } };

// ------------------------------------------------------------------ results
let failures = 0;
function check(ok, label, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
}
function section(title) { console.log(`\n-- ${title}`); }

// ------------------------------------------------------------------ hidden prompt
function promptHidden(question) {
  return new Promise((resolve, reject) => {
    const { stdin, stderr } = process;
    if (!stdin.isTTY) {
      reject(new Error("DEV_ADMIN_PASSWORD is unset and stdin is not a terminal"));
      return;
    }
    let value = "";
    const finish = () => { stdin.off("data", onData); stdin.setRawMode(false); stdin.pause(); stderr.write("\n"); };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") { finish(); resolve(value); return; }
        if (ch === "\u0003") { finish(); process.exit(130); }        // Ctrl-C: nothing created yet
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    stderr.write(question);
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.on("data", onData);
    stdin.resume();
  });
}

// ------------------------------------------------------------------ preflight (nothing created yet)
const admins = sql(`SELECT u.email FROM auth.users u JOIN public.profiles p ON p.id = u.id
  WHERE p.role = 'admin' AND p.is_active ORDER BY u.created_at`).split("\n").filter(Boolean);
let adminEmail;
if (process.env.DEV_ADMIN_EMAIL) {
  adminEmail = process.env.DEV_ADMIN_EMAIL.trim().toLowerCase();
  if (!admins.includes(adminEmail)) refuse("DEV_ADMIN_EMAIL is not an active admin on the local stack");
} else if (admins.length === 1) {
  adminEmail = admins[0];
} else if (admins.length === 0) {
  refuse("no active dev admin on the local stack (run supabase/scripts/dev-admin.sh)");
} else {
  refuse("several active admins exist; set DEV_ADMIN_EMAIL to choose one");
}
// Fingerprint of the admin's rows (md5 only; nothing secret is printed).
const adminFingerprint = () => sql(`SELECT u.id || ':' || md5(row(u.email, u.encrypted_password,
    u.email_confirmed_at, u.banned_until, u.deleted_at, p.role, p.is_active, p.full_name)::text)
  FROM auth.users u JOIN public.profiles p ON p.id = u.id WHERE u.email = ${lit(adminEmail)}`);
const adminBefore = adminFingerprint();
const ADMIN_ID = adminBefore.split(":")[0];

const probe = await call("POST", "/functions/v1/accept-invitation", { body: {} }).catch(() => null);
if (!probe || probe.status !== 400 || parse(probe)?.code !== "invalid_input") {
  refuse(`accept-invitation is not answering on ${API} (is \`supabase functions serve\` running?)`);
}

if (!adminPassword) {
  try { adminPassword = await promptHidden(`Password for dev admin ${adminEmail}: `); }
  catch (err) { refuse(err.message); }
}
if (!adminPassword) refuse("empty dev admin password");

// ------------------------------------------------------------------ run state
const RUN = `${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
const PATTERN = `fn-${RUN}-%@example.test`;
const email = (k) => `fn-${RUN}-${k}@example.test`;
const pw = () => `Pw-${randomBytes(12).toString("base64url")}`;
const secrets = new Set([adminPassword]);   // every code and password used, for the log scan
const codes = new Set();                    // invitation codes (also scanned in normalised form)
const codeByInvitation = new Map();         // invitationId -> plain code
const emailsUsed = new Set();
const runStart = new Date();

const normalise = (code) => code.toUpperCase().replace(/[\s-]/g, "");
const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const sites = sql(`SELECT id FROM public.sites WHERE active ORDER BY name LIMIT 3`).split("\n").filter(Boolean);
let ADMIN_JWT;

// ------------------------------------------------------------------ helpers
function remember(j) {
  secrets.add(j.code); codes.add(j.code); codeByInvitation.set(j.invitationId, j.code);
}
// bearer omitted (undefined) = the dev admin's JWT; null = no Authorization
// header at all (apikey only). Never pass undefined to mean "no header".
function inviteRaw(body, bearer = ADMIN_JWT) {
  if (typeof body?.email === "string") emailsUsed.add(body.email.trim().toLowerCase());
  return call("POST", "/functions/v1/invite-user", { body, bearer });
}
async function invite(k, { role = "collector", siteIds = [sites[0], sites[1]], fullName = `Fn ${k}` } = {}) {
  const e = email(k);
  const body = { action: "create", email: e, fullName, role };
  if (siteIds !== undefined) body.siteIds = siteIds;
  const r = await inviteRaw(body);
  const j = parse(r);
  if (r.status !== 201 || !j?.code) throw new Error(`invite ${k} failed: ${r.status} ${j?.error ?? ""}`);
  remember(j);
  return { email: e, code: j.code, invitationId: j.invitationId, r, j };
}
async function reissueRaw(invitationId, extra = {}, bearer = ADMIN_JWT) {
  const r = await call("POST", "/functions/v1/invite-user", {
    bearer, body: { action: "reissue", invitationId, ...extra },
  });
  const j = parse(r);
  if (r.status === 201 && j?.code) remember(j);
  return { r, j };
}
async function reissue(invitationId, siteIds) {
  const { r, j } = await reissueRaw(invitationId, siteIds ? { siteIds } : {});
  if (r.status !== 201 || !j?.code) throw new Error(`reissue failed: ${r.status} ${j?.error ?? ""}`);
  return { code: j.code, invitationId: j.invitationId };
}
async function revoke(invitationId) {
  const r = await call("POST", "/rest/v1/rpc/revoke_invitation", {
    bearer: ADMIN_JWT, body: { p_invitation_id: invitationId },
  });
  if (r.status !== 200) throw new Error(`revoke failed: ${r.status}`);
}
function accept(e, code, password) {
  if (password.length >= 8) secrets.add(password);
  return call("POST", "/functions/v1/accept-invitation", { body: { email: e, code, password } });
}
async function signInToken(e, password) {
  const r = await call("POST", "/auth/v1/token?grant_type=password", { body: { email: e, password } });
  const at = parse(r)?.access_token;
  return r.status === 200 && at ? at : null;
}
const signIn = async (e, password) => !!(await signInToken(e, password));

const userExists = (e) => sql(`SELECT count(*) FROM auth.users WHERE email = ${lit(e)}`) !== "0";
const runUserCount = () => Number(sql(`SELECT count(*) FROM auth.users WHERE email LIKE ${lit(PATTERN)}`));
const state = (invId) => {
  const [status, attempts, claim, supersededBy, revoked] = sql(`SELECT status, failed_attempts,
      (claim_token IS NOT NULL), coalesce(superseded_by::text, ''), (revoked_at IS NOT NULL)
    FROM public.invitations WHERE id = ${lit(invId)}`).split("|");
  return { status, attempts: Number(attempts), claimed: claim === "t", supersededBy, revoked: revoked === "t" };
};
const invitationRow = (invId) => {
  const [mail, role, invitedBy, expiresAt] = sql(`SELECT email, role, invited_by,
      extract(epoch FROM expires_at)::bigint FROM public.invitations WHERE id = ${lit(invId)}`).split("|");
  return { email: mail, role, invitedBy, expiresAt: Number(expiresAt) * 1000 };
};
const profile = (e) => {
  const [active, role, nsites, confirmed, haspw, fullName] = sql(`SELECT p.is_active, p.role,
      (SELECT count(*) FROM public.user_sites s WHERE s.user_id = p.id),
      (u.email_confirmed_at IS NOT NULL), (coalesce(u.encrypted_password, '') <> ''), p.full_name
    FROM public.profiles p JOIN auth.users u ON u.id = p.id WHERE u.email = ${lit(e)}`).split("|");
  return { active: active === "t", role, sites: Number(nsites), confirmed: confirmed === "t",
           hasPassword: haspw === "t", fullName };
};
// Digest of the stored password hash (never the hash itself), to detect changes.
const pwDigest = (e) => sql(`SELECT md5(coalesce(encrypted_password, '<null>')) || ':' || length(coalesce(encrypted_password, ''))
  FROM auth.users WHERE email = ${lit(e)}`);
const siteSet = (e) => sql(`SELECT coalesce(string_agg(s.site_id::text, ',' ORDER BY s.site_id), '')
  FROM public.user_sites s JOIN auth.users u ON u.id = s.user_id WHERE u.email = ${lit(e)}`);
const sorted = (ids) => [...ids].sort().join(",");
const sevenDays = (ms) => Math.abs(ms - (Date.now() + 7 * 864e5)) < 5 * 60e3;

const invalidResponses = [];   // [label, response]
function expectInvalid(label, r) {
  invalidResponses.push([label, r]);
  check(r.status === 400 && parse(r)?.code === "invalid_invitation", `${label}: generic invalid-invitation`,
    `${r.status}, ${Math.round(r.ms)} ms`);
}

// ------------------------------------------------------------------ invite-user
async function inviteUserAccess() {
  section("invite-user: callers");
  const base = (k) => ({ action: "create", email: email(k), fullName: `Fn ${k}`, role: "collector", siteIds: [sites[0]] });
  const before = runUserCount();
  const cases = [
    ["missing Authorization header (apikey only)", "deny-none", null],
    ["malformed bearer token", "deny-junk", "not-a-jwt"],
    ["anon key as bearer", "deny-anon", ANON],
    ["service role key as bearer (no user)", "deny-sr", SR],
  ];
  for (const [label, k, bearer] of cases) {
    const r = await inviteRaw(base(k), bearer);
    check(r.status === 401 && !userExists(email(k)), `${label} -> 401, no Auth user`, `${r.status}`);
  }
  check(runUserCount() === before, "denied callers created no Auth users");
}

async function inviteUserRoles() {
  section("invite-user: create, every role");
  const cases = [
    ["collector, two sites", "r-coll", "collector", [sites[0], sites[1]]],
    ["site_manager, one site", "r-sm", "site_manager", [sites[2]]],
    ["recycler, one site", "r-rec", "recycler", [sites[0]]],
    ["recycler, siteIds omitted", "r-rec-none", "recycler", undefined],
    ["recycler, siteIds []", "r-rec-empty", "recycler", []],
  ];
  const created = {};
  for (const [label, k, role, siteIds] of cases) {
    const fullName = `  Fn ${k}  `;
    const e = email(k);
    const body = { action: "create", email: k === "r-rec-none" ? `  ${e.toUpperCase()} ` : e, fullName, role };
    if (siteIds !== undefined) body.siteIds = siteIds;
    const r = await inviteRaw(body);
    const j = parse(r);
    const shapeOk = r.status === 201 && CODE_RE.test(j?.code ?? "") && UUID_RE.test(j?.invitationId ?? "") &&
      sevenDays(Date.parse(j?.expiresAt)) && r.headers.get("cache-control") === "no-store";
    if (j?.code) remember(j);
    check(shapeOk, `${label}: 201, code format, 7-day expiry, no-store`, `${r.status}${j?.error ? ` ${j.error}` : ""}`);
    if (!shapeOk) continue;
    // GoTrue stores a random password hash at createUser, so "no password" is
    // not testable. Instead: nobody can sign in, and the hash is never changed
    // by invite-user (rechecked after the duplicate invite and reissues).
    const digest = pwDigest(e);
    const p = profile(e);
    const inv = invitationRow(j.invitationId);
    const st = state(j.invitationId);
    check(p.role === role && !p.active && !p.confirmed && p.fullName === `Fn ${k}` &&
      siteSet(e) === sorted(siteIds ?? []),
      `${label}: profile ${role}, inactive, unconfirmed, trimmed name, sites as sent`);
    const blocked = !(await signIn(e, j.code)) && !(await signIn(e, normalise(j.code))) && !(await signIn(e, pw()));
    check(blocked && pwDigest(e) === digest,
      `${label}: cannot sign in (code, normalised code, random password); stored hash unchanged`);
    check(inv.email === e && inv.role === role && inv.invitedBy === ADMIN_ID && st.status === "pending" &&
      st.attempts === 0 && !st.claimed && Math.abs(inv.expiresAt - Date.parse(j.expiresAt)) < 1000,
      `${label}: invitation pending, lowercase email, invited_by admin, expiry matches response`);
    created[k] = { email: e, invitationId: j.invitationId, code: j.code, digest };
  }
  return created;
}

async function inviteUserInvalidInput() {
  section("invite-user: invalid input (no Auth user created)");
  const before = runUserCount();
  const ok = (k, extra) => ({ action: "create", email: email(k), fullName: `Fn ${k}`, role: "collector", siteIds: [sites[0]], ...extra });
  const tooMany = Array.from({ length: 51 }, () => randomUUID());
  const cases = [
    ["invalid JSON", "bad-json", { rawBody: "{not json" }, /valid JSON/],
    ["body is an array", "bad-array", { body: [] }, /Invalid request body/],
    ["missing action", "bad-noaction", { body: { ...ok("bad-noaction"), action: undefined } }, /action must be/],
    ["unknown action", "bad-action", { body: ok("bad-action", { action: "delete" }) }, /action must be/],
    ["malformed email", "bad-email", { body: ok("bad-email", { email: "not-an-email" }) }, /valid email/],
    ["one-character name", "bad-name", { body: ok("bad-name", { fullName: " x " }) }, /Full name/],
    ["121-character name", "bad-long", { body: ok("bad-long", { fullName: "x".repeat(121) }) }, /Full name/],
    ["role admin", "bad-admin", { body: ok("bad-admin", { role: "admin" }) }, /valid invitation role/],
    ["role missing", "bad-norole", { body: ok("bad-norole", { role: undefined }) }, /valid invitation role/],
    ["collector without siteIds", "bad-nosites", { body: ok("bad-nosites", { siteIds: undefined }) }, /at least one site/],
    ["site_manager with siteIds []", "bad-sm-empty", { body: ok("bad-sm-empty", { role: "site_manager", siteIds: [] }) }, /at least one site/],
    ["siteIds not UUIDs", "bad-siteid", { body: ok("bad-siteid", { siteIds: ["abc"] }) }, /Site selection is invalid/],
    ["siteIds not an array", "bad-sitestr", { body: ok("bad-sitestr", { siteIds: sites[0] }) }, /Site selection is invalid/],
    ["duplicate siteIds", "bad-dup", { body: ok("bad-dup", { siteIds: [sites[0], sites[0].toUpperCase()] }) }, /Duplicate site/],
    ["51 siteIds", "bad-many", { body: ok("bad-many", { siteIds: tooMany }) }, /Site selection is invalid/],
  ];
  for (const [label, k, req, msg] of cases) {
    emailsUsed.add(email(k));
    const r = await call("POST", "/functions/v1/invite-user", { ...req, bearer: ADMIN_JWT });
    const j = parse(r);
    check(r.status === 400 && msg.test(j?.error ?? "") && !userExists(email(k)),
      `${label} -> 400 with a specific message, no Auth user`, `${r.status} ${j?.error ?? ""}`);
  }
  check(!userExists("not-an-email"), "malformed email created no Auth user");
  check(runUserCount() === before, "invalid input created no Auth users", `${runUserCount() - before} new`);
}

async function inviteUserRegistrationFailure(existing) {
  section("invite-user: registration failure removes the new Auth user");
  for (const [label, k, role] of [["collector", "fail-coll", "collector"], ["recycler", "fail-rec", "recycler"]]) {
    const r = await inviteRaw({ action: "create", email: email(k), fullName: `Fn ${k}`, role, siteIds: [randomUUID()] });
    const j = parse(r);
    check(r.status === 400 && /do not exist or are inactive/.test(j?.error ?? "") && !userExists(email(k)),
      `${label} with an unknown site -> 400, Auth user deleted again`, `${r.status} ${j?.error ?? ""}`);
  }
  const again = await invite("fail-coll", { siteIds: [sites[0]] });
  check(again.r.status === 201, "the same email can then be invited normally");

  const dupBefore = sql(`SELECT id FROM auth.users WHERE email = ${lit(existing.email)}`);
  const r = await inviteRaw({ action: "create", email: existing.email, fullName: "Fn dup", role: "collector", siteIds: [sites[0]] });
  const st = state(existing.invitationId);
  check(r.status === 409 && sql(`SELECT id FROM auth.users WHERE email = ${lit(existing.email)}`) === dupBefore &&
    st.status === "pending" && pwDigest(existing.email) === existing.digest,
    "email of an existing invited user -> 409; that user (and its stored hash) and invitation are untouched", `${r.status}`);
}

async function inviteUserReissue(created, active) {
  section("invite-user: reissue rules");
  const sm = created["r-sm"];

  // Pending and unexpired: refused, nothing changes.
  const hashBefore = sql(`SELECT md5(code_hash) FROM public.invitations WHERE id = ${lit(sm.invitationId)}`);
  let { r } = await reissueRaw(sm.invitationId);
  check(r.status === 409 && /Only expired or revoked/.test(parse(r)?.error ?? "") &&
    state(sm.invitationId).status === "pending" && pwDigest(sm.email) === sm.digest &&
    sql(`SELECT md5(code_hash) FROM public.invitations WHERE id = ${lit(sm.invitationId)}`) === hashBefore,
    "pending, unexpired invitation -> 409, unchanged", `${r.status}`);

  ({ r } = await reissueRaw(randomUUID()));
  check(r.status === 404, "unknown invitation id -> 404", `${r.status}`);
  ({ r } = await reissueRaw("not-a-uuid"));
  check(r.status === 400 && /valid invitation ID/.test(parse(r)?.error ?? ""), "malformed invitation id -> 400", `${r.status}`);

  // Expired: reissue with nothing else carries name, role and sites over.
  const x = await invite("re-exp", { role: "site_manager", siteIds: [sites[1]], fullName: "Expire Me" });
  sql(`UPDATE public.invitations SET expires_at = now() - interval '1 second' WHERE id = ${lit(x.invitationId)}`);
  const xDigest = pwDigest(x.email);
  let res = await reissueRaw(x.invitationId);
  const xs = state(x.invitationId);
  const xp = profile(x.email);
  check(res.r.status === 201 && xs.status === "superseded" && xs.supersededBy === res.j?.invitationId && !xs.revoked,
    "expired invitation -> 201; old row superseded, points at the new one", `${res.r.status}`);
  if (res.r.status === 201) {
    const n = invitationRow(res.j.invitationId);
    check(state(res.j.invitationId).status === "pending" && n.role === "site_manager" && n.invitedBy === ADMIN_ID &&
      sevenDays(n.expiresAt) && xp.fullName === "Expire Me" && xp.role === "site_manager" && !xp.active &&
      siteSet(x.email) === sites[1],
      "reissue without overrides keeps name, role and sites; new 7-day pending row");
    check(pwDigest(x.email) === xDigest && !(await signIn(x.email, res.j.code)),
      "reissue leaves the stored hash unchanged; the new code is not a password");
    expectInvalid("code of an expired, reissued invitation", await accept(x.email, x.code, pw()));
    res = await reissueRaw(x.invitationId);
    check(res.r.status === 409, "reissuing a superseded invitation -> 409", `${res.r.status}`);
  }

  // Revoked: overrides replace name, role and sites; revocation audit kept.
  const y = await invite("re-rev", { siteIds: [sites[0], sites[1]] });
  await revoke(y.invitationId);
  const yDigest = pwDigest(y.email);
  res = await reissueRaw(y.invitationId, { role: "site_manager", siteIds: [sites[2]], fullName: "  Renamed Person " });
  const ys = state(y.invitationId);
  const yp = profile(y.email);
  check(res.r.status === 201 && ys.status === "superseded" && ys.revoked && ys.supersededBy === res.j?.invitationId,
    "revoked invitation -> 201; old row superseded, revocation audit kept", `${res.r.status}`);
  check(yp.role === "site_manager" && yp.fullName === "Renamed Person" && siteSet(y.email) === sites[2] &&
    res.j && invitationRow(res.j.invitationId).role === "site_manager" && pwDigest(y.email) === yDigest,
    "reissue overrides replace role, trimmed name and sites; stored hash unchanged");

  // Site rules on reissue.
  const z = await invite("re-sites", { siteIds: [sites[0]] });
  await revoke(z.invitationId);
  res = await reissueRaw(z.invitationId, { siteIds: [] });
  check(res.r.status === 400 && /at least one site/.test(res.j?.error ?? "") && state(z.invitationId).status === "revoked" &&
    siteSet(z.email) === sites[0],
    "collector reissue with siteIds [] -> 400, still revoked, sites unchanged", `${res.r.status}`);
  res = await reissueRaw(z.invitationId, { role: "recycler", siteIds: [] });
  check(res.r.status === 201 && profile(z.email).role === "recycler" && siteSet(z.email) === "",
    "reissue as recycler with no sites -> 201, no user_sites", `${res.r.status}`);
  res = await reissueRaw(z.invitationId, { role: "admin" });
  check(res.r.status === 400, "reissue with role admin -> 400", `${res.r.status}`);

  // Non-admin caller.
  res = await reissueRaw(z.invitationId, {}, active.jwt);
  check(res.r.status === 403, "non-admin (active collector) reissue -> 403", `${res.r.status}`);

  // Accepted invitation; then an active profile; then an inactive profile
  // that has an accepted invitation. A stray revoked row is inserted for the
  // accepted user directly, because the API cannot produce one.
  res = await reissueRaw(active.invitationId);
  check(res.r.status === 409, "accepted invitation -> 409", `${res.r.status}`);
  const strayId = sql(`INSERT INTO public.invitations
      (auth_user_id, email, invited_by, role, code_hash, expires_at, status, revoked_at, revoked_by)
    SELECT id, email, ${lit(ADMIN_ID)}, 'collector', md5(random()::text) || md5(random()::text),
           now() + interval '7 days', 'revoked', now(), ${lit(ADMIN_ID)}
    FROM auth.users WHERE email = ${lit(active.email)} RETURNING id`);
  res = await reissueRaw(strayId);
  check(res.r.status === 409 && /already active/.test(res.j?.error ?? "") && state(strayId).status === "revoked",
    "revoked invitation of an active user -> 409 (already active)", `${res.r.status} ${res.j?.error ?? ""}`);
  sql(`UPDATE public.profiles SET is_active = false WHERE id = (SELECT id FROM auth.users WHERE email = ${lit(active.email)})`);
  res = await reissueRaw(strayId);
  check(res.r.status === 409 && /already accepted/.test(res.j?.error ?? "") && state(strayId).status === "revoked",
    "inactive user with an accepted invitation -> 409 (already accepted)", `${res.r.status} ${res.j?.error ?? ""}`);
}

// ------------------------------------------------------------------ accept-invitation
async function acceptInvitation() {
  section("accept-invitation");
  // 1. happy path (code typed lowercase with spaces: normalisation is shared)
  const a = await invite("happy");
  const pa = pw();
  const typed = a.code.toLowerCase().replace(/-/g, " ");
  const r1 = await accept(a.email, typed, pa);
  check(r1.status === 200 && r1.text === '{"ok":true}', "correct code + password -> 200 {ok:true}", `${r1.status}, ${Math.round(r1.ms)} ms`);
  const jwt = await signInToken(a.email, pa);
  check(!!jwt, "sign-in with the new password works");
  const p1 = profile(a.email);
  check(p1.active && p1.role === "collector" && p1.confirmed, "profile active, role collector, email confirmed");
  check(siteSet(a.email) === sorted([sites[0], sites[1]]), "user_sites are the two invited sites");
  const s1 = state(a.invitationId);
  check(s1.status === "accepted" && !s1.claimed, "invitation accepted, claim cleared");

  // 2. reuse accepted code; wrong email
  expectInvalid("reuse of an accepted code", await accept(a.email, a.code, pw()));
  check(await signIn(a.email, pa), "reuse did not change the password");
  const b = await invite("wrongemail");
  expectInvalid("wrong email (right code)", await accept(email("nobody"), b.code, pw()));
  check(state(b.invitationId).attempts === 0, "wrong email counts no attempt on the real invitation");

  // 3. lockout
  const c = await invite("lock");
  const cBefore = pwDigest(c.email);
  for (let i = 1; i <= 5; i++) {
    const wrong = `WRNG-${i}${i}${i}${i}-ZZZZ`;
    secrets.add(wrong);
    expectInvalid(`wrong code #${i}`, await accept(c.email, wrong, pw()));
  }
  check(state(c.invitationId).attempts === 5, "five wrong codes -> failed_attempts = 5");
  const pc = pw();
  expectInvalid("correct code after lockout", await accept(c.email, c.code, pc));
  check(!profile(c.email).active, "locked: profile inactive");
  check(pwDigest(c.email) === cBefore, "locked: stored password unchanged");
  check(!(await signIn(c.email, pc)), "locked: the attempted password does not sign in");

  // 4. expired
  const d = await invite("expired");
  sql(`UPDATE public.invitations SET expires_at = now() - interval '1 second' WHERE id = ${lit(d.invitationId)}`);
  expectInvalid("expired invitation", await accept(d.email, d.code, pw()));

  // 5. revoked, then superseded
  const e = await invite("revoked");
  await revoke(e.invitationId);
  expectInvalid("revoked invitation", await accept(e.email, e.code, pw()));
  const e2 = await reissue(e.invitationId);
  expectInvalid("superseded code (after reissue)", await accept(e.email, e.code, pw()));
  const re2 = await accept(e.email, e2.code, pw());
  check(re2.status === 200, "reissued code activates", `${re2.status}`);

  // 6. losing a claim, deterministically: a claim held elsewhere
  const f = await invite("claimheld");
  const fBefore = pwDigest(f.email);
  sql(`SELECT public.claim_invitation(${lit(f.invitationId)})`);
  const pf = pw();
  expectInvalid("claim held by another request", await accept(f.email, f.code, pf));
  check(pwDigest(f.email) === fBefore, "claim loser: stored password unchanged");
  check(!(await signIn(f.email, pf)), "claim loser: its password does not sign in");
  check(!profile(f.email).active, "claim loser: profile still inactive");
  sql(`UPDATE public.invitations SET claim_expires_at = now() - interval '1 second' WHERE id = ${lit(f.invitationId)}`);
  const rf = await accept(f.email, f.code, pf);
  check(rf.status === 200 && await signIn(f.email, pf), "after the held claim expires, activation works");

  // 7. validation errors are specific, and differ from the generic one
  const g = await invite("validation");
  const v1 = await accept("not-an-email", g.code, pw());
  const v2 = await accept(g.email, g.code, "short");
  check(v1.status === 400 && parse(v1)?.code === "invalid_input" && /email/i.test(parse(v1)?.error), "malformed email -> specific 400", `${Math.round(v1.ms)} ms`);
  check(v2.status === 400 && parse(v2)?.code === "invalid_input" && /Password/.test(parse(v2)?.error), "short password -> specific 400", `${Math.round(v2.ms)} ms`);
  check(state(g.invitationId).attempts === 0 && state(g.invitationId).status === "pending", "validation errors touch no invitation");

  // 8. concurrency: two simultaneous accepts, different passwords (3 rounds)
  for (let round = 1; round <= 3; round++) {
    const h = await invite(`race${round}`);
    const [pw1, pw2] = [pw(), pw()];
    const [x, y] = await Promise.all([accept(h.email, h.code, pw1), accept(h.email, h.code, pw2)]);
    const oks = [x, y].filter((r) => r.status === 200).length;
    const winner = x.status === 200 ? pw1 : pw2, loser = x.status === 200 ? pw2 : pw1;
    const lost = x.status === 200 ? y : x;
    check(oks === 1, `race ${round}: exactly one of two simultaneous accepts succeeds`, `${x.status}/${y.status}`);
    expectInvalid(`race ${round}: loser`, lost);
    check(await signIn(h.email, winner), `race ${round}: winner's password signs in`);
    check(!(await signIn(h.email, loser)), `race ${round}: loser's password does not sign in`);
  }

  // 9. failure path: no sites -> generic activation failure, then recovery.
  // Leaves a confirmed but inactive user, which reissue must still allow.
  const k = await invite("nosites");
  sql(`DELETE FROM public.user_sites WHERE user_id = (SELECT id FROM auth.users WHERE email = ${lit(k.email)})`);
  const pk = pw();
  const rk = await accept(k.email, k.code, pk);
  check(rk.status === 500 && parse(rk)?.code === "activation_failed" && /administrator/.test(parse(rk)?.error),
    "consume failure after password set -> generic activation-failed 500", `${rk.status}`);
  const sk = state(k.invitationId), pkf = profile(k.email);
  check(!pkf.active && sk.status === "pending" && !sk.claimed, "profile inactive, invitation pending, claim released");
  check(pkf.confirmed && pkf.hasPassword, "(Auth user is confirmed with a password, as expected for this path)");
  await revoke(k.invitationId);
  const k2 = await reissue(k.invitationId, [sites[2]]);
  check(true, "confirmed but inactive user: revoke + reissue allowed");
  const pk2 = pw();
  const rk2 = await accept(k.email, k2.code, pk2);
  check(rk2.status === 200, "revoke + reissue + accept recovers the account", `${rk2.status}`);
  check(await signIn(k.email, pk2) && !(await signIn(k.email, pk)), "new password signs in; the failed attempt's password does not");
  const pk3 = profile(k.email);
  check(pk3.active && pk3.role === "collector" && siteSet(k.email) === sites[2], "recovered profile: active, collector, reissued site");

  return { email: a.email, invitationId: a.invitationId, jwt };
}

async function nonAdminCreate(active) {
  section("invite-user: non-admin caller");
  const r = await inviteRaw({ action: "create", email: email("deny-collector"), fullName: "Fn deny", role: "collector", siteIds: [sites[0]] }, active.jwt);
  check(r.status === 403 && !userExists(email("deny-collector")), "active collector -> 403, no Auth user", `${r.status}`);
}

function validityFailuresUniform() {
  section("accept-invitation: uniform failures");
  const [first] = invalidResponses;
  const allSame = invalidResponses.every(([, r]) => r.status === first[1].status && r.text === first[1].text);
  check(allSame, `all ${invalidResponses.length} invitation-validity failures byte-identical (status + body)`);
  if (!allSame) for (const [l, r] of invalidResponses) console.log(`   ${l}: ${r.status} ${r.text.length}B`);
  const times = invalidResponses.map(([, r]) => r.ms);
  check(Math.min(...times) >= 1500, "every validity failure took >= 1500 ms",
    `min ${Math.round(Math.min(...times))} ms, max ${Math.round(Math.max(...times))} ms`);
}

// Codes stored only as hashes: compared in this process; nothing is printed.
function codesStoredOnlyAsHash() {
  section("codes stored only as hashes");
  const rows = sql(`SELECT id || '|' || code_hash FROM public.invitations WHERE email LIKE ${lit(PATTERN)}`)
    .split("\n").filter(Boolean).map((l) => l.split("|"));
  const hashById = new Map(rows);
  let matched = 0;
  for (const [id, code] of codeByInvitation) if (hashById.get(id) === sha256(normalise(code))) matched++;
  check(matched === codeByInvitation.size && matched > 0,
    `every issued code's row holds SHA-256(normalised code)`, `${matched}/${codeByInvitation.size}`);
  const dump = sql(`SELECT coalesce(string_agg(t, E'\\n'), '') FROM (
      SELECT row_to_json(i)::text AS t FROM public.invitations i WHERE i.email LIKE ${lit(PATTERN)}
      UNION ALL SELECT row_to_json(u)::text FROM auth.users u WHERE u.email LIKE ${lit(PATTERN)}
      UNION ALL SELECT row_to_json(d)::text FROM auth.identities d
        JOIN auth.users u ON u.id = d.user_id WHERE u.email LIKE ${lit(PATTERN)}
      UNION ALL SELECT row_to_json(p)::text FROM public.profiles p
        JOIN auth.users u ON u.id = p.id WHERE u.email LIKE ${lit(PATTERN)}) s`).toUpperCase();
  let hits = 0;
  for (const code of codes) if (dump.includes(code) || dump.includes(normalise(code))) hits++;
  check(hits === 0 && dump.length > 0, "no plain code in invitations, auth.users, auth.identities or profiles rows",
    `${codes.size} codes, ${hits} found`);
}

async function main() {
  ADMIN_JWT = await signInToken(adminEmail, adminPassword);
  if (!ADMIN_JWT) throw new Error("dev admin sign-in failed (check DEV_ADMIN_PASSWORD)");
  if (sites.length < 3) throw new Error("need at least 3 active sites (run supabase db reset to seed)");
  console.log(`run ${RUN}: local stack ${API}`);

  await inviteUserAccess();
  const created = await inviteUserRoles();
  await inviteUserInvalidInput();
  await inviteUserRegistrationFailure(created["r-coll"]);
  const active = await acceptInvitation();
  await nonAdminCreate(active);
  await inviteUserReissue(created, active);
  validityFailuresUniform();
  codesStoredOnlyAsHash();
}

// ------------------------------------------------------------------ logs + cleanup
function scanLogs() {
  section("logs");
  const since = runStart.toISOString();
  const containers = ["edge_runtime", "auth", "kong", "rest", "db"].map((s) => `supabase_${s}_${projectId}`);
  let hits = 0, emailHits = 0;
  for (const name of containers) {
    // stdout and stderr of the container, together.
    const logs = execFileSync("sh", ["-c", 'docker logs --since "$1" "$2" 2>&1', "sh", since, name],
      { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    const upper = logs.toUpperCase();
    let n = 0;
    for (const s of secrets) if (logs.includes(s)) n++;
    for (const c of codes) if (upper.includes(normalise(c))) n++;   // normalised form too
    hits += n;
    if (name.startsWith("supabase_edge_runtime_")) {
      for (const e of emailsUsed) if (logs.toLowerCase().includes(e)) emailHits++;
    }
    console.log(`      ${name}: ${n} code/password match(es)`);
  }
  check(hits === 0, `no code or password (${secrets.size} values) in the logs of ${containers.length} containers`);
  check(emailHits === 0, "no test email in the Edge Function logs");
}

let cleaning = null;
function cleanup() {
  cleaning ??= (async () => {
    section("cleanup");
    const where = `email LIKE ${lit(PATTERN)} AND id <> ${lit(ADMIN_ID)}`;
    const ids = sql(`SELECT id FROM auth.users WHERE ${where}`).split("\n").filter(Boolean);
    const rs = await Promise.all(ids.map((id) =>
      call("DELETE", `/auth/v1/admin/users/${id}`, { apikey: SR, bearer: SR }).catch(() => ({ status: 0 }))));
    let left = sql(`SELECT count(*) FROM auth.users WHERE ${where}`);
    if (left !== "0") {
      // Admin API failed for some: remove them in the database instead.
      sql(`DELETE FROM auth.users WHERE ${where}`);
      left = sql(`SELECT count(*) FROM auth.users WHERE ${where}`);
    }
    const leftInv = sql(`SELECT count(*) FROM public.invitations WHERE email LIKE ${lit(PATTERN)}`);
    check(left === "0" && leftInv === "0",
      `deleted ${ids.length} test user(s) (${rs.filter((r) => r.status === 200).length} via Admin API); ${left} users, ${leftInv} invitations left`);
    check(adminFingerprint() === adminBefore, "dev admin unchanged (Auth row and profile)");
  })();
  return cleaning;
}

for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129]]) {
  process.on(signal, async () => {
    console.log(`\n${signal}: cleaning up`);
    try { await cleanup(); } catch (err) { console.log(`FAIL  cleanup: ${err.message}`); }
    process.exit(code);
  });
}

try {
  await main();
} catch (err) {
  failures++;
  console.log(`FAIL  aborted: ${err.message}`);
} finally {
  try { scanLogs(); } catch (err) { failures++; console.log(`FAIL  log scan: ${err.message}`); }
  try { await cleanup(); } catch (err) { failures++; console.log(`FAIL  cleanup: ${err.message}`); }
  console.log(failures ? `\n${failures} FAILED` : "\nall checks passed");
  process.exitCode = failures ? 1 : 0;
}
