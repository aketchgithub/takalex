// The signed-out landing page. Presentation only: React Native core
// components, colours from uiColors, no animation. Everything renders
// offline except the "Collection groups" section, which is hidden until the
// public list of groups has loaded.

import { useEffect, useState } from "react";
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { InlineLink, PrimaryButton, SecondaryButton, uiColors } from "@/components/Ui";
import { getPublicSiteOptions, type PublicSiteOption } from "@/lib/access";

const HERO = require("../../assets/landing-hero.jpg");
// landing-hero.jpg is 1340 x 1400 px.
const HERO_ASPECT = 1400 / 1340;
const HERO_SCREEN_SHARE = 0.4;

const STEPS = [
  {
    title: "Deliver",
    text: "A waste picker brings plastic to their group's site and records it with a photo, even without network.",
  },
  {
    title: "Verify",
    text: "The site manager weighs and sorts it by material, then approves or rejects the delivery.",
  },
  {
    title: "Recycle",
    text: "Recyclers see how much verified material is available at each site.",
  },
];

// Group names from the same helper the request form uses
// (public_site_options). Empty while loading, offline or on failure, and the
// section is then not shown.
function usePublicGroups(): PublicSiteOption[] {
  const [groups, setGroups] = useState<PublicSiteOption[]>([]);
  useEffect(() => {
    let active = true;
    getPublicSiteOptions()
      .then((options) => {
        if (active) setGroups(options);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  return groups;
}

function SectionTitle({ children }: { children: string }) {
  return (
    <Text accessibilityRole="header" style={styles.sectionTitle}>
      {children}
    </Text>
  );
}

export function Landing({
  onInvitationCode,
  onRequestAccess,
  onSignIn,
}: {
  onInvitationCode: () => void;
  onRequestAccess: () => void;
  onSignIn: () => void;
}) {
  const { height, width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const groups = usePublicGroups();

  // The photo is anchored to the top of the hero. At full width it is
  // usually taller than the hero, so the extra is cut from the bottom and
  // the card in its top-right corner stays visible.
  const heroHeight = Math.round(height * HERO_SCREEN_SHARE);
  const imageHeight = Math.max(heroHeight, Math.round(width * HERO_ASPECT));

  // The photo runs under the status bar. Once the page is scrolled past it,
  // a plain strip keeps the text from showing through the status bar.
  const [pastHero, setPastHero] = useState(false);
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = event.nativeEvent.contentOffset.y > heroHeight - insets.top;
    if (next !== pastHero) setPastHero(next);
  };

  const side = { paddingLeft: 24 + insets.left, paddingRight: 24 + insets.right };

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 32 + insets.bottom }}
        onScroll={onScroll}
        scrollEventThrottle={32}
      >
        <View style={[styles.hero, { height: heroHeight }]}>
          <Image
            accessibilityLabel="A waste picker checks a verified delivery on her phone."
            accessibilityRole="image"
            accessible
            resizeMode="cover"
            source={HERO}
            style={[styles.heroImage, { height: imageHeight }]}
          />
        </View>

        <View style={[styles.panel, side]}>
          <Text style={styles.panelBrand}>
            TAKALEX <Text style={styles.panelBrandBy}>by Chemolex</Text>
          </Text>
          <Text accessibilityRole="header" style={styles.headline}>
            Every kilo of plastic, counted and verified.
          </Text>
          <Text style={styles.panelText}>
            Takalex records what waste pickers deliver at each collection site, so the weight is
            checked, recorded and visible to recyclers.
          </Text>
        </View>

        <View style={[styles.actions, side]}>
          <PrimaryButton label="Request access" onPress={onRequestAccess} />
          <SecondaryButton label="Sign in" large onPress={onSignIn} />
          <InlineLink label="I have an invitation code" large onPress={onInvitationCode} />
        </View>

        <View style={[styles.section, side]}>
          <SectionTitle>How it works</SectionTitle>
          {STEPS.map((step, index) => (
            <View key={step.title} style={styles.card}>
              <View style={styles.stepNumber}>
                <Text style={styles.stepNumberText}>{index + 1}</Text>
              </View>
              <View style={styles.stepBody}>
                <Text style={styles.stepTitle}>{step.title}</Text>
                <Text style={styles.bodyText}>{step.text}</Text>
              </View>
            </View>
          ))}
        </View>

        {groups.length > 0 ? (
          <View style={[styles.section, side]}>
            <SectionTitle>Collection groups</SectionTitle>
            <View style={styles.chips}>
              {groups.map((group) => (
                <View key={group.id} style={styles.chip}>
                  <Text style={styles.chipText}>{group.name}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        <View style={[styles.section, side]}>
          <SectionTitle>How to join</SectionTitle>
          <Text style={styles.bodyText}>
            Takalex is by invitation. Request access and an administrator will review it. If you
            are approved, you receive a one-time code by WhatsApp or SMS to activate your account.
          </Text>
        </View>

        <Text style={[styles.footer, side]}>A Chemolex initiative · Green. Clean. Planet.</Text>
      </ScrollView>

      {pastHero ? <View style={[styles.statusBarStrip, { height: insets.top }]} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: uiColors.background,
    flex: 1,
  },
  hero: {
    backgroundColor: uiColors.primary,
    overflow: "hidden",
  },
  heroImage: {
    left: 0,
    position: "absolute",
    top: 0,
    width: "100%",
  },
  panel: {
    backgroundColor: uiColors.primary,
    paddingBottom: 28,
    paddingTop: 24,
  },
  panelBrand: {
    color: uiColors.white,
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 2,
  },
  panelBrandBy: {
    fontWeight: "500",
    letterSpacing: 0.5,
  },
  headline: {
    color: uiColors.white,
    fontSize: 32,
    fontWeight: "800",
    lineHeight: 39,
    marginTop: 10,
  },
  panelText: {
    color: uiColors.white,
    fontSize: 18,
    lineHeight: 26,
    marginTop: 12,
  },
  actions: {
    gap: 12,
    paddingTop: 24,
  },
  section: {
    gap: 12,
    paddingTop: 36,
  },
  sectionTitle: {
    color: uiColors.text,
    fontSize: 24,
    fontWeight: "800",
  },
  card: {
    backgroundColor: uiColors.white,
    borderColor: uiColors.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 14,
    padding: 16,
  },
  stepNumber: {
    alignItems: "center",
    backgroundColor: uiColors.primary,
    borderRadius: 20,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  stepNumberText: {
    color: uiColors.white,
    fontSize: 20,
    fontWeight: "800",
  },
  stepBody: {
    flex: 1,
    gap: 4,
  },
  stepTitle: {
    color: uiColors.text,
    fontSize: 20,
    fontWeight: "800",
  },
  bodyText: {
    color: uiColors.text,
    fontSize: 17,
    lineHeight: 25,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  chip: {
    backgroundColor: uiColors.white,
    borderColor: uiColors.primary,
    borderRadius: 22,
    borderWidth: 1.5,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  chipText: {
    color: uiColors.primary,
    fontSize: 16,
    fontWeight: "700",
  },
  footer: {
    color: uiColors.muted,
    fontSize: 14,
    lineHeight: 20,
    paddingTop: 40,
    textAlign: "center",
  },
  statusBarStrip: {
    backgroundColor: uiColors.background,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
});
