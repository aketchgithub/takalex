import { useCallback, useEffect, useState } from "react";

import type { TotalsState } from "@/components/MaterialTotalsCard";

import { fetchMaterialTotals } from "./api";

// What was loaded, and for which filter.
type Loaded =
  | { status: "loading" }
  | (Exclude<TotalsState, { status: "loading" }> & { key: string });

// Loads totals for the filter, again whenever it changes or reload() is
// called.
//   refreshing  a pull-to-refresh reload is running (the screen's spinner)
//   updating    the filter changed and the numbers on screen still belong to
//               the previous one (shown dimmed until the new ones arrive)
export function useMaterialTotals(siteId: string | null, from: string | null, to: string | null) {
  const key = `${siteId ?? "all"}|${from ?? ""}|${to ?? ""}`;
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    fetchMaterialTotals({ siteId, from, to })
      .then((rows) => {
        if (active) setLoaded({ status: "ready", rows, key });
      })
      .catch((error: unknown) => {
        if (active) {
          setLoaded({
            status: "error",
            message: error instanceof Error ? error.message : "Could not load material totals.",
            key,
          });
        }
      })
      .finally(() => {
        if (active) setRefreshing(false);
      });
    return () => {
      active = false;
    };
  }, [siteId, from, to, key, version]);

  const reload = useCallback(() => {
    setRefreshing(true);
    setVersion((v) => v + 1);
  }, []);

  const stale = loaded.status !== "loading" && loaded.key !== key;
  // Old numbers stay visible (dimmed) while the new filter loads; an old
  // error is not shown for a new filter, which shows as loading instead.
  const state: TotalsState =
    loaded.status === "loading" || (stale && loaded.status === "error")
      ? { status: "loading" }
      : loaded.status === "ready"
        ? { status: "ready", rows: loaded.rows }
        : { status: "error", message: loaded.message };
  const updating = stale && loaded.status === "ready";

  return { state, updating, refreshing, reload };
}
