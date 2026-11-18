import { useState, type ComponentRef, type PropsWithChildren, type RefObject } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";

import { OFFLINE_NOTICE } from "@/lib/authResolution";
import { useAuthStore } from "@/stores/authStore";
import { radius, space, touch, type, type Palette } from "@/theme/tokens";
import { useFontSize } from "@/theme/useFontSize";
import { useColors, useThemedStyles } from "@/theme/useTheme";

// Colours, spacing and sizes come from theme/tokens.ts, in the light or dark
// colour set (theme/useTheme.ts); font sizes follow the user's text size
// (theme/useFontSize.ts).

export type ScreenScrollView = ComponentRef<typeof ScrollView>;

// One spacing scale for every screen.
export const uiSpace = { xs: space.xs, sm: space.sm, md: space.md, lg: space.lg } as const;

// A page under a navigation header: the header already covers the top inset.
const UNDER_HEADER_EDGES: Edge[] = ["left", "right", "bottom"];

// onRefresh (optional) turns on pull to refresh; refreshing shows the
// spinner while the reload runs.
// align: "center" (default; login, activate, public pages) or "top" (signed-in
// screens). brand={false} hides the TAKALEX line on pages that sit under a
// navigation header, which then is the one title area; title may be left out
// there when the header already says it.
export function Screen({
  align = "center",
  brand = true,
  children,
  subtitle,
  title,
  refreshing = false,
  onRefresh,
  scrollRef,
  topLink,
}: PropsWithChildren<{
  // A link above the TAKALEX line, e.g. "‹ Back to home" on the public forms.
  topLink?: { label: string; onPress: () => void };
  // Lets a screen scroll itself, e.g. back to the top.
  scrollRef?: RefObject<ScreenScrollView | null>;
  align?: "center" | "top";
  brand?: boolean;
  title?: string;
  subtitle?: string;
  refreshing?: boolean;
  onRefresh?: () => void;
}>) {
  const fs = useFontSize();
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  return (
    <SafeAreaView edges={brand ? undefined : UNDER_HEADER_EDGES} style={styles.safeArea}>
      {/* Android draws apps edge to edge, so the window no longer shrinks when
          the keyboard opens. This pads the scroll area by the part the keyboard
          covers, so every field and button can still be scrolled to. */}
      <KeyboardAvoidingView behavior="padding" style={styles.keyboard}>
        <ScrollView
          contentContainerStyle={[styles.content, align === "top" ? styles.contentTop : null]}
          keyboardShouldPersistTaps="handled"
          ref={scrollRef}
          refreshControl={
            onRefresh ? (
              <RefreshControl colors={[colors.primary]} onRefresh={onRefresh} refreshing={refreshing} tintColor={colors.primary} />
            ) : undefined
          }
        >
          {topLink ? (
            <View style={styles.topLink}>
              <InlineLink label={topLink.label} large onPress={topLink.onPress} />
            </View>
          ) : null}
          {brand ? <Text style={styles.brand}>TAKALEX</Text> : null}
          <OfflineNotice />
          {title ? (
            <Text accessibilityRole="header" style={[styles.title, { fontSize: fs(type.display) }]}>
              {title}
            </Text>
          ) : null}
          {subtitle ? (
            <Text
              style={[
                styles.subtitle,
                { fontSize: fs(14), lineHeight: fs(21) },
                title ? null : styles.subtitleAlone,
              ]}
            >
              {subtitle}
            </Text>
          ) : null}
          <View style={[styles.body, title || subtitle ? null : styles.bodyAlone]}>{children}</View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// Shown on every screen while the signed-in user's profile could not be
// checked with the server and the cached one is in use.
function OfflineNotice() {
  const offline = useAuthStore((state) => state.offline === "cached" && state.session !== null);
  const fs = useFontSize();
  const styles = useThemedStyles(makeStyles);
  if (!offline) return null;
  return (
    <Text accessibilityRole="alert" style={[styles.offline, { fontSize: fs(type.meta) }]}>
      {OFFLINE_NOTICE}
    </Text>
  );
}

// revealable: a password field with a Show/Hide control. The text starts
// hidden, and secureTextEntry from the caller is ignored.
// labelAction: a small link on the label's line, e.g. "Forgot password?".
export function Field({
  error,
  label,
  labelAction,
  revealable = false,
  ...inputProps
}: TextInputProps & {
  error?: string;
  label: string;
  labelAction?: { label: string; onPress: () => void };
  revealable?: boolean;
}) {
  const [hidden, setHidden] = useState(true);
  const fs = useFontSize();
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const input = (
    <TextInput
      accessibilityLabel={label}
      autoCapitalize="none"
      placeholderTextColor={colors.placeholder}
      style={[
        styles.input,
        { fontSize: fs(type.body) },
        revealable ? styles.inputRevealable : null,
        error ? styles.inputError : null,
      ]}
      {...inputProps}
      secureTextEntry={revealable ? hidden : inputProps.secureTextEntry}
    />
  );
  return (
    <View style={styles.field}>
      {labelAction ? (
        <View style={styles.labelRow}>
          <Text style={[styles.label, { fontSize: fs(type.label) }]}>{label}</Text>
          <Pressable accessibilityRole="button" hitSlop={LINK_HIT_SLOP} onPress={labelAction.onPress}>
            <Text style={[styles.labelAction, { fontSize: fs(type.label) }]}>{labelAction.label}</Text>
          </Pressable>
        </View>
      ) : (
        <Text style={[styles.label, { fontSize: fs(type.label) }]}>{label}</Text>
      )}
      {revealable ? (
        <View>
          {input}
          <Pressable
            accessibilityLabel={hidden ? `Show ${label.toLowerCase()}` : `Hide ${label.toLowerCase()}`}
            accessibilityRole="button"
            onPress={() => setHidden((value) => !value)}
            style={styles.reveal}
          >
            <Text style={[styles.revealText, { fontSize: fs(type.label) }]}>{hidden ? "Show" : "Hide"}</Text>
          </Pressable>
        </View>
      ) : (
        input
      )}
      {error ? <Text style={[styles.error, { fontSize: fs(type.label), lineHeight: fs(18) }]}>{error}</Text> : null}
    </View>
  );
}

// loadingLabel: text shown beside the spinner while loading, e.g.
// "Signing in…". Without it only the spinner shows.
export function PrimaryButton({
  disabled = false,
  label,
  loading = false,
  loadingLabel,
  onPress,
}: {
  disabled?: boolean;
  label: string;
  loading?: boolean;
  loadingLabel?: string;
  onPress: () => void;
}) {
  const fs = useFontSize();
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const textStyle = [styles.buttonText, { fontSize: fs(type.body) }];
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
      {loading && loadingLabel ? (
        <View style={styles.buttonLoading}>
          <ActivityIndicator color={colors.onPrimary} />
          <Text style={textStyle}>{loadingLabel}</Text>
        </View>
      ) : loading ? (
        <ActivityIndicator color={colors.onPrimary} />
      ) : (
        <Text style={textStyle}>{label}</Text>
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
  const fs = useFontSize();
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const color = tone === "danger" ? colors.danger : colors.primary;
  const borderColor = tone === "danger" ? colors.dangerBorder : colors.inputBorder;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.secondaryButton,
        large ? styles.secondaryButtonLarge : null,
        { borderColor },
        pressed && !disabled && !loading ? styles.buttonPressed : null,
        disabled || loading ? styles.buttonDisabled : null,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={color} />
      ) : (
        <Text style={[styles.secondaryButtonText, { color, fontSize: fs(type.body) }]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function Message({
  children,
  tone = "info",
}: PropsWithChildren<{ tone?: "error" | "info" | "success" }>) {
  const fs = useFontSize();
  const styles = useThemedStyles(makeStyles);
  return (
    <Text
      accessibilityRole="alert"
      style={[
        styles.message,
        { fontSize: fs(14), lineHeight: fs(20) },
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
  const fs = useFontSize();
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={large ? undefined : LINK_HIT_SLOP}
      onPress={onPress}
      style={[styles.link, large ? styles.linkLarge : null]}
    >
      <Text style={[styles.linkText, { fontSize: fs(large ? type.body : 14) }]}>{label}</Text>
    </Pressable>
  );
}

// The default link is about 32dp tall; this makes its touch area 48dp.
const LINK_HIT_SLOP = { bottom: 8, top: 8 };

// Shared pieces so cards, section headings and field labels look the same on
// every screen. In a component: const ui = useUiStyles(). In another file's
// style factory: const ui = uiStylesOf(c).
const makeUiStyles = (colors: Palette) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: radius.lg,
      borderWidth: 1,
      gap: uiSpace.xs,
      padding: uiSpace.md,
    },
    sectionHeading: { color: colors.text, fontSize: type.title, fontWeight: "700" },
    cardTitle: { color: colors.text, fontSize: type.cardTitle, fontWeight: "700" },
    fieldLabel: { color: colors.text, fontSize: type.label, fontWeight: "600" },
    meta: { color: colors.muted, fontSize: type.meta, lineHeight: 18 },
    // Label above its chips or input.
    fieldGroup: { gap: uiSpace.xs },
    // Heading above a list of cards.
    section: { gap: uiSpace.sm },
    // Selectable chip: 44dp touch target.
    chip: {
      backgroundColor: colors.surface,
      borderColor: colors.inputBorder,
      borderRadius: radius.pill,
      borderWidth: 1,
      justifyContent: "center",
      minHeight: touch.min,
      paddingHorizontal: 14,
    },
    chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipText: { color: colors.text, fontSize: 14, fontWeight: "600" },
    chipTextSelected: { color: colors.onPrimary },
    chipRow: { flexDirection: "row", flexWrap: "wrap", gap: uiSpace.xs },
  });

const uiStylesCache = new WeakMap<Palette, ReturnType<typeof makeUiStyles>>();

export function uiStylesOf(colors: Palette): ReturnType<typeof makeUiStyles> {
  let ui = uiStylesCache.get(colors);
  if (!ui) {
    ui = makeUiStyles(colors);
    uiStylesCache.set(colors, ui);
  }
  return ui;
}

export function useUiStyles(): ReturnType<typeof makeUiStyles> {
  return uiStylesOf(useColors());
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    safeArea: {
      backgroundColor: colors.background,
      flex: 1,
    },
    keyboard: {
      flex: 1,
    },
    content: {
      flexGrow: 1,
      justifyContent: "center",
      padding: 24,
    },
    topLink: {
      marginBottom: 8,
    },
    contentTop: {
      justifyContent: "flex-start",
    },
    subtitleAlone: {
      marginTop: 0,
    },
    bodyAlone: {
      marginTop: 0,
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
      backgroundColor: colors.warningSoft,
      borderColor: colors.warning,
      borderRadius: radius.sm,
      borderWidth: 1,
      color: colors.warning,
      fontSize: type.meta,
      fontWeight: "600",
      marginBottom: 10,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    title: {
      color: colors.text,
      fontSize: type.display,
      fontWeight: "700",
      letterSpacing: -0.3,
    },
    subtitle: {
      color: colors.muted,
      fontSize: 14,
      lineHeight: 21,
      marginTop: space.xxs,
    },
    body: {
      gap: space.md,
      marginTop: space.lg,
    },
    field: {
      gap: 6,
    },
    label: {
      color: colors.text,
      fontSize: type.label,
      fontWeight: "600",
    },
    labelRow: {
      alignItems: "baseline",
      flexDirection: "row",
      justifyContent: "space-between",
    },
    labelAction: {
      color: colors.primary,
      fontSize: type.label,
      fontWeight: "600",
    },
    input: {
      backgroundColor: colors.surface,
      borderColor: colors.inputBorder,
      borderRadius: radius.md,
      borderWidth: 1,
      color: colors.text,
      fontSize: type.body,
      minHeight: touch.button,
      paddingHorizontal: 14,
    },
    inputError: {
      borderColor: colors.danger,
    },
    // Room for the Show/Hide control.
    inputRevealable: {
      paddingRight: 76,
    },
    reveal: {
      alignItems: "center",
      bottom: 0,
      justifyContent: "center",
      minWidth: 68,
      paddingHorizontal: 12,
      position: "absolute",
      right: 0,
      top: 0,
    },
    revealText: {
      color: colors.primary,
      fontSize: type.label,
      fontWeight: "600",
    },
    button: {
      alignItems: "center",
      backgroundColor: colors.primary,
      borderRadius: radius.md,
      justifyContent: "center",
      minHeight: touch.button,
      paddingHorizontal: 18,
    },
    buttonPressed: {
      opacity: 0.85,
    },
    buttonDisabled: {
      opacity: 0.6,
    },
    buttonLoading: {
      alignItems: "center",
      flexDirection: "row",
      gap: 10,
    },
    buttonText: {
      color: colors.onPrimary,
      fontSize: type.body,
      fontWeight: "600",
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
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      justifyContent: "center",
      minHeight: touch.button,
      paddingHorizontal: 16,
    },
    secondaryButtonLarge: {
      paddingHorizontal: 18,
    },
    secondaryButtonText: {
      fontSize: type.body,
      fontWeight: "600",
    },
    link: {
      alignSelf: "flex-start",
      paddingVertical: 6,
    },
    linkLarge: {
      justifyContent: "center",
      minHeight: 48,
    },
    linkText: {
      color: colors.primary,
      fontSize: 14,
      fontWeight: "600",
    },
  });
