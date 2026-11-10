import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { z } from "zod";

import { Field, Message, PrimaryButton, uiColors } from "@/components/Ui";
import { NO_EMAIL_NOTE, requestEmailError, type InvitePrefill } from "@/lib/admin/model";
import { getActiveSites, type SiteOption } from "@/lib/sites";
import { roleLabels, type InviteRole } from "@/types/auth";

// Same limits as invite-user.
const emailSchema = z.string().trim().max(254).email("Enter a valid email address.");
const nameSchema = z
  .string()
  .trim()
  .min(2, "Full name must contain between 2 and 120 characters.")
  .max(120, "Full name must contain between 2 and 120 characters.");

const roles: { value: InviteRole; description: string }[] = [
  { value: "collector", description: "Records deliveries at their site (their group)." },
  { value: "site_manager", description: "Verifies and reviews deliveries for their sites." },
  { value: "recycler", description: "Sees available sorted material. No site needed." },
];

export type InviteValues = { email: string; fullName: string; role: InviteRole; siteIds: string[] };

// The invite form, used by the Invite tab and by "Approve and invite" on an
// access request. Every field is editable.
//   initial       prefilled values
//   request       when answering an access request: its email (null when it
//                 has none, shown with NO_EMAIL_NOTE) for the matching rule
//   onSubmit      returns an error message, or null on success
export function InviteForm({
  initial,
  request,
  submitLabel,
  loading,
  onSubmit,
}: {
  initial?: InvitePrefill;
  request?: { email: string | null };
  submitLabel: string;
  loading: boolean;
  onSubmit: (values: InviteValues) => Promise<string | null>;
}) {
  const [email, setEmail] = useState(initial?.email ?? "");
  const [fullName, setFullName] = useState(initial?.fullName ?? "");
  const [role, setRole] = useState<InviteRole>(initial?.role ?? "collector");
  const [sites, setSites] = useState<SiteOption[]>([]);
  // Fixed for the form's lifetime (initial values are read once).
  const [initialSiteIds] = useState<string[]>(initial?.siteIds ?? []);
  const [selectedSiteIds, setSelectedSiteIds] = useState<string[]>(initialSiteIds);
  const [isLoadingSites, setIsLoadingSites] = useState(true);
  const [siteError, setSiteError] = useState<string | null>(null);
  const [siteNotice, setSiteNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const sitesRequired = role !== "recycler";
  // A collector's site is their group, so collectors get exactly one site
  // (enforced by invite-user and register_invitation as well).
  const singleSite = role === "collector";
  const requestHasNoEmail = request !== undefined && !request.email?.trim();

  useEffect(() => {
    let isMounted = true;
    getActiveSites()
      .then((activeSites) => {
        if (!isMounted) return;
        setSites(activeSites);
        // A prefilled site that is no longer active cannot be invited to.
        const isActive = (id: string) => activeSites.some((site) => site.id === id);
        if (!initialSiteIds.every(isActive)) {
          setSiteNotice("The site chosen on the request is no longer active. Choose another.");
        }
        setSelectedSiteIds((current) => current.filter(isActive));
      })
      .catch((error: unknown) => {
        if (isMounted) setSiteError(error instanceof Error ? error.message : "Could not load active sites.");
      })
      .finally(() => {
        if (isMounted) setIsLoadingSites(false);
      });
    return () => {
      isMounted = false;
    };
  }, [initialSiteIds]);

  function toggleSite(siteId: string) {
    setSelectedSiteIds((current) => {
      if (current.includes(siteId)) return current.filter((id) => id !== siteId);
      return singleSite ? [siteId] : [...current, siteId];
    });
  }

  function chooseRole(next: InviteRole) {
    setRole(next);
    // Switching to collector keeps at most one of the selected sites.
    if (next === "collector") setSelectedSiteIds((current) => current.slice(0, 1));
  }

  async function submit() {
    const emailResult = emailSchema.safeParse(email);
    const nameResult = nameSchema.safeParse(fullName);

    if (!emailResult.success) {
      setFormError(
        requestHasNoEmail && email.trim() === ""
          ? "Enter the email you confirmed with the requester."
          : (emailResult.error.issues[0]?.message ?? "Enter a valid email address."),
      );
      return;
    }
    if (request) {
      const mismatch = requestEmailError(request.email, emailResult.data);
      if (mismatch) {
        setFormError(mismatch);
        return;
      }
    }
    if (!nameResult.success) {
      setFormError(nameResult.error.issues[0]?.message ?? "Enter a valid name.");
      return;
    }
    if (singleSite && selectedSiteIds.length !== 1) {
      setFormError("Choose the collector's site (their group).");
      return;
    }
    if (sitesRequired && selectedSiteIds.length === 0) {
      setFormError("Site managers must be assigned at least one site.");
      return;
    }

    setFormError(null);
    const error = await onSubmit({
      email: emailResult.data.toLowerCase(),
      fullName: nameResult.data,
      role,
      siteIds: selectedSiteIds,
    });
    if (error) setFormError(error);
  }

  return (
    <>
      <Field
        autoCapitalize="words"
        label="Full name"
        onChangeText={setFullName}
        placeholder="Team member's full name"
        value={fullName}
      />

      {requestHasNoEmail ? <Message tone="error">{NO_EMAIL_NOTE}</Message> : null}
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
              onPress={() => chooseRole(item.value)}
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
          {singleSite ? "Site (exactly one)" : sitesRequired ? "Assigned sites (at least one)" : "Assigned sites (optional)"}
        </Text>
        <Text style={styles.helper}>
          {singleSite
            ? "A collector's group is their site. Choose one."
            : sitesRequired
              ? "Select every site this person works at."
              : "Recyclers do not need a site."}
        </Text>
        {siteNotice ? <Message tone="error">{siteNotice}</Message> : null}

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
                accessibilityRole={singleSite ? "radio" : "checkbox"}
                accessibilityState={{ checked: selected }}
                onPress={() => toggleSite(site.id)}
                style={[styles.siteOption, selected ? styles.siteOptionSelected : null]}
              >
                {singleSite ? (
                  <View style={[styles.radio, styles.siteRadio, selected ? styles.radioSelected : null]} />
                ) : (
                  <View style={[styles.checkbox, selected ? styles.checkboxSelected : null]}>
                    {selected ? <Text style={styles.checkmark}>✓</Text> : null}
                  </View>
                )}
                <Text style={styles.siteName}>{site.name}</Text>
              </Pressable>
            );
          })
        )}

        <Text style={styles.selectionCount}>{selectedSiteIds.length} site(s) selected</Text>
      </View>

      {formError ? <Message tone="error">{formError}</Message> : null}

      <PrimaryButton
        disabled={sitesRequired && (isLoadingSites || Boolean(siteError) || sites.length === 0)}
        label={submitLabel}
        loading={loading}
        onPress={() => void submit()}
      />
    </>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  sectionTitle: { color: uiColors.text, fontSize: 16, fontWeight: "700" },
  helper: { color: uiColors.muted, fontSize: 13, lineHeight: 19 },
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
  optionSelected: { borderColor: uiColors.primary, borderWidth: 2 },
  optionContent: { flex: 1, gap: 4 },
  optionTitle: { color: uiColors.text, fontSize: 15, fontWeight: "700" },
  optionDescription: { color: uiColors.muted, fontSize: 13 },
  radio: { borderColor: uiColors.border, borderRadius: 10, borderWidth: 2, height: 20, marginLeft: 12, width: 20 },
  siteRadio: { marginLeft: 0 },
  radioSelected: { backgroundColor: uiColors.primary, borderColor: uiColors.primary },
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
  siteOptionSelected: { borderColor: uiColors.primary },
  checkbox: {
    alignItems: "center",
    borderColor: uiColors.border,
    borderRadius: 5,
    borderWidth: 1.5,
    height: 21,
    justifyContent: "center",
    width: 21,
  },
  checkboxSelected: { backgroundColor: uiColors.primary, borderColor: uiColors.primary },
  checkmark: { color: uiColors.white, fontSize: 14, fontWeight: "800" },
  siteName: { color: uiColors.text, flex: 1, fontSize: 14, fontWeight: "500" },
  selectionCount: { color: uiColors.muted, fontSize: 12 },
});
