import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { Message, PrimaryButton, uiColors } from "@/components/Ui";
import {
  collectorGroupLabel,
  loadAccountSummary,
  type AccountSummary as Summary,
} from "@/lib/account";
import { useAuthStore } from "@/stores/authStore";
import { roleLabels } from "@/types/auth";

// Name, role and (unless hidden) the user's assigned sites, plus the
// collector's group ("{site name} group": each group has its site's name),
// all read from the database under RLS. Ends with a sign-out button.
export function AccountSummary({
  showSites = true,
  noSitesText = "You have no assigned sites. Ask an administrator to assign one.",
}: {
  showSites?: boolean;
  noSitesText?: string;
}) {
  const profile = useAuthStore((state) => state.profile);
  const signOut = useAuthStore((state) => state.signOut);
  const isSigningOut = useAuthStore((state) => state.isLoading);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Collectors always need their sites: the group label is derived from them.
  const needsSites = showSites || profile?.role === "collector";

  useEffect(() => {
    if (!profile || !needsSites) {
      return;
    }
    let active = true;
    loadAccountSummary(profile)
      .then((result) => {
        if (active) {
          setError(null);
          setSummary(result);
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Could not load your account details.");
        }
      });
    return () => {
      active = false;
    };
  }, [profile, needsSites]);

  if (!profile) {
    return null;
  }

  return (
    <View style={styles.card}>
      <Row label="Name" value={profile.full_name ?? "Not set"} />
      <Row label="Role" value={roleLabels[profile.role]} />

      {profile.role === "collector" ? (
        <Row
          label="Group"
          value={
            error
              ? "Unavailable"
              : !summary
                ? "Loading…"
                : collectorGroupLabel(summary.sites) ?? "Not assigned to a group yet"
          }
        />
      ) : null}

      {showSites ? (
        <View style={styles.sites}>
          <Text style={styles.label}>Assigned sites</Text>
          {error ? (
            <Message tone="error">{error}</Message>
          ) : !summary ? (
            <ActivityIndicator color={uiColors.primary} />
          ) : summary.sites.length === 0 ? (
            <Text style={styles.value}>{noSitesText}</Text>
          ) : (
            summary.sites.map((site) => (
              <Text key={site.id} style={styles.value}>
                • {site.name}
                {site.active ? "" : " (inactive)"}
              </Text>
            ))
          )}
        </View>
      ) : null}

      <PrimaryButton label="Sign out" loading={isSigningOut} onPress={() => void signOut()} />
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: uiColors.white,
    borderColor: uiColors.border,
    borderRadius: 12,
    borderWidth: 1,
    gap: 14,
    padding: 16,
  },
  row: {
    gap: 2,
  },
  sites: {
    gap: 4,
  },
  label: {
    color: uiColors.muted,
    fontSize: 13,
    fontWeight: "600",
  },
  value: {
    color: uiColors.text,
    fontSize: 16,
  },
});
