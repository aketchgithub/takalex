// node --experimental-strip-types --test (npm run test:unit)
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CONNECT_ONCE_MESSAGE,
  PROFILE_INACTIVE_MESSAGE,
  PROFILE_MISSING_MESSAGE,
  chooseStartupSession,
  classifyProfileError,
  resolveProfile,
  type ProfileFetch,
} from "./authResolution.ts";
import type { Profile } from "../types/auth.ts";

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

function profile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: ME,
    full_name: "Test Collector",
    phone: null,
    role: "collector",
    is_active: true,
    created_at: "2026-11-01T08:00:00.000Z",
    ...overrides,
  };
}

// What postgrest-js returns when the fetch itself fails (status 0), as seen
// on the device with the Supabase adb mapping removed.
const FETCH_FAILED = classifyProfileError({
  message: "TypeError: fetch failed",
  status: 0,
});
const NETWORK: ProfileFetch = { kind: "network", message: "Network request failed" };

describe("classifyProfileError", () => {
  it("treats no answer as a network failure", () => {
    assert.equal(FETCH_FAILED.kind, "network");
    for (const error of [
      { message: "Network request failed" },
      { message: "Error: fetch failed: failed to connect to 127.0.0.1:54321" },
      { message: "Aborted", name: "AbortError" },
      { message: "Network request failed", name: "AuthRetryableFetchError", status: 0 },
    ]) {
      assert.equal(classifyProfileError(error).kind, "network", JSON.stringify(error));
    }
  });

  it("treats any HTTP answer as a server answer, not offline", () => {
    for (const error of [
      { message: "Internal Server Error", status: 500 },
      { message: "JWT expired", status: 401, code: "PGRST303" },
      { message: "permission denied for table profiles", status: 403, code: "42501" },
    ]) {
      assert.equal(classifyProfileError(error).kind, "server_error", JSON.stringify(error));
    }
  });
});

describe("resolveProfile", () => {
  it("network failure with a valid cache: allowed, offline", () => {
    const cached = profile();
    const result = resolveProfile(ME, FETCH_FAILED, cached);
    assert.deepEqual(result, { access: "allowed", profile: cached, authError: null, offline: "cached" });
  });

  it("network failure with no cache: blocked with a connect-once message", () => {
    const result = resolveProfile(ME, NETWORK, null);
    assert.equal(result.access, "blocked");
    assert.equal(result.profile, null);
    assert.equal(result.authError, CONNECT_ONCE_MESSAGE);
    assert.match(result.authError ?? "", /Connect to the internet once to sign in/);
    assert.equal(result.offline, "no_cache");
  });

  it("server says inactive: blocked, even with an active cached profile", () => {
    const fromServer = profile({ is_active: false });
    const result = resolveProfile(ME, { kind: "ok", profile: fromServer }, profile());
    assert.deepEqual(result, {
      access: "blocked",
      profile: fromServer,
      authError: PROFILE_INACTIVE_MESSAGE,
      offline: null,
    });
  });

  it("server says missing or invalid: blocked, even with an active cached profile", () => {
    const result = resolveProfile(ME, { kind: "ok", profile: null }, profile());
    assert.deepEqual(result, {
      access: "blocked",
      profile: null,
      authError: PROFILE_MISSING_MESSAGE,
      offline: null,
    });
  });

  it("a cached profile of a different user is ignored", () => {
    const result = resolveProfile(ME, NETWORK, profile({ id: OTHER }));
    assert.equal(result.access, "blocked");
    assert.equal(result.profile, null);
    assert.equal(result.authError, CONNECT_ONCE_MESSAGE);
  });

  it("a cached profile that was inactive is not used", () => {
    const result = resolveProfile(ME, NETWORK, profile({ is_active: false }));
    assert.equal(result.access, "blocked");
    assert.equal(result.authError, CONNECT_ONCE_MESSAGE);
  });

  it("a server error (an answer, not offline) blocks as before, cache or not", () => {
    const result = resolveProfile(ME, { kind: "server_error", message: "Internal Server Error" }, profile());
    assert.deepEqual(result, {
      access: "blocked",
      profile: null,
      authError: "Could not load your profile: Internal Server Error",
      offline: null,
    });
  });

  it("online with an active profile: allowed, not offline", () => {
    const fromServer = profile({ full_name: "Renamed" });
    assert.deepEqual(resolveProfile(ME, { kind: "ok", profile: fromServer }, profile()), {
      access: "allowed",
      profile: fromServer,
      authError: null,
      offline: null,
    });
  });

  it("a server profile with another id is treated as missing", () => {
    const result = resolveProfile(ME, { kind: "ok", profile: profile({ id: OTHER }) }, null);
    assert.equal(result.access, "blocked");
    assert.equal(result.authError, PROFILE_MISSING_MESSAGE);
  });
});

describe("chooseStartupSession", () => {
  const live = { user: { id: ME }, tag: "from supabase-js" };
  const persisted = { user: { id: ME }, tag: "persisted" };

  it("uses supabase-js's answer when there is no error", () => {
    assert.deepEqual(chooseStartupSession({ session: live, error: null }, persisted), {
      kind: "session",
      session: live,
    });
    // Signed out according to supabase-js: signed out, whatever is persisted.
    assert.deepEqual(chooseStartupSession({ session: null, error: null }, persisted), {
      kind: "session",
      session: null,
    });
  });

  it("falls back to the persisted session when the refresh failed for lack of a connection", () => {
    const error = { message: "Network request failed", name: "AuthRetryableFetchError", status: 0 };
    assert.deepEqual(chooseStartupSession({ session: null, error }, persisted), {
      kind: "session",
      session: persisted,
    });
    assert.deepEqual(chooseStartupSession({ session: null, error }, null), { kind: "session", session: null });
  });

  it("keeps reporting other session errors", () => {
    const error = { message: "Invalid Refresh Token: Refresh Token Not Found", status: 400 };
    assert.deepEqual(chooseStartupSession({ session: null, error }, persisted), {
      kind: "error",
      message: error.message,
    });
  });
});
