import { useEffect, useRef } from "react";
import { Linking } from "react-native";
import { router } from "expo-router";

import { Message, Screen } from "@/components/Ui";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/authStore";

function getCallbackParameters(url: string): URLSearchParams {
  const query = url.split("?")[1]?.split("#")[0] ?? "";
  const fragment = url.split("#")[1] ?? "";
  const parameters = new URLSearchParams(query);
  new URLSearchParams(fragment).forEach((value, key) => {
    parameters.set(key, value);
  });
  return parameters;
}

async function handleInvitationUrl(url: string): Promise<void> {
  const parsedUrl = new URL(url);
  if (
    parsedUrl.protocol !== "takalex:" ||
    parsedUrl.hostname !== "auth" ||
    parsedUrl.pathname !== "/callback"
  ) {
    return;
  }

  const parameters = getCallbackParameters(url);
  const type = parameters.get("type");
  if (type !== "invite") {
    useAuthStore
      .getState()
      .setAuthError("This link is not a collector invitation.");
    router.replace("/(auth)/login");
    return;
  }

  const description =
    parameters.get("error_description") ?? parameters.get("error");
  if (description) {
    useAuthStore.getState().setAuthError(description);
    router.replace("/(auth)/login");
    return;
  }

  try {
    const accessToken = parameters.get("access_token");
    const refreshToken = parameters.get("refresh_token");
    if (accessToken && refreshToken) {
      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (error) {
        useAuthStore.getState().setAuthError(error.message);
        router.replace("/(auth)/login");
        return;
      }
    } else {
      const tokenHash = parameters.get("token_hash");
      if (!tokenHash) {
        useAuthStore
          .getState()
          .setAuthError("This invitation link is invalid or has expired.");
        router.replace("/(auth)/login");
        return;
      }

      const { error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: "invite",
      });
      if (error) {
        useAuthStore.getState().setAuthError(error.message);
        router.replace("/(auth)/login");
        return;
      }
    }
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Could not verify the invitation link.";
    useAuthStore.getState().setAuthError(message);
    router.replace("/(auth)/login");
    return;
  }

  useAuthStore.getState().setInvitationPending(true);
  router.replace("/(auth)/register");
}

export default function AuthCallbackScreen() {
  const handledUrls = useRef(new Set<string>());

  useEffect(() => {
    let active = true;
    const processUrl = (url: string) => {
      if (!handledUrls.current.has(url)) {
        handledUrls.current.add(url);
        void handleInvitationUrl(url);
      }
    };
    const subscription = Linking.addEventListener("url", ({ url }) => {
      if (active) {
        processUrl(url);
      }
    });

    void Linking.getInitialURL()
      .then((url) => {
        if (active && url) {
          processUrl(url);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          const message =
            error instanceof Error ? error.message : "Could not open invitation link.";
          useAuthStore.getState().setAuthError(message);
        }
      });

    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return (
    <Screen title="Verifying invitation">
      <Message>Checking your invitation and preparing your account.</Message>
    </Screen>
  );
}
