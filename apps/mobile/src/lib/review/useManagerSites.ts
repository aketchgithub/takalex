import { useEffect, useState } from "react";

import type { AssignedSite } from "@/lib/account";
import { useAuthStore } from "@/stores/authStore";

import { loadManagerSites } from "./api";

export type ManagerSitesState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; sites: AssignedSite[] };

// The signed-in manager's assigned sites, read again whenever version changes.
export function useManagerSites(version: number): ManagerSitesState {
  const profile = useAuthStore((state) => state.profile);
  const [state, setState] = useState<ManagerSitesState>({ status: "loading" });

  useEffect(() => {
    if (!profile) return;
    let active = true;
    loadManagerSites(profile)
      .then((sites) => {
        if (active) setState({ status: "ready", sites });
      })
      .catch((error: unknown) => {
        if (active) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Could not load your sites.",
          });
        }
      });
    return () => {
      active = false;
    };
  }, [profile, version]);

  return state;
}
