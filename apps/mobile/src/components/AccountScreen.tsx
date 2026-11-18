// The Account tab, the same for every role: who you are (name, role, the
// collector's group, email, assigned sites), Security (change password; the
// phone for password reset while SMS reset is switched on), Display (text
// size and light/dark appearance, kept on this phone), About (app version) and Sign out. Sites are read
// from the database under RLS (lib/account.ts).

import Feather from "@expo/vector-icons/Feather";
import Constants from "expo-constants";
import { router } from "expo-router";
import { useEffect, useState, type PropsWithChildren } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { Message, Screen, SecondaryButton, uiStylesOf, useUiStyles } from "@/components/Ui";
import { collectorGroupLabel, loadAccountSummary, type AssignedSite } from "@/lib/account";
import { appVersionLabel, initials, roleLine, showsAssignedSites } from "@/lib/accountView";
import { SMS_PASSWORD_RESET } from "@/lib/features";
import { formatPhone } from "@/lib/phoneNumber";
import { useAuthStore } from "@/stores/authStore";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { APPEARANCES } from "@/theme/appearance";
import { TEXT_SIZES } from "@/theme/textSize";
import { radius, touch, type, type Palette } from "@/theme/tokens";
import { useFontSize } from "@/theme/useFontSize";
import { useColors, useThemedStyles } from "@/theme/useTheme";
import { roleLabels } from "@/types/auth";

type SitesState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; sites: AssignedSite[] };

export function AccountScreen() {
  const c = useColors();
  const ui = useUiStyles();
  const styles = useThemedStyles(makeStyles);
  const fs = useFontSize();
  const profile = useAuthStore((state) => state.profile);
  const email = useAuthStore((state) => state.session?.user.email ?? null);
  // The number on the Auth account (verified by SMS), used for "Forgot password?".
  const phone = formatPhone(useAuthStore((state) => state.session?.user.phone));
  const signOut = useAuthStore((state) => state.signOut);
  const isSigningOut = useAuthStore((state) => state.isLoading);
  const [sites, setSites] = useState<SitesState>({ status: "loading" });
  const textSize = usePreferencesStore((state) => state.textSize);
  const setTextSize = usePreferencesStore((state) => state.setTextSize);
  const appearance = usePreferencesStore((state) => state.appearance);
  const setAppearance = usePreferencesStore((state) => state.setAppearance);

  const needsSites = profile ? showsAssignedSites(profile.role) : false;

  useEffect(() => {
    if (!profile || !needsSites) return;
    let active = true;
    loadAccountSummary(profile)
      .then((result) => {
        if (active) setSites({ status: "ready", sites: result.sites });
      })
      .catch((error: unknown) => {
        if (active) {
          setSites({ status: "error", message: error instanceof Error ? error.message : "Could not load your account details." });
        }
      });
    return () => {
      active = false;
    };
  }, [profile, needsSites]);

  if (!profile) return null;

  const group =
    profile.role === "collector" && sites.status === "ready" ? collectorGroupLabel(sites.sites) : null;

  return (
    <Screen align="top" title="Account">
      <View style={styles.profile}>
        <View style={styles.avatar}>
          <Text style={[styles.avatarText, { fontSize: fs(type.title) }]}>{initials(profile.full_name)}</Text>
        </View>
        <View style={styles.profileText}>
          <Text style={[ui.cardTitle, { fontSize: fs(type.cardTitle) }]}>{profile.full_name ?? "Name not set"}</Text>
          <Text style={[ui.meta, { fontSize: fs(type.meta) }]}>{roleLine(roleLabels[profile.role], group)}</Text>
          {email ? <Text style={[ui.meta, { fontSize: fs(type.meta) }]}>{email}</Text> : null}
        </View>
      </View>

      {needsSites ? (
        <Section title="Assigned sites">
          <View style={styles.padded}>
            {sites.status === "loading" ? <ActivityIndicator color={c.primary} /> : null}
            {sites.status === "error" ? <Message tone="error">{sites.message}</Message> : null}
            {sites.status === "ready" && sites.sites.length === 0 ? (
              <Text style={[styles.value, { fontSize: fs(type.body) }]}>
                You have no assigned sites. Ask an administrator to assign one.
              </Text>
            ) : null}
            {sites.status === "ready"
              ? sites.sites.map((site) => (
                  <Text key={site.id} style={[styles.value, { fontSize: fs(type.body) }]}>
                    {site.name}
                    {site.active ? "" : " (inactive)"}
                  </Text>
                ))
              : null}
          </View>
        </Section>
      ) : null}

      <Section title="Security">
        {/* Root routes outside the role groups, so every role reaches them. "as any":
            the generated route types only learn new routes when Expo next starts. */}
        <LinkRow icon="lock" label="Change password" onPress={() => router.push("/change-password" as any)} />
        {/* Only while SMS password reset is switched on (lib/features.ts). */}
        {SMS_PASSWORD_RESET ? (
          <>
            <View style={styles.rowDivider} />
            <LinkRow
              icon="smartphone"
              label="Phone for password reset"
              detail={phone ?? "Not added yet. Add it so you can reset your password by SMS."}
              onPress={() => router.push("/phone-number" as any)}
            />
          </>
        ) : null}
      </Section>

      <Section title="Display">
        <View style={styles.padded}>
          <Text style={[ui.fieldLabel, { fontSize: fs(type.label) }]}>Text size</Text>
          <Segmented name="Text size" options={TEXT_SIZES} value={textSize} onChange={setTextSize} />
          <Text style={[ui.meta, { fontSize: fs(type.meta) }]}>Your phone&apos;s own font size setting also applies.</Text>
          <Text style={[ui.fieldLabel, styles.spaced, { fontSize: fs(type.label) }]}>Appearance</Text>
          <Segmented name="Appearance" options={APPEARANCES} value={appearance} onChange={setAppearance} />
          <Text style={[ui.meta, { fontSize: fs(type.meta) }]}>
            System follows your phone&apos;s light or dark setting. Both choices are saved on this phone.
          </Text>
        </View>
      </Section>

      <Section title="About">
        <View style={[styles.padded, styles.aboutRow]}>
          <Text style={[styles.value, { fontSize: fs(type.body) }]}>App version</Text>
          <Text style={[ui.meta, { fontSize: fs(type.meta) }]}>{appVersionLabel(Constants.expoConfig?.version)}</Text>
        </View>
      </Section>

      <SecondaryButton label="Sign out" tone="danger" loading={isSigningOut} onPress={() => void signOut()} />
    </Screen>
  );
}

