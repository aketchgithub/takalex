// Admin Overview charts (migration 011, computed in the database):
//   1. verified kg per site, this week or last week (horizontal bars)
//   2. material breakdown over the last 3 months (one bar split by share, with a legend)
//   3. the last 3 months: verified kg per month (columns) with approved and rejected counts
// Drawn with plain views, so they follow the theme and text size. version
// (bumped by pull to refresh) reloads all three.

import { useEffect, useState, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { FilterChips } from "@/components/FilterChips";
import { InlineLink, Message, uiStylesOf, useUiStyles } from "@/components/Ui";
import {
  fetchMaterialBreakdown,
  fetchMonthlyTrend,
  fetchSiteVolume,
  type MaterialShare,
  type MonthTrend,
  type SiteVolume,
} from "@/lib/admin/analytics";
import {
  TREND_MONTHS,
  WEEK_CHOICES,
  deliveriesLabel,
  fractionOfMax,
  monthLabel,
  monthsStart,
  percentages,
  rangeLabel,
  weekRange,
  type WeekChoice,
} from "@/lib/admin/analyticsModel";
import { formatTotalKg } from "@/lib/recycler/model";
import { chartSeries, radius, type, type Palette } from "@/theme/tokens";
import { useFontSize } from "@/theme/useFontSize";
import { useColors, useColorSchemeChoice, useThemedStyles } from "@/theme/useTheme";

type Load<T> = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: T };

