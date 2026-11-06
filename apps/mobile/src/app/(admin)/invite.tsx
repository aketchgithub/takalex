import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { z } from "zod";

import {
  Field,
  InlineLink,
  Message,
  PrimaryButton,
  Screen,
  uiColors,
} from "@/components/Ui";
import { getActiveSites, type SiteOption } from "@/lib/sites";
import { useAuthStore } from "@/stores/authStore";
import { roleLabels, type InviteRole } from "@/types/auth";

// Same limits as invite-user.
const emailSchema = z.string().trim().max(254).email("Enter a valid email address.");
const nameSchema = z
  .string()
  .trim()
  .min(2, "Full name must contain between 2 and 120 characters.")
  .max(120, "Full name must contain between 2 and 120 characters.");

const roles: { value: InviteRole; description: string }[] = [
  { value: "collector", description: "Records deliveries at their site." },
  { value: "site_manager", description: "Verifies and reviews deliveries for their sites." },
  { value: "recycler", description: "Sees available sorted material. No site needed." },
];

// Lives only in this screen's state. It is cleared when dismissed and when the
// screen loses focus, and is never written to the auth store or to storage.
type IssuedInvitation = {
  code: string;
  email: string;
  role: InviteRole;
  expiresAt: string | null;
};

function formatExpiry(expiresAt: string | null): string {
  if (!expiresAt) return "in 7 days";
  const date = new Date(expiresAt);
  return Number.isNaN(date.getTime()) ? "in 7 days" : date.toLocaleString();
}

