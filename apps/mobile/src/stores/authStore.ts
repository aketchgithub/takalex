import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Session, User } from "@supabase/supabase-js";

import { authStorage } from "@/lib/storage";
import { supabase } from "@/lib/supabase";
import { profileSchema, type Profile } from "@/types/auth";

type AuthState = {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  role: Profile["role"] | null;
  isLoading: boolean;
  isHydrated: boolean;
  isInviting: boolean;
  invitationPending: boolean;
  phoneOtpPending: boolean;
  pendingPhone: string | null;
  authError: string | null;
  statusMessage: string | null;
  setIsHydrated: () => void;
  initialize: () => Promise<void>;
  loadSession: (session: Session | null) => Promise<void>;
  setSession: (session: Session | null) => void;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  requestPhoneOtp: (phone: string) => Promise<void>;
  verifyPhoneOtp: (phone: string, token: string) => Promise<void>;
  acceptInvitation: (password: string, phone?: string) => Promise<void>;
  verifyPhoneChange: (phone: string, token: string) => Promise<void>;
  finishInvitationWithoutPhone: () => Promise<void>;
  inviteCollector: (email: string, fullName: string) => Promise<void>;
  signOut: () => Promise<void>;
  setInvitationPending: (pending: boolean) => void;
  setAuthError: (message: string | null) => void;
  clearStatusMessage: () => void;
};

