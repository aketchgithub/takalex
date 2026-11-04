
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { z } from "zod";

import {
  Field,
  Message,
  PrimaryButton,
  Screen,
  uiColors,
} from "@/components/Ui";
import { getActiveSites, type SiteOption } from "@/lib/sites";
import { useAuthStore } from "@/stores/authStore";

const emailSchema = z.string().trim().email("Enter a valid email address.");
const nameSchema = z
  .string()
  .trim()
  .min(1, "Enter the team member's full name.")
  .max(120, "Name must be 120 characters or fewer.");

const roles = [
  {
    value: "collector",
    label: "Collector",
    description: "Records waste collections.",
  },
  {
    value: "site_manager",
    label: "Site Manager",
    description: "Verifies and reviews collections.",
  },
  {
    value: "recycler",
    label: "Recycler",
    description: "Participates in the recycling workflow.",
  },
] as const;

type InviteRole = (typeof roles)[number]["value"];

export default function InviteCollectorScreen() {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<InviteRole>("collector");
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [selectedSiteIds, setSelectedSiteIds] = useState<string[]>([]);
  const [isLoadingSites, setIsLoadingSites] = useState(true);
  const [siteError, setSiteError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const inviteUser = useAuthStore((state) => state.inviteCollector);
  const isInviting = useAuthStore((state) => state.isInviting);
  const authError = useAuthStore((state) => state.authError);
  const statusMessage = useAuthStore((state) => state.statusMessage);
  const setAuthError = useAuthStore((state) => state.setAuthError);

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
            error instanceof Error
              ? error.message
              : "Could not load active sites.",
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
      setValidationError(
        emailResult.error.issues[0]?.message ?? "Enter a valid email address.",
      );
      return;
    }

    if (!nameResult.success) {
      setValidationError(
        nameResult.error.issues[0]?.message ?? "Enter a valid name.",
      );
      return;
    }

    if (selectedSiteIds.length === 0) {
      setValidationError("Select at least one site for this team member.");
      return;
    }

    if (isLoadingSites || siteError || sites.length === 0) {
      setValidationError("Active sites must be available before sending an invitation.");
      return;
    }

    setValidationError(null);
    setAuthError(null);

    await inviteUser(
      emailResult.data,
      nameResult.data,
      role,
      selectedSiteIds,
    );

    if (!useAuthStore.getState().authError) {
      setEmail("");
      setFullName("");
      setSelectedSiteIds([]);
      setValidationError(null);
    }
  }

  return (
    <Screen
      title="Invite a team member"
      subtitle="Choose the person's role and assign them to one or more active sites. They will receive an email invitation."
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
        <Text style={styles.sectionTitle}>Team member role</Text>

        {roles.map((item) => {
          const selected = role === item.value;

          return (
            <Pressable
              key={item.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              onPress={() => setRole(item.value)}
              style={[
                styles.option,
                selected ? styles.optionSelected : null,
              ]}
            >
              <View style={styles.optionContent}>
                <Text style={styles.optionTitle}>{item.label}</Text>
                <Text style={styles.optionDescription}>
                  {item.description}
                </Text>
              </View>

              <View
                style={[
                  styles.radio,
                  selected ? styles.radioSelected : null,
                ]}
              />
            </Pressable>
          );
        })}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Assigned sites</Text>
        <Text style={styles.helper}>
          Select every site this person is allowed to work with.
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
                style={[
                  styles.siteOption,
                  selected ? styles.siteOptionSelected : null,
                ]}
              >
                <View
                  style={[
                    styles.checkbox,
                    selected ? styles.checkboxSelected : null,
                  ]}
                >
                  {selected ? (
                    <Text style={styles.checkmark}>✓</Text>
                  ) : null}
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

      {validationError ? (
        <Message tone="error">{validationError}</Message>
      ) : null}

      {authError ? <Message tone="error">{authError}</Message> : null}

      {statusMessage ? <Message>{statusMessage}</Message> : null}

      <PrimaryButton
        disabled={isLoadingSites || Boolean(siteError) || sites.length === 0}
        label="Send invitation"
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
});
