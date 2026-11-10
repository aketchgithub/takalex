import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { AccountSummary } from "@/components/AccountSummary";
import { FilterChips } from "@/components/FilterChips";
import { MaterialTotalsCard } from "@/components/MaterialTotalsCard";
import { InlineLink, Message, Screen, uiColors } from "@/components/Ui";
import { getPublicSiteOptions, type PublicSiteOption } from "@/lib/access";
import { DATE_PRESETS, presetRange, rangeLabel, totalsHeading, type DatePreset } from "@/lib/recycler/model";
import { useMaterialTotals } from "@/lib/recycler/useMaterialTotals";
import { useAuthStore } from "@/stores/authStore";

const ALL_SITES = "all";

export default function RecyclerHome() {
  const profile = useAuthStore((state) => state.profile);
  const [siteOptions, setSiteOptions] = useState<PublicSiteOption[]>([]);
  const [siteError, setSiteError] = useState<string | null>(null);
  const [siteVersion, setSiteVersion] = useState(0);
  const [site, setSite] = useState<string>(ALL_SITES);
  const [preset, setPreset] = useState<DatePreset>("all");
  // The range is fixed when the preset is chosen (or on refresh), so a
  // re-render never shifts it.
  const [now, setNow] = useState(() => new Date());
  const range = useMemo(() => presetRange(preset, now), [preset, now]);

  const totals = useMaterialTotals(site === ALL_SITES ? null : site, range.from, range.to);

  useEffect(() => {
    let active = true;
    getPublicSiteOptions()
      .then((options) => {
        if (active) {
          setSiteOptions(options);
          setSiteError(null);
        }
      })
      .catch((error: unknown) => {
        if (active) setSiteError(error instanceof Error ? error.message : "Could not load the list of sites.");
      });
    return () => {
      active = false;
    };
  }, [siteVersion]);

  const siteChips = useMemo(
    () => [{ value: ALL_SITES, label: "All sites" }, ...siteOptions.map((option) => ({ value: option.id, label: option.name }))],
    [siteOptions],
  );
  const siteName = site === ALL_SITES ? "All sites" : (siteOptions.find((option) => option.id === site)?.name ?? "Selected site");

  const refresh = () => {
    setNow(new Date());
    totals.reload();
    if (siteError) setSiteVersion((v) => v + 1);
  };

  return (
    <Screen
      title={`Hello${profile?.full_name ? `, ${profile.full_name}` : ""}`}
      subtitle="Sorted material approved and weighed at Chemolex sites."
      refreshing={totals.refreshing}
      onRefresh={refresh}
    >
      <View style={styles.filters}>
        <Text style={styles.label}>Site</Text>
        <FilterChips options={siteChips} value={site} onChange={setSite} />
        {siteError ? (
          <>
            <Message tone="error">{siteError}</Message>
            <InlineLink label="Try again" onPress={() => setSiteVersion((v) => v + 1)} />
          </>
        ) : null}
        <Text style={styles.label}>Period</Text>
        <FilterChips
          options={DATE_PRESETS}
          value={preset}
          onChange={(next) => {
            setNow(new Date());
            setPreset(next);
          }}
        />
      </View>

      <MaterialTotalsCard
        heading={totalsHeading(preset)}
        note={`${siteName}. ${rangeLabel(range)} Totals add up approved deliveries; no sales or pickups are deducted.`}
        state={totals.state}
        updating={totals.updating}
      />
      {totals.state.status === "error" ? <InlineLink label="Try again" onPress={refresh} /> : null}
      <Text style={styles.hint}>Pull down to refresh.</Text>

      <AccountSummary noSitesText="None. Recyclers do not need a site assignment." />
    </Screen>
  );
}

const styles = StyleSheet.create({
  filters: { gap: 8 },
  label: { color: uiColors.text, fontSize: 14, fontWeight: "700" },
  hint: { color: uiColors.muted, fontSize: 12 },
});
