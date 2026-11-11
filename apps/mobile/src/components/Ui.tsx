import type { PropsWithChildren } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { OFFLINE_NOTICE } from "@/lib/authResolution";
import { useAuthStore } from "@/stores/authStore";

const colors = {
  background: "#f6f7f2",
  border: "#d9dfd1",
  danger: "#9b2c2c",
  muted: "#5b6658",
  primary: "#236b47",
  text: "#1d2b22",
  white: "#ffffff",
};

// onRefresh (optional) turns on pull to refresh; refreshing shows the
// spinner while the reload runs.
export function Screen({
  children,
  subtitle,
  title,
  refreshing = false,
  onRefresh,
}: PropsWithChildren<{ title: string; subtitle?: string; refreshing?: boolean; onRefresh?: () => void }>) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          onRefresh ? (
            <RefreshControl colors={[colors.primary]} onRefresh={onRefresh} refreshing={refreshing} tintColor={colors.primary} />
          ) : undefined
        }
      >
        <Text style={styles.brand}>TAKALEX</Text>
        <OfflineNotice />
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        <View style={styles.body}>{children}</View>
      </ScrollView>
    </SafeAreaView>
  );
}

// Shown on every screen while the signed-in user's profile could not be
// checked with the server and the cached one is in use.
function OfflineNotice() {
  const offline = useAuthStore((state) => state.offline === "cached" && state.session !== null);
  if (!offline) return null;
  return (
    <Text accessibilityRole="alert" style={styles.offline}>
      {OFFLINE_NOTICE}
    </Text>
  );
}

export function Field({
  error,
  label,
  ...inputProps
}: TextInputProps & { error?: string; label: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        autoCapitalize="none"
        placeholderTextColor="#798274"
        style={[styles.input, error ? styles.inputError : null]}
        {...inputProps}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

export function PrimaryButton({
  disabled = false,
  label,
  loading = false,
  onPress,
}: {
  disabled?: boolean;
  label: string;
  loading?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        pressed && !disabled && !loading ? styles.buttonPressed : null,
        disabled || loading ? styles.buttonDisabled : null,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors.white} />
      ) : (
        <Text style={styles.buttonText}>{label}</Text>
      )}
    </Pressable>
  );
}

export function SecondaryButton({
  disabled = false,
  label,
  large = false,
  loading = false,
  onPress,
  tone = "default",
}: {
  disabled?: boolean;
  label: string;
  // Opt-in 52dp height for outdoor use (landing page); the default look is unchanged.
  large?: boolean;
  loading?: boolean;
  onPress: () => void;
  tone?: "default" | "danger";
}) {
  const color = tone === "danger" ? colors.danger : colors.primary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.secondaryButton,
        large ? styles.secondaryButtonLarge : null,
        { borderColor: color },
        pressed && !disabled && !loading ? styles.buttonPressed : null,
        disabled || loading ? styles.buttonDisabled : null,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={color} />
      ) : (
        <Text style={[styles.secondaryButtonText, large ? styles.buttonText : null, { color }]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function Message({
  children,
  tone = "info",
}: PropsWithChildren<{ tone?: "error" | "info" | "success" }>) {
  return (
    <Text
      accessibilityRole="alert"
      style={[
        styles.message,
        tone === "error" ? styles.error : null,
        tone === "success" ? styles.success : null,
      ]}
    >
      {children}
    </Text>
  );
}

export function InlineLink({
  label,
  large = false,
  onPress,
}: {
  label: string;
  // Opt-in 48dp touch target and larger text (landing page).
  large?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[styles.link, large ? styles.linkLarge : null]}>
      <Text style={[styles.linkText, large ? styles.linkTextLarge : null]}>{label}</Text>
    </Pressable>
  );
}

export const uiColors = colors;

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 24,
  },
  brand: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 2,
    marginBottom: 10,
  },
  offline: {
    alignSelf: "flex-start",
    backgroundColor: "#fff4d6",
    borderColor: "#e3c56f",
    borderRadius: 8,
    borderWidth: 1,
    color: "#6b4e00",
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  title: {
    color: colors.text,
    fontSize: 30,
    fontWeight: "700",
  },
  subtitle: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 23,
    marginTop: 8,
  },
  body: {
    gap: 16,
    marginTop: 28,
  },
  field: {
    gap: 7,
  },
  label: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "600",
  },
  input: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    color: colors.text,
    fontSize: 16,
    minHeight: 52,
    paddingHorizontal: 15,
  },
  inputError: {
    borderColor: colors.danger,
  },
  button: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: 12,
    justifyContent: "center",
    minHeight: 52,
    paddingHorizontal: 18,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: "700",
  },
  message: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
  },
  error: {
    color: colors.danger,
  },
  success: {
    color: colors.primary,
    fontWeight: "600",
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: 12,
    borderWidth: 1.5,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 16,
  },
  secondaryButtonLarge: {
    minHeight: 52,
    paddingHorizontal: 18,
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: "700",
  },
  link: {
    alignSelf: "flex-start",
    paddingVertical: 6,
  },
  linkLarge: {
    justifyContent: "center",
    minHeight: 48,
  },
  linkTextLarge: {
    fontSize: 17,
  },
  linkText: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: "600",
  },
});