function Section({ title, children }: PropsWithChildren<{ title: string }>) {
  const styles = useThemedStyles(makeStyles);
  const fs = useFontSize();
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={[styles.sectionTitle, { fontSize: fs(type.label) }]}>
        {title.toUpperCase()}
      </Text>
      <View style={styles.sectionCard}>{children}</View>
    </View>
  );
}

function LinkRow({
  icon,
  label,
  detail,
  onPress,
}: {
  icon: "lock" | "smartphone";
  label: string;
  detail?: string;
  onPress: () => void;
}) {
  const c = useColors();
  const ui = useUiStyles();
  const styles = useThemedStyles(makeStyles);
  const fs = useFontSize();
  return (
    <Pressable
      accessibilityHint={detail}
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.linkRow, pressed ? styles.pressed : null]}
    >
      <Feather color={c.primary} name={icon} size={20} />
      <View style={styles.linkText}>
        <Text style={[styles.value, { fontSize: fs(type.body) }]}>{label}</Text>
        {detail ? <Text style={[ui.meta, { fontSize: fs(type.meta) }]}>{detail}</Text> : null}
      </View>
      <Feather color={c.muted} name="chevron-right" size={20} />
    </Pressable>
  );
}

// Three side-by-side choices, one selected (Text size, Appearance).
function Segmented<T extends string>({
  name,
  options,
  value,
  onChange,
}: {
  name: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const fs = useFontSize();
  return (
    <View accessibilityRole="radiogroup" style={styles.segments}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityLabel={`${name} ${option.label}`}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            onPress={() => onChange(option.value)}
            style={[styles.segment, selected ? styles.segmentSelected : null]}
          >
            <Text style={[styles.segmentText, selected ? styles.segmentTextSelected : null, { fontSize: fs(type.body) }]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    profile: { ...uiStylesOf(c).card, alignItems: "center", flexDirection: "row", gap: 14 },
    avatar: {
      alignItems: "center",
      backgroundColor: c.primarySoft,
      borderRadius: radius.pill,
      height: 56,
      justifyContent: "center",
      width: 56,
    },
    avatarText: { color: c.primary, fontWeight: "700" },
    profileText: { flex: 1, gap: 2 },
    section: { gap: 8 },
    sectionTitle: { color: c.muted, fontWeight: "700", letterSpacing: 0.5, paddingHorizontal: 4 },
    sectionCard: { ...uiStylesOf(c).card, gap: 0, padding: 0, overflow: "hidden" },
    padded: { gap: 8, padding: 16 },
    aboutRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
    value: { color: c.text },
    linkRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: 12,
      minHeight: touch.button + 8,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    linkText: { flex: 1, gap: 2 },
    pressed: { backgroundColor: c.background },
    rowDivider: { backgroundColor: c.divider, height: 1, marginLeft: 48 },
    spaced: { marginTop: 8 },
    segments: {
      backgroundColor: c.track,
      borderRadius: radius.md,
      flexDirection: "row",
      gap: 4,
      padding: 4,
    },
    segment: {
      alignItems: "center",
      borderRadius: radius.sm,
      flex: 1,
      justifyContent: "center",
      minHeight: touch.min,
    },
    segmentSelected: { backgroundColor: c.primary },
    segmentText: { color: c.text, fontWeight: "600" },
    segmentTextSelected: { color: c.onPrimary },
  });
