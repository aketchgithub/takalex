import type { ReactElement } from "react";
import { Redirect } from "expo-router";

import { Message, Screen } from "@/components/Ui";
import { useAuthStore } from "@/stores/authStore";
import type { UserRole } from "@/types/auth";

// Used by every role layout. Renders children only for a signed-in user whose
// profile loaded without error, is active and has exactly this role. Anyone
// else goes to the sign-in screen. If they are signed in, the (auth) layout
// sends them on to app/index.tsx, which shows the inactive / unavailable
// message or routes to the correct home. (RLS still decides what data each
// screen can read.)
//
// Never redirect to "/" from here: inside a role group "/" resolves to that
// group's own index (every group has one), which lands back in this gate
// and loops.
export function RoleGate({ role, children }: { role: UserRole; children: ReactElement }) {
  const isLoading = useAuthStore((state) => state.isLoading);
  const session = useAuthStore((state) => state.session);
  const profile = useAuthStore((state) => state.profile);
  const authError = useAuthStore((state) => state.authError);

  if (isLoading) {
    return (
      <Screen title="Loading your account">
        <Message>Please wait while Takalex verifies your account.</Message>
      </Screen>
    );
  }
  if (!session || authError || !profile || !profile.is_active || profile.role !== role) {
    return <Redirect href="/(auth)/login" />;
  }
  return children;
}
