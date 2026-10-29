import type { PropsWithChildren } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const colors = {
  background: "#f6f7f2",
  border: "#d9dfd1",
  danger: "#9b2c2c",
  muted: "#5b6658",
  primary: "#236b47",
  text: "#1d2b22",
  white: "#ffffff",
};

export function Screen({
  children,
  subtitle,
  title,
}: PropsWithChildren<{ title: string; subtitle?: string }>) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.brand}>TAKALEX</Text>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        <View style={styles.body}>{children}</View>
      </ScrollView>
    </SafeAreaView>
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

export function Message({
  children,
  tone = "info",
}: PropsWithChildren<{ tone?: "error" | "info" }>) {
  return (
    <Text
      accessibilityRole="alert"
      style={[styles.message, tone === "error" ? styles.error : null]}
    >
      {children}
    </Text>
  );
}

export function InlineLink({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.link}>
      <Text style={styles.linkText}>{label}</Text>
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
  link: {
    alignSelf: "flex-start",
    paddingVertical: 6,
  },
  linkText: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: "600",
  },
});
