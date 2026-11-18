import type { PropsWithChildren } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { radius, space, type, type Palette } from "@/theme/tokens";
import { useFontSize } from "@/theme/useFontSize";
import { useThemedStyles } from "@/theme/useTheme";

// The signed-out form screens (sign in, activate, forgot password, request
// access): the Takalex mark, title and form in one centred card, and the way
// back as a link at the bottom of the screen (mockup 1, 17 Nov 2026).
// The card is centred when it fits and scrolls when it does not (for example
// with the keyboard open: KeyboardAvoidingView pads the part it covers,
// since Android draws apps edge to edge).
export function AuthScreen({
  children,
  footer,
  subtitle,
  title,
}: PropsWithChildren<{
  title: string;
  subtitle?: string;
  // The way back, e.g. "Back to home" or "Back to sign in".
  footer?: { label: string; onPress: () => void };
}>) {
  const styles = useThemedStyles(makeStyles);
  const fs = useFontSize();
  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView behavior="padding" style={styles.fill}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.middle}>
            <View style={styles.card}>
              <View style={styles.brandRow}>
                {/* Placeholder mark until Chemolex's logo is supplied. */}
                <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.mark}>
                  <Text style={styles.markText}>T</Text>
                </View>
                <View>
                  <Text style={[styles.brandName, { fontSize: fs(18) }]}>Takalex</Text>
                  <Text style={[styles.brandBy, { fontSize: fs(type.caption) }]}>by Chemolex</Text>
                </View>
              </View>

              <View style={styles.heading}>
                <Text accessibilityRole="header" style={[styles.title, { fontSize: fs(22) }]}>
                  {title}
                </Text>
                {subtitle ? (
                  <Text style={[styles.subtitle, { fontSize: fs(14), lineHeight: fs(20) }]}>{subtitle}</Text>
                ) : null}
              </View>

              <View style={styles.body}>{children}</View>
            </View>
          </View>

          {footer ? (
            <Pressable
              accessibilityRole="button"
              hitSlop={{ top: 8, bottom: 8 }}
              onPress={footer.onPress}
              style={styles.footer}
            >
              <Text style={[styles.footerText, { fontSize: fs(14) }]}>‹ {footer.label}</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// A thin rule with a short label in the middle, e.g. "New to Takalex?".
export function Divider({ label }: { label: string }) {
  const styles = useThemedStyles(makeStyles);
  const fs = useFontSize();
  return (
    <View style={styles.dividerRow}>
      <View style={styles.dividerLine} />
      <Text style={[styles.dividerText, { fontSize: fs(type.caption) }]}>{label}</Text>
      <View style={styles.dividerLine} />
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    safeArea: { backgroundColor: c.background, flex: 1 },
    fill: { flex: 1 },
    scroll: {
      flexGrow: 1,
      paddingHorizontal: space.md + space.xxs,
      paddingTop: space.lg,
      paddingBottom: space.md,
    },
    middle: { flexGrow: 1, justifyContent: "center" },
    card: {
      alignSelf: "center",
      backgroundColor: c.surface,
      borderColor: c.border,
      borderRadius: radius.xl,
      borderWidth: 1,
      elevation: 2,
      gap: 18,
      maxWidth: 440,
      paddingHorizontal: space.md + space.xxs,
      paddingVertical: space.lg,
      shadowColor: c.text,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.06,
      shadowRadius: 12,
      width: "100%",
    },
    brandRow: { alignItems: "center", flexDirection: "row", gap: 10 },
    mark: {
      alignItems: "center",
      backgroundColor: c.primary,
      borderRadius: radius.lg,
      height: 40,
      justifyContent: "center",
      width: 40,
    },
    markText: { color: c.onPrimary, fontSize: 20, fontWeight: "800" },
    brandName: { color: c.text, fontSize: 18, fontWeight: "700", letterSpacing: -0.2 },
    brandBy: { color: c.muted, fontSize: type.caption },
    heading: { gap: space.xxs },
    title: { color: c.text, fontSize: 22, fontWeight: "700", letterSpacing: -0.3 },
    subtitle: { color: c.muted, fontSize: 14, lineHeight: 20 },
    body: { gap: 14 },
    footer: { alignSelf: "center", marginTop: space.md, paddingHorizontal: space.md, paddingVertical: space.sm },
    footerText: { color: c.muted, fontSize: 14, fontWeight: "500" },
    dividerRow: { alignItems: "center", flexDirection: "row", gap: 10 },
    dividerLine: { backgroundColor: c.border, flexGrow: 1, height: 1 },
    dividerText: { color: c.muted, fontSize: type.caption },
  });
