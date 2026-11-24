import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Session, User } from "@supabase/supabase-js";

import {
  chooseStartupSession,
  classifyProfileError,
  resolveProfile,
  type OfflineMode,
  type ProfileFetch,
} from "@/lib/authResolution";
import { readFunctionFailure } from "@/lib/functions";
import { toRemoteError } from "@/lib/outbox/errors";
import {
  PASSWORD_CHANGE_MESSAGES,
  classifyPasswordChangeError,
  type PasswordChangeFailureKind,
} from "@/lib/passwordRules";
import {
  phoneChangeErrorMessage,
  resetRequestOutcome,
  resetVerifyErrorMessage,
  type ResetChannel,
  type ResetRequestOutcome,
} from "@/lib/passwordReset";
import { signInErrorMessage } from "@/lib/signInErrors";
import { authStorage } from "@/lib/storage";
import { supabase } from "@/lib/supabase";
import { profileSchema, type InviteRole, type Profile } from "@/types/auth";

// Fixed client copies of accept-invitation's generic messages, so every
// invitation-validity failure reads exactly the same in the app.
export const INVALID_INVITATION_MESSAGE =
  "This invitation is not valid. Check the email address and code, or ask your administrator for a new invitation.";
export const ACTIVATION_FAILED_MESSAGE =
  "Activation failed. Contact your administrator.";
const ACTIVATION_UNAVAILABLE_MESSAGE =
  "Activation is temporarily unavailable. Try again in a few minutes.";
const NETWORK_MESSAGE =
  "Could not reach Takalex. Check your connection and try again.";

export type ActivationResult =
  | { ok: true }
  | {
      ok: false;
      kind:
        | "invalid_input"
        | "invalid_invitation"
        | "activation_failed"
        | "unavailable"
        | "network"
        | "sign_in_failed";
      message: string;
    };

export type ChangePasswordResult =
  | { ok: true }
  | { ok: false; kind: PasswordChangeFailureKind; message: string };

// The invitation code is returned to the caller only. It is never written to
// this store, so it can never be persisted (see partialize below).
export type InviteResult =
  | {
      ok: true;
      invitationId: string;
      code: string;
      expiresAt: string | null;
      // Set when the invitation was created but its access request could
      // not be marked invited.
      warning: string | null;
    }
  | { ok: false; message: string };

