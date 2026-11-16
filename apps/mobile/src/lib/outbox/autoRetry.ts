// When the automatic retry timer should run. Pure TypeScript, tested by
// autoRetry.test.ts; useOutboxSync applies the decision.
//
// A sync run only attempts rows in the "pending" state: new deliveries and
// ones whose last attempt failed for a retryable reason (no connection,
// timeout, 5xx). "failed" rows are permanent failures that wait for the
// collector's Retry or Discard, so they never keep the timer running.

export const AUTO_RETRY_INTERVAL_MS = 30_000;

export function countRetryable(rows: readonly { syncState: string }[]): number {
  return rows.filter((row) => row.syncState === "pending").length;
}

// collectorId: the signed-in, active collector, or null.
// appState: React Native's AppState value ("active" is the foreground).
export function shouldAutoRetry(input: {
  collectorId: string | null;
  appState: string;
  retryableCount: number;
}): boolean {
  return input.collectorId !== null && input.appState === "active" && input.retryableCount > 0;
}

// One timer tick: start a sync unless the run started by the previous tick
// is still going (a slow connection can make a run outlast the interval).
export function shouldStartTick(input: { enabled: boolean; tickInFlight: boolean }): boolean {
  return input.enabled && !input.tickInFlight;
}