// Runs load() whenever key (or a retry) changes. While a new request runs,
// the result of the previous one is not shown: the state is "loading".
function useLoad<T>(load: () => Promise<T>, key: string): [Load<T>, () => void] {
  const [retry, setRetry] = useState(0);
  const requestKey = `${key}#${retry}`;
  const [result, setResult] = useState<{ key: string; state: Load<T> } | null>(null);
  useEffect(() => {
    let active = true;
    load()
      .then((data) => {
        if (active) setResult({ key: requestKey, state: { status: "ready", data } });
      })
      .catch((error: unknown) => {
        if (active) {
          setResult({
            key: requestKey,
            state: { status: "error", message: error instanceof Error ? error.message : "Could not load." },
          });
        }
      });
    return () => {
      active = false;
    };
    // load is rebuilt each render; requestKey says when the request changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);
  const state: Load<T> = result && result.key === requestKey ? result.state : { status: "loading" };
  return [state, () => setRetry((v) => v + 1)];
}

// today: the Nairobi date (YYYY-MM-DD) the screen worked out when it was
// shown or refreshed (nairobiDate in lib/recycler/model.ts).
export function AdminAnalytics({ today, version }: { today: string; version: number }) {
  const ui = useUiStyles();

  return (
    <View style={ui.section}>
      <Text accessibilityRole="header" style={ui.sectionHeading}>
        Analytics
      </Text>
      <Text style={ui.meta}>
        Verified weights of approved deliveries, by the day they were reviewed (Nairobi time).
      </Text>
      <SiteVolumeCard today={today} version={version} />
      <MaterialBreakdownCard today={today} version={version} />
      <MonthlyTrendCard today={today} version={version} />
    </View>
  );
}

function ChartCard({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  const styles = useThemedStyles(makeStyles);
  const ui = useUiStyles();
  const fs = useFontSize();
  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" style={[ui.cardTitle, { fontSize: fs(type.cardTitle) }]}>
        {title}
      </Text>
      {note ? <Text style={[ui.meta, { fontSize: fs(type.meta) }]}>{note}</Text> : null}
      {children}
    </View>
  );
}

function LoadState<T>({ state, onRetry, children }: { state: Load<T>; onRetry: () => void; children: (data: T) => ReactNode }) {
  if (state.status === "loading") return <Message>Loading…</Message>;
  if (state.status === "error") {
    return (
      <>
        <Message tone="error">{state.message}</Message>
        <InlineLink label="Try again" onPress={onRetry} />
      </>
    );
  }
  return <>{children(state.data)}</>;
}

function SiteVolumeCard({ today, version }: { today: string; version: number }) {
  const styles = useThemedStyles(makeStyles);
  const fs = useFontSize();
  const [week, setWeek] = useState<WeekChoice>("this");
  const range = weekRange(week, today);
  const [state, retry] = useLoad(() => fetchSiteVolume(range.from, range.to), `${range.from}|${range.to}|${version}`);

  return (
    <ChartCard title="Weight by site" note={rangeLabel(range)}>
      <FilterChips options={WEEK_CHOICES} value={week} onChange={setWeek} />
      <LoadState state={state} onRetry={retry}>
        {(rows: SiteVolume[]) => {
          const sorted = [...rows].sort((a, b) => b.weightKg - a.weightKg || a.siteName.localeCompare(b.siteName));
          const weights = sorted.map((r) => r.weightKg);
          const total = weights.reduce((a, b) => a + b, 0);
          return (
            <View style={styles.rows}>
              <Text style={[styles.total, { fontSize: fs(type.title) }]}>{formatTotalKg(total)}</Text>
              {sorted.map((row) => (
                <View
                  key={row.siteId}
                  accessible
                  accessibilityLabel={`${row.siteName}: ${formatTotalKg(row.weightKg)}, ${deliveriesLabel(row.approved)}`}
                  style={styles.row}
                >
                  <View style={styles.rowText}>
                    <Text style={[styles.name, { fontSize: fs(type.body) }]}>
                      {row.siteName}
                      {row.active ? "" : " (inactive)"}
                    </Text>
                    <Text style={[styles.value, row.weightKg === 0 ? styles.zero : null, { fontSize: fs(type.body) }]}>
                      {formatTotalKg(row.weightKg)}
                    </Text>
                  </View>
                  <Bar share={fractionOfMax(row.weightKg, weights)} />
                  <Text style={[styles.small, { fontSize: fs(type.caption) }]}>{deliveriesLabel(row.approved)}</Text>
                </View>
              ))}
            </View>
          );
        }}
      </LoadState>
    </ChartCard>
  );
}

function MaterialBreakdownCard({ today, version }: { today: string; version: number }) {
  const styles = useThemedStyles(makeStyles);
  const fs = useFontSize();
  const series = chartSeries[useColorSchemeChoice()];
  const from = monthsStart(today, TREND_MONTHS);
  const [state, retry] = useLoad(() => fetchMaterialBreakdown(from, today), `${from}|${today}|${version}`);

  return (
    <ChartCard title="Material breakdown" note={`Last ${TREND_MONTHS} months (since ${rangeLabel({ from, to: from })})`}>
      <LoadState state={state} onRetry={retry}>
        {(rows: MaterialShare[]) => {
          if (rows.length === 0) return <Message>Nothing approved in these months yet.</Message>;
          const shares = percentages(rows.map((r) => r.weightKg));
          return (
            <View style={styles.rows}>
              {/* One bar split by each material's share. */}
              <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.stack}>
                {rows.map((row, i) =>
                  row.weightKg > 0 ? (
                    <View key={row.code} style={{ backgroundColor: series[i % series.length], flex: row.weightKg }} />
                  ) : null,
                )}
              </View>
              {rows.map((row, i) => (
                <View
                  key={row.code}
                  accessible
                  accessibilityLabel={`${row.name}: ${formatTotalKg(row.weightKg)}, ${shares[i]} percent`}
                  style={styles.legendRow}
                >
                  <View style={[styles.swatch, { backgroundColor: series[i % series.length] }]} />
                  <Text style={[styles.name, { fontSize: fs(type.body) }]}>{row.name}</Text>
                  <Text style={[styles.value, { fontSize: fs(type.body) }]}>{formatTotalKg(row.weightKg)}</Text>
                  <Text style={[styles.percent, { fontSize: fs(type.meta) }]}>{shares[i]}%</Text>
                </View>
              ))}
            </View>
          );
        }}
      </LoadState>
    </ChartCard>
  );
}

const COLUMN_HEIGHT = 120;

function MonthlyTrendCard({ today, version }: { today: string; version: number }) {
  const styles = useThemedStyles(makeStyles);
  const fs = useFontSize();
  const [state, retry] = useLoad(() => fetchMonthlyTrend(today, TREND_MONTHS), `${today}|${version}`);

  return (
    <ChartCard title="Monthly trend" note={`Verified weight per month, last ${TREND_MONTHS} months`}>
      <LoadState state={state} onRetry={retry}>
        {(rows: MonthTrend[]) => {
          const weights = rows.map((r) => r.weightKg);
          return (
            <View style={styles.columns}>
              {rows.map((row) => {
                const share = fractionOfMax(row.weightKg, weights);
                return (
                  <View
                    key={row.monthStart}
                    accessible
                    accessibilityLabel={`${monthLabel(row.monthStart)}: ${formatTotalKg(row.weightKg)}, ${row.approved} approved, ${row.rejected} rejected`}
                    style={styles.column}
                  >
                    <Text style={[styles.columnValue, { fontSize: fs(type.caption) }]}>{formatTotalKg(row.weightKg)}</Text>
                    <View style={styles.columnTrack}>
                      <View style={[styles.columnBar, { height: Math.max(share > 0 ? 4 : 0, share * COLUMN_HEIGHT) }]} />
                    </View>
                    <Text style={[styles.columnLabel, { fontSize: fs(type.body) }]}>{monthLabel(row.monthStart)}</Text>
                    <Text style={[styles.small, styles.center, { fontSize: fs(type.caption) }]}>
                      {row.approved} approved{"\n"}
                      {row.rejected} rejected
                    </Text>
                  </View>
                );
              })}
            </View>
          );
        }}
      </LoadState>
    </ChartCard>
  );
}

function Bar({ share }: { share: number }) {
  const styles = useThemedStyles(makeStyles);
  const c = useColors();
  return (
    <View style={styles.track}>
      {share > 0 ? <View style={{ backgroundColor: c.primary, borderRadius: radius.pill, flex: share }} /> : null}
      <View style={{ flex: 1 - share }} />
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    card: { ...uiStylesOf(c).card, gap: 12 },
    rows: { gap: 12 },
    total: { color: c.text, fontVariant: ["tabular-nums"], fontWeight: "800" },
    row: { gap: 4 },
    rowText: { flexDirection: "row", gap: 12, justifyContent: "space-between" },
    name: { color: c.text, flex: 1 },
    value: { color: c.text, fontVariant: ["tabular-nums"], fontWeight: "700" },
    zero: { color: c.muted, fontWeight: "400" },
    small: { color: c.muted },
    center: { textAlign: "center" },
    track: { backgroundColor: c.track, borderRadius: radius.pill, flexDirection: "row", height: 8, overflow: "hidden" },
    stack: { borderRadius: radius.pill, flexDirection: "row", gap: 2, height: 16, overflow: "hidden" },
    legendRow: { alignItems: "center", flexDirection: "row", gap: 10 },
    swatch: { borderRadius: 3, height: 12, width: 12 },
    percent: { color: c.muted, fontVariant: ["tabular-nums"], minWidth: 40, textAlign: "right" },
    columns: { flexDirection: "row", gap: 12, justifyContent: "space-between" },
    column: { alignItems: "center", flex: 1, gap: 6 },
    columnValue: { color: c.text, fontVariant: ["tabular-nums"], fontWeight: "700", textAlign: "center" },
    columnTrack: {
      backgroundColor: c.track,
      borderRadius: radius.md,
      height: COLUMN_HEIGHT,
      justifyContent: "flex-end",
      overflow: "hidden",
      width: "60%",
    },
    columnBar: { backgroundColor: c.primary, borderRadius: radius.md },
    columnLabel: { color: c.text, fontWeight: "700" },
  });