type AuthState = {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  role: Profile["role"] | null;
  isLoading: boolean;
  isHydrated: boolean;
  isInviting: boolean;
  isActivating: boolean;
  // Not persisted. True from checking a "Forgot password?" code until the
  // new password is saved (or the reset is cancelled). Checking the code
  // signs the user in; while this is set the sign-in screens keep them on
  // the reset screen instead of sending them home.
  isResettingPassword: boolean;
  authError: string | null;
  // Not persisted. "cached": the profile could not be checked (no
  // connection) and the cached profile of this same, active user is in use.
  // "no_cache": blocked for the same reason. null: checked with the server.
  offline: OfflineMode;
  setIsHydrated: () => void;
  initialize: () => Promise<void>;
  loadSession: (session: Session | null) => Promise<void>;
  // Re-checks the profile with the server without showing the loading
  // screen (used when the app returns to the foreground or reconnects).
  refreshProfile: () => Promise<void>;
  setSession: (session: Session | null) => void;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  activateAccount: (
    email: string,
    code: string,
    password: string,
  ) => Promise<ActivationResult>;
  inviteUser: (
    email: string,
    fullName: string,
    role: InviteRole,
    siteIds: string[],
    accessRequestId?: string,
  ) => Promise<InviteResult>;
  // Checks the current password, then sets the new one. The user stays
  // signed in. Neither password is kept, logged or persisted.
  changePassword: (
    currentPassword: string,
    newPassword: string,
  ) => Promise<ChangePasswordResult>;
  // "Forgot password?" by SMS code (address: E.164 phone number) or email
  // code. requestPasswordReset answers the same way whether or not the
  // number or email has an account.
  requestPasswordReset: (channel: ResetChannel, address: string) => Promise<ResetRequestOutcome>;
  verifyResetCode: (
    channel: ResetChannel,
    address: string,
    code: string,
  ) => Promise<{ ok: true } | { ok: false; message: string }>;
  setResetPassword: (newPassword: string) => Promise<ChangePasswordResult>;
  // Leaves the reset; signs out if the code was already checked.
  cancelPasswordReset: () => Promise<void>;
  // The signed-in user adds or changes the phone number used for password
  // reset: an SMS code goes to the new number, which is saved once the code
  // is confirmed (profiles.phone follows auth.users, migration 002).
  sendPhoneCode: (phone: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  confirmPhoneCode: (phone: string, code: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  signOut: () => Promise<void>;
  setAuthError: (message: string | null) => void;
};

async function fetchProfile(userId: string): Promise<ProfileFetch> {
  try {
    const { data, error, status } = await supabase
      .from("profiles")
      .select("id, full_name, phone, role, is_active, created_at")
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      return classifyProfileError({ message: error.message, status, code: error.code || undefined });
    }
    // No row, or a row that is not a valid profile: null.
    const result = profileSchema.safeParse(data);
    return { kind: "ok", profile: result.success ? result.data : null };
  } catch (error: unknown) {
    return classifyProfileError(toRemoteError(error));
  }
}

// background: re-check without the loading screen, so role screens (and a
// half-filled delivery form) stay mounted while it runs.
async function loadProfile(session: Session, { background = false } = {}): Promise<void> {
  // The persisted profile, read before anything here changes it. It is only
  // ever used for this same user (resolveProfile checks the id).
  const cached = useAuthStore.getState().profile;

  if (!background) {
    useAuthStore.setState({
      session,
      user: session.user,
      isLoading: true,
      authError: null,
    });
  }

  const fetched = await fetchProfile(session.user.id);

  if (useAuthStore.getState().session?.user.id !== session.user.id) {
    return;
  }

  // A server answer of missing / invalid / inactive blocks as before: an
  // inactive profile (for example after a failed activation) keeps authError
  // set; app/index.tsx shows it and the role layouts refuse to render. Only a
  // network failure can fall back to the cached profile.
  const resolution = resolveProfile(session.user.id, fetched, cached);
  useAuthStore.setState({
    session,
    user: session.user,
    profile: resolution.profile,
    role: resolution.profile?.role ?? null,
    isLoading: false,
    authError: resolution.authError,
    offline: resolution.offline,
  });
}

let profileRefresh: Promise<void> | null = null;

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      session: null,
      user: null,
      profile: null,
      role: null,
      isLoading: true,
      isHydrated: false,
      isInviting: false,
      isActivating: false,
      isResettingPassword: false,
      authError: null,
      offline: null,

      setIsHydrated: () => set({ isHydrated: true }),

      initialize: async () => {
        try {
          const { data, error } = await supabase.auth.getSession();

          // Offline with an expired access token, getSession() returns no
          // session and a network error although supabase-js kept the
          // session. Then the persisted session is used, and loadProfile
          // decides whether its cached profile may be used.
          const startup = chooseStartupSession(
            { session: data.session, error: error ? toRemoteError(error) : null },
            get().session,
          );

          if (startup.kind === "error") {
            set({
              session: null,
              user: null,
              profile: null,
              role: null,
              isLoading: false,
              offline: null,
              authError: `Could not restore your session: ${startup.message}`,
            });
            return;
          }

          await get().loadSession(startup.session);
        } catch (error: unknown) {
          const message =
            error instanceof Error
              ? error.message
              : "Secure session storage is unavailable.";

          set({
            session: null,
            user: null,
            profile: null,
            role: null,
            isLoading: false,
            authError: `Could not restore your session: ${message}`,
          });
        }
      },

      loadSession: async (session) => {
        if (!session) {
          set({
            session: null,
            user: null,
            profile: null,
            role: null,
            isLoading: false,
            authError: null,
            offline: null,
          });
          return;
        }

        try {
          await loadProfile(session);
        } catch (error: unknown) {
          if (get().session?.user.id !== session.user.id) {
            return;
          }

          const message =
            error instanceof Error ? error.message : "The profile request failed.";

          set({
            session,
            user: session.user,
            profile: null,
            role: null,
            isLoading: false,
            offline: null,
            authError: `Could not load your profile: ${message}`,
          });
        }
      },

      refreshProfile: () => {
        // One re-check at a time (foreground, timer and token refresh can
        // all ask at once).
        if (profileRefresh) return profileRefresh;
        profileRefresh = (async () => {
          const current = get().session;
          if (!current) return;

          // Refreshes the access token first if it has expired.
          const { data, error } = await supabase.auth.getSession();
          // Still offline (or any other auth error): keep the current state.
          // If the session is really gone, supabase-js emits SIGNED_OUT and
          // the auth state listener signs the store out.
          if (error) return;
          if (!data.session) {
            // supabase-js no longer holds a session: signed out.
            await get().loadSession(null);
            return;
          }
          // A different user is handled by the auth state listener.
          if (data.session.user.id !== current.user.id) return;

          await loadProfile(data.session, { background: true });
        })()
          .catch(() => undefined)
          .finally(() => {
            profileRefresh = null;
          });
        return profileRefresh;
      },

      setSession: (session) =>
        set({ session, user: session?.user ?? null }),

      signInWithPassword: async (email, password) => {
        set({ isLoading: true, authError: null });

        try {
          const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password,
          });

          if (error) {
            set({ isLoading: false, authError: signInErrorMessage(toRemoteError(error)) });
            return;
          }

          await get().loadSession(data.session);
        } catch (error: unknown) {
          set({ isLoading: false, authError: signInErrorMessage(toRemoteError(error)) });
        }
      },

      // accept-invitation (public; email + one-time code + new password),
      // then a normal password sign-in. The code and password are not kept.
      activateAccount: async (email, code, password) => {
        set({ isActivating: true, authError: null });

        try {
          const { data, error } = await supabase.functions.invoke(
            "accept-invitation",
            { body: { email, code, password } },
          );

          if (error) {
            const failure = await readFunctionFailure(error);
            if (failure.kind === "network") {
              return { ok: false, kind: "network", message: NETWORK_MESSAGE };
            }
            switch (failure.code) {
              case "invalid_input":
                return {
                  ok: false,
                  kind: "invalid_input",
                  message: failure.message ?? "Check the details you entered.",
                };
              case "invalid_invitation":
                return {
                  ok: false,
                  kind: "invalid_invitation",
                  message: INVALID_INVITATION_MESSAGE,
                };
              case "unavailable":
                return {
                  ok: false,
                  kind: "unavailable",
                  message: ACTIVATION_UNAVAILABLE_MESSAGE,
                };
              default:
                return {
                  ok: false,
                  kind: "activation_failed",
                  message: ACTIVATION_FAILED_MESSAGE,
                };
            }
          }

          if (data?.ok !== true) {
            return {
              ok: false,
              kind: "activation_failed",
              message: ACTIVATION_FAILED_MESSAGE,
            };
          }

          const { data: signIn, error: signInError } =
            await supabase.auth.signInWithPassword({ email, password });

          if (signInError || !signIn.session) {
            return {
              ok: false,
              kind: "sign_in_failed",
              message:
                "Your account is active, but signing in failed. Sign in with your email and new password.",
            };
          }

          await get().loadSession(signIn.session);
          return { ok: true };
        } catch {
          return { ok: false, kind: "network", message: NETWORK_MESSAGE };
        } finally {
          set({ isActivating: false });
        }
      },

      // invite-user with action "create" (admin only; the function checks the
      // caller's JWT and is_active_admin()). The code is handed back once.
      inviteUser: async (email, fullName, role, siteIds, accessRequestId) => {
        set({ isInviting: true });

        try {
          const { data, error } = await supabase.functions.invoke("invite-user", {
            body: {
              action: "create",
              email,
              fullName,
              role,
              siteIds,
              ...(accessRequestId ? { accessRequestId } : {}),
            },
          });

          if (error) {
            const failure = await readFunctionFailure(error);
            if (failure.kind === "network") {
              return { ok: false, message: NETWORK_MESSAGE };
            }
            if (failure.status === 401) {
              return {
                ok: false,
                message: "Your session has expired. Sign out and sign in again.",
              };
            }
            return {
              ok: false,
              message: failure.message ?? "The invitation could not be created.",
            };
          }

          const invitationId: unknown = data?.invitationId;
          const code: unknown = data?.code;
          const expiresAt: unknown = data?.expiresAt;
          if (typeof invitationId !== "string" || typeof code !== "string") {
            return { ok: false, message: "The invitation service returned an unexpected response." };
          }

          return {
            ok: true,
            invitationId,
            code,
            expiresAt: typeof expiresAt === "string" ? expiresAt : null,
            warning: typeof data?.warning === "string" ? data.warning : null,
          };
        } catch {
          return { ok: false, message: NETWORK_MESSAGE };
        } finally {
          set({ isInviting: false });
        }
      },

      // Re-authenticates the signed-in user's own email with the current
      // password, then updates the password. The re-authentication replaces
      // this client's session with a fresh one for the same user (there is
      // never a second client or a second stored session). isLoading is not
      // touched, so the role screens stay mounted.
      changePassword: async (currentPassword, newPassword) => {
        const email = get().session?.user.email;
        if (!email) {
          return { ok: false, kind: "session", message: PASSWORD_CHANGE_MESSAGES.session };
        }

        try {
          const { data: verified, error: verifyError } =
            await supabase.auth.signInWithPassword({ email, password: currentPassword });

          if (verifyError) {
            return { ok: false, ...classifyPasswordChangeError("verify", toRemoteError(verifyError)) };
          }
          if (!verified.session || verified.session.user.id !== get().session?.user.id) {
            return { ok: false, kind: "other", message: PASSWORD_CHANGE_MESSAGES.other };
          }
          get().setSession(verified.session);

          const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
          if (updateError) {
            return { ok: false, ...classifyPasswordChangeError("update", toRemoteError(updateError)) };
          }
          return { ok: true };
        } catch (error: unknown) {
          // Classified from the error's name, status and code only.
          return { ok: false, ...classifyPasswordChangeError("update", toRemoteError(error)) };
        }
      },

      requestPasswordReset: async (channel, address) => {
        try {
          const { error } =
            channel === "phone"
              ? // shouldCreateUser false: a number with no account gets no
                // account (and public sign-up is off anyway).
                await supabase.auth.signInWithOtp({ phone: address, options: { shouldCreateUser: false } })
              : await supabase.auth.resetPasswordForEmail(address);
          return resetRequestOutcome(error ? toRemoteError(error) : null, channel);
        } catch (error: unknown) {
          return resetRequestOutcome(toRemoteError(error), channel);
        }
      },

      verifyResetCode: async (channel, address, code) => {
        // Set before the call: a correct code signs the user in at once.
        set({ isResettingPassword: true, authError: null });
        try {
          const { data, error } =
            channel === "phone"
              ? await supabase.auth.verifyOtp({ phone: address, token: code, type: "sms" })
              : await supabase.auth.verifyOtp({ email: address, token: code, type: "recovery" });
          if (error || !data.session) {
            set({ isResettingPassword: false });
            return { ok: false, message: resetVerifyErrorMessage(toRemoteError(error ?? { message: "No session" })) };
          }
          // The auth state listener only stores the new session on its next
          // turn (setTimeout), after the screen has already called
          // setResetPassword; store it now so that call (and leaving the
          // screen) sees the signed-in user. isResettingPassword keeps the
          // sign-in screens from sending them home.
          set({ session: data.session, user: data.session.user });
          return { ok: true };
        } catch (error: unknown) {
          set({ isResettingPassword: false });
          return { ok: false, message: resetVerifyErrorMessage(toRemoteError(error)) };
        }
      },

      setResetPassword: async (newPassword) => {
        if (!get().isResettingPassword || !get().session) {
          return { ok: false, kind: "session", message: PASSWORD_CHANGE_MESSAGES.session };
        }
        try {
          const { error } = await supabase.auth.updateUser({ password: newPassword });
          if (error) {
            return { ok: false, ...classifyPasswordChangeError("update", toRemoteError(error)) };
          }
          // The sign-in screens now send the user home.
          set({ isResettingPassword: false });
          return { ok: true };
        } catch (error: unknown) {
          return { ok: false, ...classifyPasswordChangeError("update", toRemoteError(error)) };
        }
      },

      cancelPasswordReset: async () => {
        // Sign out first: clearing the flag while still signed in would let
        // the sign-in screens send the user home.
        if (get().isResettingPassword && get().session !== null) await get().signOut();
        set({ isResettingPassword: false });
      },

      sendPhoneCode: async (phone) => {
        if (!get().session) return { ok: false, message: PASSWORD_CHANGE_MESSAGES.session };
        try {
          const { error } = await supabase.auth.updateUser({ phone });
          if (error) return { ok: false, message: phoneChangeErrorMessage(toRemoteError(error)) };
          return { ok: true };
        } catch (error: unknown) {
          return { ok: false, message: phoneChangeErrorMessage(toRemoteError(error)) };
        }
      },

      confirmPhoneCode: async (phone, code) => {
        if (!get().session) return { ok: false, message: PASSWORD_CHANGE_MESSAGES.session };
        try {
          const { data, error } = await supabase.auth.verifyOtp({ phone, token: code, type: "phone_change" });
          if (error) return { ok: false, message: resetVerifyErrorMessage(toRemoteError(error)) };
          // The listener also receives USER_UPDATED; set the session now so
          // the account card shows the number at once.
          if (data.session && data.session.user.id === get().session?.user.id) get().setSession(data.session);
          return { ok: true };
        } catch (error: unknown) {
          return { ok: false, message: resetVerifyErrorMessage(toRemoteError(error)) };
        }
      },

      signOut: async () => {
        set({ isLoading: true, authError: null });

        try {
          const { error } = await supabase.auth.signOut({ scope: "local" });

          if (error) {
            set({ isLoading: false, authError: error.message });
            return;
          }

          set({
            session: null,
            user: null,
            profile: null,
            role: null,
            isLoading: false,
            authError: null,
            offline: null,
          });
        } catch (error: unknown) {
          set({
            isLoading: false,
            authError:
              error instanceof Error ? error.message : "Could not sign out.",
          });
        }
      },

      setAuthError: (message) => set({ authError: message }),
    }),
    {
      name: "takalex-auth-state",
      storage: createJSONStorage(() => authStorage),
      // Only these four fields are ever written to secure storage. No
      // invitation code, password or error text is persisted.
      partialize: (state) => ({
        session: state.session,
        user: state.user,
        profile: state.profile,
        role: state.role,
      }),
      // Version 1 drops fields saved by older builds (invitationPending,
      // phone OTP state) instead of merging them back in.
      version: 1,
      migrate: (persisted) => {
        const saved = (persisted ?? {}) as Partial<AuthState>;
        return {
          session: saved.session ?? null,
          user: saved.user ?? null,
          profile: saved.profile ?? null,
          role: saved.role ?? null,
        } as AuthState;
      },
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          const message =
            error instanceof Error
              ? error.message
              : "Secure storage could not be read.";
          state?.setAuthError(
            `Could not restore saved account information: ${message}`,
          );
        }

        state?.setIsHydrated();
      },
    },
  ),
);