async function loadProfile(session: Session): Promise<void> {
  useAuthStore.setState({
    session,
    user: session.user,
    isLoading: true,
    authError: null,
    statusMessage: null,
  });

  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, phone, role, site_id, group_id, is_active, created_at")
    .eq("id", session.user.id)
    .maybeSingle();

  if (useAuthStore.getState().session?.user.id !== session.user.id) {
    return;
  }

  if (error) {
    useAuthStore.setState({
      session,
      user: session.user,
      profile: null,
      role: null,
      isLoading: false,
      authError: `Could not load your profile: ${error.message}`,
    });
    return;
  }

  const result = profileSchema.safeParse(data);
  if (!result.success) {
    useAuthStore.setState({
      session,
      user: session.user,
      profile: null,
      role: null,
      isLoading: false,
      authError:
        "Your account profile is missing or invalid. Ask an administrator to check your account.",
    });
    return;
  }

  if (!result.data.is_active) {
    useAuthStore.setState({
      session,
      user: session.user,
      profile: result.data,
      role: result.data.role,
      isLoading: false,
      authError: "Your account is inactive. Ask an administrator for help.",
    });
    return;
  }

  useAuthStore.setState({
    session,
    user: session.user,
    profile: result.data,
    role: result.data.role,
    isLoading: false,
    authError: null,
  });
}

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
      invitationPending: false,
      phoneOtpPending: false,
      pendingPhone: null,
      authError: null,
      statusMessage: null,
      setIsHydrated: () => set({ isHydrated: true }),
      initialize: async () => {
        try {
          const { data, error } = await supabase.auth.getSession();
          if (error) {
            set({
              session: null,
              user: null,
              profile: null,
              role: null,
              isLoading: false,
              authError: `Could not restore your session: ${error.message}`,
            });
            return;
          }
          await get().loadSession(data.session);
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : "Secure session storage is unavailable.";
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
            invitationPending: false,
            phoneOtpPending: false,
            pendingPhone: null,
            authError: null,
            statusMessage: null,
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
            authError: `Could not load your profile: ${message}`,
          });
        }
      },
      setSession: (session) =>
        set({ session, user: session?.user ?? null }),
      signInWithPassword: async (email, password) => {
        set({ isLoading: true, authError: null, statusMessage: null });
        try {
          const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password,
          });
          if (error) {
            set({ isLoading: false, authError: error.message });
            return;
          }
          await get().loadSession(data.session);
        } catch (error: unknown) {
          set({
            isLoading: false,
            authError:
              error instanceof Error ? error.message : "Could not sign in.",
          });
        }
      },
      requestPhoneOtp: async (phone) => {
        set({ isLoading: true, authError: null, statusMessage: null });
        try {
          const { error } = await supabase.auth.signInWithOtp({
            phone,
            options: { shouldCreateUser: false },
          });
          set({
            isLoading: false,
            authError: error?.message ?? null,
            statusMessage: error
              ? null
              : "Verification code sent. Enter the code from your SMS.",
          });
        } catch (error: unknown) {
          set({
            isLoading: false,
            authError:
              error instanceof Error ? error.message : "Could not send an SMS code.",
          });
        }
      },
      verifyPhoneOtp: async (phone, token) => {
        set({ isLoading: true, authError: null, statusMessage: null });
        try {
          const { data, error } = await supabase.auth.verifyOtp({
            phone,
            token,
            type: "sms",
          });
          if (error) {
            set({ isLoading: false, authError: error.message });
            return;
          }
          await get().loadSession(data.session);
        } catch (error: unknown) {
          set({
            isLoading: false,
            authError:
              error instanceof Error ? error.message : "Could not verify the SMS code.",
          });
        }
      },
      acceptInvitation: async (password, phone) => {
        set({ isLoading: true, authError: null, statusMessage: null });
        try {
          const { error } = await supabase.auth.updateUser({
            password,
            ...(phone ? { phone } : {}),
          });
          if (error) {
            set({ isLoading: false, authError: error.message });
            return;
          }
          if (phone) {
            set({
              isLoading: false,
              phoneOtpPending: true,
              pendingPhone: phone,
              statusMessage: "Verification code sent to your phone.",
            });
            return;
          }
          set({ invitationPending: false });
          await get().loadSession(get().session);
        } catch (error: unknown) {
          set({
            isLoading: false,
            authError:
              error instanceof Error ? error.message : "Could not save your account.",
          });
        }
      },
      verifyPhoneChange: async (phone, token) => {
        set({ isLoading: true, authError: null, statusMessage: null });
        try {
          const { data, error } = await supabase.auth.verifyOtp({
            phone,
            token,
            type: "phone_change",
          });
          if (error) {
            set({ isLoading: false, authError: error.message });
            return;
          }
          set({
            invitationPending: false,
            phoneOtpPending: false,
            pendingPhone: null,
            statusMessage: "Phone number verified. You can now sign in with SMS.",
          });
          await get().loadSession(data.session);
        } catch (error: unknown) {
          set({
            isLoading: false,
            authError:
              error instanceof Error ? error.message : "Could not verify the phone number.",
          });
        }
      },
      finishInvitationWithoutPhone: async () => {
        set({
          invitationPending: false,
          phoneOtpPending: false,
          pendingPhone: null,
          authError: null,
          statusMessage: null,
        });
        await get().loadSession(get().session);
      },
      inviteCollector: async (email, fullName) => {
        set({ isInviting: true, authError: null, statusMessage: null });
        try {
          const { error } = await supabase.functions.invoke("invite-collector", {
            body: { email, fullName },
          });
          set({
            isInviting: false,
            authError: error?.message ?? null,
            statusMessage: error ? null : `Invitation sent to ${email}.`,
          });
        } catch (error: unknown) {
          set({
            isInviting: false,
            authError:
              error instanceof Error ? error.message : "Could not send the invitation.",
          });
        }
      },
      signOut: async () => {
        set({ isLoading: true, authError: null, statusMessage: null });
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
            invitationPending: false,
            phoneOtpPending: false,
            pendingPhone: null,
            authError: null,
          });
        } catch (error: unknown) {
          set({
            isLoading: false,
            authError: error instanceof Error ? error.message : "Could not sign out.",
          });
        }
      },
      setInvitationPending: (pending) => set({ invitationPending: pending }),
      setAuthError: (message) => set({ authError: message }),
      clearStatusMessage: () => set({ statusMessage: null }),
    }),
    {
      name: "takalex-auth-state",
      storage: createJSONStorage(() => authStorage),
      partialize: (state) => ({
        session: state.session,
        user: state.user,
        profile: state.profile,
        role: state.role,
        invitationPending: state.invitationPending,
      }),
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          const message =
            error instanceof Error ? error.message : "Secure storage could not be read.";
          state?.setAuthError(`Could not restore saved account information: ${message}`);
        }
        state?.setIsHydrated();
      },
    },
  ),
);