export default function InviteUserScreen() {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<InviteRole>("collector");
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [selectedSiteIds, setSelectedSiteIds] = useState<string[]>([]);
  const [isLoadingSites, setIsLoadingSites] = useState(true);
  const [siteError, setSiteError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssuedInvitation | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);

  const inviteUser = useAuthStore((state) => state.inviteUser);
  const isInviting = useAuthStore((state) => state.isInviting);

  const sitesRequired = role !== "recycler";

  useEffect(() => {
    let isMounted = true;

    async function loadSites() {
      setIsLoadingSites(true);
      setSiteError(null);

      try {
        const activeSites = await getActiveSites();
        if (isMounted) {
          setSites(activeSites);
        }
      } catch (error: unknown) {
        if (isMounted) {
          setSiteError(
            error instanceof Error ? error.message : "Could not load active sites.",
          );
        }
      } finally {
        if (isMounted) {
          setIsLoadingSites(false);
        }
      }
    }

    void loadSites();

    return () => {
      isMounted = false;
    };
  }, []);

  // Leaving the tab or screen drops the code from memory.
  useFocusEffect(
    useCallback(() => {
      return () => {
        setIssued(null);
        setShareError(null);
      };
    }, []),
  );

  function toggleSite(siteId: string) {
    setSelectedSiteIds((current) =>
      current.includes(siteId)
        ? current.filter((id) => id !== siteId)
        : [...current, siteId],
    );
  }

  async function submit() {
    const emailResult = emailSchema.safeParse(email);
    const nameResult = nameSchema.safeParse(fullName);

    if (!emailResult.success) {
      setFormError(emailResult.error.issues[0]?.message ?? "Enter a valid email address.");
      return;
    }
    if (!nameResult.success) {
      setFormError(nameResult.error.issues[0]?.message ?? "Enter a valid name.");
      return;
    }
    if (sitesRequired && selectedSiteIds.length === 0) {
      setFormError("Collectors and site managers must be assigned at least one site.");
      return;
    }

    setFormError(null);
    const result = await inviteUser(emailResult.data, nameResult.data, role, selectedSiteIds);

    if (!result.ok) {
      setFormError(result.message);
      return;
    }

    setIssued({
      code: result.code,
      email: emailResult.data.toLowerCase(),
      role,
      expiresAt: result.expiresAt,
    });
    setEmail("");
    setFullName("");
    setSelectedSiteIds([]);
  }

  async function shareCode(invitation: IssuedInvitation) {
    setShareError(null);
    try {
      await Share.share({
        message:
          `You have been invited to Takalex as a ${roleLabels[invitation.role].toLowerCase()}.\n\n` +
          `Email: ${invitation.email}\n` +
          `Invitation code: ${invitation.code}\n\n` +
          `Open the Takalex app, tap "I have an invitation code" and enter this email and code. ` +
          `The code expires ${formatExpiry(invitation.expiresAt)}.`,
      });
    } catch {
      setShareError("Could not open the share sheet. Copy the code from this screen instead.");
    }
  }

  function dismiss() {
    setIssued(null);
    setShareError(null);
  }

  if (issued) {
    return (
      <Screen title="Invitation created" subtitle={`For ${issued.email} (${roleLabels[issued.role]}).`}>
        <View style={styles.codeCard}>
          <Text style={styles.codeLabel}>Invitation code</Text>
          <Text selectable style={styles.code}>{issued.code}</Text>
          <Text style={styles.codeMeta}>Expires {formatExpiry(issued.expiresAt)}.</Text>
        </View>
        <Message tone="error">
          This code is shown only once. Share it with the invitee now. It cannot
          be shown again; if it is lost, the invitation must be revoked and
          reissued.
        </Message>
        {shareError ? <Message tone="error">{shareError}</Message> : null}
        <PrimaryButton label="Share code" onPress={() => void shareCode(issued)} />
        <InlineLink label="Done, hide the code" onPress={dismiss} />
      </Screen>
    );
  }

  return (
    <Screen
      title="Invite a team member"
      subtitle="Choose the person's role and sites. You will get a one-time code to pass on to them."
    >
      <Field
        autoCapitalize="words"
        label="Full name"
        onChangeText={setFullName}
        placeholder="Team member's full name"
        value={fullName}
      />

      <Field
        autoComplete="email"
        autoCapitalize="none"
        keyboardType="email-address"
        label="Email"
        onChangeText={setEmail}
        placeholder="person@example.com"
        value={email}
      />

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Role</Text>

        {roles.map((item) => {
          const selected = role === item.value;

          return (
            <Pressable
              key={item.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              onPress={() => setRole(item.value)}
              style={[styles.option, selected ? styles.optionSelected : null]}
            >
              <View style={styles.optionContent}>
                <Text style={styles.optionTitle}>{roleLabels[item.value]}</Text>
                <Text style={styles.optionDescription}>{item.description}</Text>
              </View>

              <View style={[styles.radio, selected ? styles.radioSelected : null]} />
            </Pressable>
          );
        })}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          {sitesRequired ? "Assigned sites (at least one)" : "Assigned sites (optional)"}
        </Text>
        <Text style={styles.helper}>
          {sitesRequired
            ? "Select every site this person works at."
            : "Recyclers do not need a site."}
        </Text>

        {isLoadingSites ? (
          <ActivityIndicator color={uiColors.primary} />
        ) : siteError ? (
          <Message tone="error">{siteError}</Message>
        ) : sites.length === 0 ? (
          <Message>No active sites are available.</Message>
        ) : (
          sites.map((site) => {
            const selected = selectedSiteIds.includes(site.id);

            return (
              <Pressable
                key={site.id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
                onPress={() => toggleSite(site.id)}
                style={[styles.siteOption, selected ? styles.siteOptionSelected : null]}
              >
                <View style={[styles.checkbox, selected ? styles.checkboxSelected : null]}>
                  {selected ? <Text style={styles.checkmark}>✓</Text> : null}
                </View>

                <Text style={styles.siteName}>{site.name}</Text>
              </Pressable>
            );
          })
        )}

        <Text style={styles.selectionCount}>
          {selectedSiteIds.length} site(s) selected
        </Text>
      </View>

      {formError ? <Message tone="error">{formError}</Message> : null}

      <PrimaryButton
        disabled={sitesRequired && (isLoadingSites || Boolean(siteError) || sites.length === 0)}
        label="Create invitation"
        loading={isInviting}
        onPress={() => void submit()}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 10,
  },
  sectionTitle: {
    color: uiColors.text,
    fontSize: 16,
    fontWeight: "700",
  },
  helper: {
    color: uiColors.muted,
    fontSize: 13,
    lineHeight: 19,
  },
  option: {
    alignItems: "center",
    backgroundColor: uiColors.white,
    borderColor: uiColors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 14,
  },
  optionSelected: {
    borderColor: uiColors.primary,
    borderWidth: 2,
  },
  optionContent: {
    flex: 1,
    gap: 4,
  },
  optionTitle: {
    color: uiColors.text,
    fontSize: 15,
    fontWeight: "700",
  },
  optionDescription: {
    color: uiColors.muted,
    fontSize: 13,
  },
  radio: {
    borderColor: uiColors.border,
    borderRadius: 10,
    borderWidth: 2,
    height: 20,
    marginLeft: 12,
    width: 20,
  },
  radioSelected: {
    backgroundColor: uiColors.primary,
    borderColor: uiColors.primary,
  },
  siteOption: {
    alignItems: "center",
    backgroundColor: uiColors.white,
    borderColor: uiColors.border,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    padding: 13,
  },
  siteOptionSelected: {
    borderColor: uiColors.primary,
  },
  checkbox: {
    alignItems: "center",
    borderColor: uiColors.border,
    borderRadius: 5,
    borderWidth: 1.5,
    height: 21,
    justifyContent: "center",
    width: 21,
  },
  checkboxSelected: {
    backgroundColor: uiColors.primary,
    borderColor: uiColors.primary,
  },
  checkmark: {
    color: uiColors.white,
    fontSize: 14,
    fontWeight: "800",
  },
  siteName: {
    color: uiColors.text,
    flex: 1,
    fontSize: 14,
    fontWeight: "500",
  },
  selectionCount: {
    color: uiColors.muted,
    fontSize: 12,
  },
  codeCard: {
    alignItems: "center",
    backgroundColor: uiColors.white,
    borderColor: uiColors.primary,
    borderRadius: 14,
    borderWidth: 2,
    gap: 8,
    padding: 20,
  },
  codeLabel: {
    color: uiColors.muted,
    fontSize: 13,
    fontWeight: "600",
  },
  code: {
    color: uiColors.text,
    fontFamily: "monospace",
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: 2,
  },
  codeMeta: {
    color: uiColors.muted,
    fontSize: 13,
  },
});
