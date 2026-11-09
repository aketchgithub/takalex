// The signed-in collector's deliveries that are still on this phone
// (waiting or failed), re-read whenever the outbox changes (save, any sync
// run, retry, discard) and when the signed-in collector changes.

import { useCallback, useEffect, useState } from "react";

import { listWaitingDeliveries, subscribeOutbox, type OutboxRow } from "@/lib/outbox";
import { useAuthStore } from "@/stores/authStore";

export function useWaitingDeliveries(): {
  rows: OutboxRow[];
  pending: number;
  failed: number;
  loaded: boolean;
  error: string | null;
  reload: () => void;
} {
  const collectorId = useAuthStore((state) =>
    state.profile?.role === "collector" && state.profile.is_active ? state.profile.id : null,
  );
  const [rows, setRows] = useState<OutboxRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => subscribeOutbox(reload), [reload]);

  useEffect(() => {
    let active = true;
    listWaitingDeliveries()
      .then((result) => {
        if (!active) return;
        // Rows are already scoped to the signed-in collector; double-check
        // so a previous user's rows can never flash after a switch.
        setRows(collectorId ? result.filter((row) => row.userId === collectorId) : []);
        setError(null);
        setLoaded(true);
      })
      .catch((loadError: unknown) => {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "Could not read this phone's deliveries.");
        setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [collectorId, version]);

  const failed = rows.filter((row) => row.syncState === "failed").length;
  return { rows, pending: rows.length - failed, failed, loaded, error, reload };
}
