import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";

import { Field, Message, PrimaryButton, Screen, uiColors } from "@/components/Ui";
import {
  getPublicSiteOptions,
  submitAccessRequest,
  submitAccessRequestSchema,
  type AccessRequestRole,
  type PublicSiteOption,
} from "@/lib/access";

const ROLE_OPTIONS: { value: AccessRequestRole; label: string }[] = [
  { value: "collector", label: "Collector" },
  { value: "site_manager", label: "Site manager" },
  { value: "recycler", label: "Recycler" },
];

export default function RequestAccessScreen() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<AccessRequestRole>("collector");
  const [siteId, setSiteId] = useState<string | null>(null);
  const [siteOptions, setSiteOptions] = useState<PublicSiteOption[]>([]);
  const [sitesLoading, setSitesLoading] = useState(true);
  const [sitesError, setSitesError] = useState<string | null>(null);
  const [referralSource, setReferralSource] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Active sites come from public_site_options() (id and name only).
  // sitesRequest changes to reload the list (initial load, "Try again", and
  // after a refused submission).
  const [sitesRequest, setSitesRequest] = useState(0);

  useEffect(() => {
    let active = true;
    getPublicSiteOptions()
      .then((options) => {
        if (!active) {
          return;
        }
        setSiteOptions(options);
        setSitesError(null);
        // Drop a selection that is no longer offered.
        setSiteId((current) =>
          current && options.some((option) => option.id === current) ? current : null,
        );
      })
      .catch((loadError: unknown) => {
        if (active) {
          setSitesError(
            loadError instanceof Error ? loadError.message : "Could not load the list of sites.",
          );
        }
      })
      .finally(() => {
        if (active) {
          setSitesLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [sitesRequest]);

  const loadSites = useCallback(() => {
    setSitesLoading(true);
    setSitesError(null);
    setSitesRequest((n) => n + 1);
  }, []);

  const isCollector = role === "collector";

  const submit = async () => {
    // Same schema submitAccessRequest uses, including the
    // "email or phone required" rule, so the form and submission agree.
    const parsed = submitAccessRequestSchema.safeParse({
      full_name: fullName,
      email,
      phone,
      role,
      site_id: siteId,
      referral_source: referralSource,
    });

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Please check the request details.");
      setStatus(null);
      return;
    }

    setLoading(true);
    setError(null);
    setStatus(null);

    const { error: submitError } = await submitAccessRequest(parsed.data);

    setLoading(false);

    if (submitError) {
      setError(submitError.message);
      // A refused site may have been deactivated meanwhile: refresh the list.
      loadSites();
      return;
    }

    setStatus(
      "Your request has been submitted. An administrator will review it and send an invite if approved.",
    );
    setFullName("");
    setEmail("");
    setPhone("");
    setSiteId(null);
    setReferralSource("");
    setRole("collector");
  };

  return (
    <Screen
      title="Request access"
      subtitle="Public discovery is open, but operational access is controlled through a verified invitation flow."
    >
      <Field
        label="Full name"
        value={fullName}
        onChangeText={setFullName}
        placeholder="Your full name"
      />
      <Field
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        label="Email address"
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
      />
      <Field
        autoComplete="tel"
        keyboardType="phone-pad"
        label="Phone number"
        value={phone}
        onChangeText={setPhone}
        placeholder="+254712345678"
      />
      <View style={styles.roleField}>
        <Text nativeID="role-label" style={styles.roleLabel}>
          Role interested in
        </Text>
        <View
          accessibilityLabelledBy="role-label"
          accessibilityRole="radiogroup"
          style={styles.roleOptions}
        >
          {ROLE_OPTIONS.map((option) => {
            const selected = role === option.value;
            return (
              <Pressable
                key={option.value}
                accessibilityLabel={option.label}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected, disabled: loading }}
                disabled={loading}
                onPress={() => setRole(option.value)}
                style={({ pressed }) => [
                  styles.roleOption,
                  selected ? styles.roleOptionSelected : null,
                  pressed && !selected ? styles.roleOptionPressed : null,
                ]}
              >
                <Text
                  style={[
                    styles.roleOptionText,
                    selected ? styles.roleOptionTextSelected : null,
                  ]}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <View style={styles.roleField}>
        <Text nativeID="site-label" style={styles.roleLabel}>
          {isCollector ? "Your group (site)" : "Site (optional)"}
        </Text>
        {isCollector ? (
          <Text style={styles.hint}>Each waste picker group has the same name as its site.</Text>
        ) : null}
        {sitesLoading ? (
          <ActivityIndicator color={uiColors.primary} />
        ) : sitesError ? (
          <>
            <Message tone="error">{sitesError}</Message>
            <PrimaryButton label="Try again" onPress={loadSites} />
          </>
        ) : siteOptions.length === 0 ? (
          <Message>No sites are available at the moment.</Message>
        ) : (
          <View
            accessibilityLabelledBy="site-label"
            accessibilityRole="radiogroup"
            style={styles.roleOptions}
          >
            {siteOptions.map((option) => {
              const selected = siteId === option.id;
              return (
                <Pressable
                  key={option.id}
                  accessibilityLabel={option.name}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected, disabled: loading }}
                  disabled={loading}
                  // Tapping the selected site clears it (sites are optional
                  // for site managers and recyclers).
                  onPress={() => setSiteId(selected ? null : option.id)}
                  style={({ pressed }) => [
                    styles.roleOption,
                    selected ? styles.roleOptionSelected : null,
                    pressed && !selected ? styles.roleOptionPressed : null,
                  ]}
                >
                  <Text
                    style={[
                      styles.roleOptionText,
                      selected ? styles.roleOptionTextSelected : null,
                    ]}
                  >
                    {option.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>
      <Field
        label="How did you hear about Takalex?"
        value={referralSource}
        onChangeText={setReferralSource}
        placeholder="Referral or workplace"
      />
      {error ? <Message tone="error">{error}</Message> : null}
      {status ? <Message>{status}</Message> : null}
      <PrimaryButton
        label="Submit request"
        loading={loading}
        onPress={() => void submit()}
      />
      <PrimaryButton label="Back to home" onPress={() => router.replace("/")} />
    </Screen>
  );
}

// Matches the Field label and input styling in src/components/Ui.tsx.
const styles = StyleSheet.create({
  roleField: {
    gap: 7,
  },
  roleLabel: {
    color: uiColors.text,
    fontSize: 14,
    fontWeight: "600",
  },
  hint: {
    color: uiColors.muted,
    fontSize: 13,
  },
  roleOptions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  roleOption: {
    alignItems: "center",
    backgroundColor: uiColors.white,
    borderColor: uiColors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexGrow: 1,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 14,
  },
  roleOptionSelected: {
    backgroundColor: uiColors.primary,
    borderColor: uiColors.primary,
  },
  roleOptionPressed: {
    opacity: 0.85,
  },
  roleOptionText: {
    color: uiColors.text,
    fontSize: 15,
    fontWeight: "600",
  },
  roleOptionTextSelected: {
    color: uiColors.white,
  },
});
