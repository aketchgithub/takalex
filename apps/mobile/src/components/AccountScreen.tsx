// The Account tab, the same for every role: who you are (name, role, the
// collector's group, email, assigned sites), Security (change password; the
// phone for password reset while SMS reset is switched on), Display (text
// size, kept on this phone), About (app version) and Sign out. Sites are read
// from the database under RLS (lib/account.ts).

import Feather from "@expo/vector-icons/Feather";
import Constants from "expo-constants";
import { router } from "expo-router";
import { useEffect, useState, type PropsWithChildren } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { Message, Screen, SecondaryButton, uiColors, uiStyles } from "@/components/Ui";
import { collectorGroupLabel, loadAccountSummary, type AssignedSite } from "@/lib/account";
import { appVersionLabel, initials, roleLine, showsAssignedSites } from "@/lib/accountView";
import { SMS_PASSWORD_RESET } from "@/lib/features";
import { formatPhone } from "@/lib/phoneNumber";
import { useAuthStore } from "@/stores/authStore";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { TEXT_SIZES } from "@/theme/textSize";
import { radius, touch, type } from "@/theme/tokens";
import { useFontSize } from "@/theme/useFontSize";
import { roleLabels } from "@/types/auth";

type SitesState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; sites: AssignedSite[] };

export function AccountScreen() {
  const fs = useFontSize();
  const profile = useAuthStore((state) => state.profile);
  const email = useAuthStore((state) => state.session?.user.email ?? null);
  // The number on the Auth account (verified by SMS), used for "Forgot password?".
  const phone = formatPhone(useAuthStore((state) => state.session?.user.phone));
  const signOut = useAuthStore((state) => state.signOut);
  const isSigningOut = useAuthStore((state) => state.isLoading);
  const [sites, setSites] = useState<SitesState>({ status: "loading" });

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
          <Text style={[uiStyles.cardTitle, { fontSize: fs(type.cardTitle) }]}>{profile.full_name ?? "Name not set"}</Text>
          <Text style={[uiStyles.meta, { fontSize: fs(type.meta) }]}>{roleLine(roleLabels[profile.role], group)}</Text>
          {email ? <Text style={[uiStyles.meta, { fontSize: fs(type.meta) }]}>{email}</Text> : null}
        </View>
      </View>

      {needsSites ? (
        <Section title="Assigned sites">
          <View style={styles.padded}>
            {sites.status === "loading" ? <ActivityIndicator color={uiColors.primary} /> : null}
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
          <Text style={[uiStyles.fieldLabel, { fontSize: fs(type.label) }]}>Text size</Text>
          <TextSizeControl />
          <Text style={[uiStyles.meta, { fontSize: fs(type.meta) }]}>
            Saved on this phone. Your phone&apos;s own font size setting also applies.
          </Text>
        </View>
      </Section>

      <Section title="About">
        <View style={[styles.padded, styles.aboutRow]}>
          <Text style={[styles.value, { fontSize: fs(type.body) }]}>App version</Text>
          <Text style={[uiStyles.meta, { fontSize: fs(type.meta) }]}>{appVersionLabel(Constants.expoConfig?.version)}</Text>
        </View>
      </Section>

      <SecondaryButton label="Sign out" tone="danger" loading={isSigningOut} onPress={() => void signOut()} />
    </Screen>
  );
}

function Section({ title, children }: PropsWithChildren<{ title: string }>) {
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
  const fs = useFontSize();
  return (
    <Pressable
      accessibilityHint={detail}
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.linkRow, pressed ? styles.pressed : null]}
    >
      <Feather color={uiColors.primary} name={icon} size={20} />
      <View style={styles.linkText}>
        <Text style={[styles.value, { fontSize: fs(type.body) }]}>{label}</Text>
        {detail ? <Text style={[uiStyles.meta, { fontSize: fs(type.meta) }]}>{detail}</Text> : null}
      </View>
      <Feather color={uiColors.muted} name="chevron-right" size={20} />
    </Pressable>
  );
}

function TextSizeControl() {
  const fs = useFontSize();
  const textSize = usePreferencesStore((state) => state.textSize);
  const setTextSize = usePreferencesStore((state) => state.setTextSize);
  return (
    <View accessibilityRole="radiogroup" style={styles.segments}>
      {TEXT_SIZES.map((option) => {
        const selected = option.value === textSize;
        return (
          <Pressable
            key={option.value}
            accessibilityLabel={`Text size ${option.label}`}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            onPress={() => setTextSize(option.value)}
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

const styles = StyleSheet.create({
  profile: { ...uiStyles.card, alignItems: "center", flexDirection: "row", gap: 14 },
  avatar: {
    alignItems: "center",
    backgroundColor: uiColors.primarySoft,
    borderRadius: radius.pill,
    height: 56,
    justifyContent: "center",
    width: 56,
  },
  avatarText: { color: uiColors.primary, fontWeight: "700" },
  profileText: { flex: 1, gap: 2 },
  section: { gap: 8 },
  sectionTitle: { color: uiColors.muted, fontWeight: "700", letterSpacing: 0.5, paddingHorizontal: 4 },
  sectionCard: { ...uiStyles.card, gap: 0, padding: 0, overflow: "hidden" },
  padded: { gap: 8, padding: 16 },
  aboutRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  value: { color: uiColors.text },
  linkRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    minHeight: touch.button + 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  linkText: { flex: 1, gap: 2 },
  pressed: { backgroundColor: uiColors.background },
  rowDivider: { backgroundColor: uiColors.divider, height: 1, marginLeft: 48 },
  segments: {
    backgroundColor: uiColors.track,
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
  segmentSelected: { backgroundColor: uiColors.primary },
  segmentText: { color: uiColors.text, fontWeight: "600" },
  segmentTextSelected: { color: uiColors.white },
});
