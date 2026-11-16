// Who may use the app when the profile (or session) cannot be checked with
// the server. Pure TypeScript, tested by authResolution.test.ts; the auth
// store does the Supabase calls and applies these decisions.
//
// Rules:
//   - A server answer always wins: missing, invalid or inactive profile is
//     blocked exactly as before, whatever is cached.
//   - Only when the request got no answer at all (network failure) may the
//     cached profile be used, and only if it belongs to the same user and
//     was active. The app then runs "offline" until the profile is reloaded.

import type { Profile } from "../types/auth.ts";
import { isNetworkError } from "./outbox/errors.ts";
import type { RemoteError } from "./outbox/types.ts";

export const CONNECT_ONCE_MESSAGE =
  "Takalex can't be reached, and this phone has no saved account details for you yet. Connect to the internet once to sign in.";
export const PROFILE_MISSING_MESSAGE =
  "Your account profile is missing or invalid. Ask an administrator to check your account.";
export const PROFILE_INACTIVE_MESSAGE = "Your account is inactive. Ask an administrator for help.";
export const OFFLINE_NOTICE = "Offline: deliveries will upload when you're connected";

// The outcome of one profile request.
//   ok:           the server answered; profile is null when there is no row
//                 or it is not a valid profile.
//   network:      no answer (no connection, refused, timeout).
//   server_error: the server answered with an error.
export type ProfileFetch =
  | { kind: "ok"; profile: Profile | null }
  | { kind: "network"; message: string }
  | { kind: "server_error"; message: string };

// "cached": allowed with the cached profile because the server could not be
// reached. "no_cache": blocked for the same reason, with nothing cached.
export type OfflineMode = "cached" | "no_cache" | null;

export type ProfileResolution =
  | { access: "allowed"; profile: Profile; authError: null; offline: OfflineMode }
  | { access: "blocked"; profile: Profile | null; authError: string; offline: OfflineMode };

export function classifyProfileError(error: RemoteError): ProfileFetch {
  return isNetworkError(error)
    ? { kind: "network", message: error.message }
    : { kind: "server_error", message: error.message };
}

export function resolveProfile(
  sessionUserId: string,
  fetched: ProfileFetch,
  cached: Profile | null,
): ProfileResolution {
  if (fetched.kind === "ok") {
    const profile = fetched.profile;
    if (!profile || profile.id !== sessionUserId) {
      return { access: "blocked", profile: null, authError: PROFILE_MISSING_MESSAGE, offline: null };
    }
    if (!profile.is_active) {
      // Kept, as before, so screens can still show who is signed in.
      return { access: "blocked", profile, authError: PROFILE_INACTIVE_MESSAGE, offline: null };
    }
    return { access: "allowed", profile, authError: null, offline: null };
  }

  if (fetched.kind === "server_error") {
    return {
      access: "blocked",
      profile: null,
      authError: `Could not load your profile: ${fetched.message}`,
      offline: null,
    };
  }

  // Network failure: the cached profile only if it is this user's and active.
  if (cached && cached.id === sessionUserId && cached.is_active) {
    return { access: "allowed", profile: cached, authError: null, offline: "cached" };
  }
  return { access: "blocked", profile: null, authError: CONNECT_ONCE_MESSAGE, offline: "no_cache" };
}

// Which session to start with. supabase-js keeps the stored session when a
// refresh fails for lack of a connection, but getSession() then returns
// session: null with a network error (once the access token has expired).
// In that case the session persisted by the auth store is used, so the
// profile rules above decide (the cached profile must match its user).
type SessionLike = { user: { id: string } };

export type StartupSession<S extends SessionLike> =
  | { kind: "session"; session: S | null }
  | { kind: "error"; message: string };

export function chooseStartupSession<S extends SessionLike>(
  result: { session: S | null; error: RemoteError | null },
  persisted: S | null,
): StartupSession<S> {
  if (!result.error) return { kind: "session", session: result.session };
  if (isNetworkError(result.error)) return { kind: "session", session: result.session ?? persisted };
  return { kind: "error", message: result.error.message };
}
