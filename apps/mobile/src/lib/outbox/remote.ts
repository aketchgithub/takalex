// Supabase implementations of the sync engine's remote and session ports.
// Explicit columns only, return=minimal inserts (no .select() after insert),
// no upsert on storage.

import type { PostgrestError } from "@supabase/supabase-js";

import { toRemoteError } from "@/lib/outbox/errors";
import type { OutboxRemote, RemoteError, SessionPort } from "@/lib/outbox/types";
import { supabase } from "@/lib/supabase";

const EVIDENCE_BUCKET = "collection-evidence";
// Refresh when the access token expires within this margin.
const REFRESH_MARGIN_MS = 60_000;

function postgrestError(error: PostgrestError | null, status: number): RemoteError | null {
  if (!error) return null;
  return { message: error.message, code: error.code || undefined, status };
}

export const supabaseOutboxRemote: OutboxRemote = {
  async insertCollection(row) {
    // insert() without .select() sends Prefer: return=minimal.
    const { error, status } = await supabase.from("collection_logs").insert(row);
    return { error: postgrestError(error, status) };
  },

  async findCollectionId(userId, clientRecordId) {
    const { data, error, status } = await supabase
      .from("collection_logs")
      .select("id")
      .eq("collector_id", userId)
      .eq("client_record_id", clientRecordId)
      .maybeSingle();
    return { id: data?.id ?? null, error: postgrestError(error, status) };
  },

  async uploadPhoto(storagePath, body) {
    const { error } = await supabase.storage
      .from(EVIDENCE_BUCKET)
      .upload(storagePath, body, { contentType: "image/jpeg", upsert: false });
    return { error: error ? toRemoteError(error) : null };
  },

  async insertEvidence(row) {
    const { error, status } = await supabase.from("collection_evidence").insert(row);
    return { error: postgrestError(error, status) };
  },
};

export const supabaseSessionPort: SessionPort = {
  async ensureFresh() {
    const { data, error } = await supabase.auth.getSession();
    if (error) return { userId: null, error: toRemoteError(error) };

    let session = data.session;
    if (!session) return { userId: null, error: null };

    const expiresAtMs = (session.expires_at ?? 0) * 1000;
    if (expiresAtMs - Date.now() < REFRESH_MARGIN_MS) {
      const refreshed = await supabase.auth.refreshSession();
      if (refreshed.error) return { userId: null, error: toRemoteError(refreshed.error) };
      session = refreshed.data.session;
    }

    return { userId: session?.user.id ?? null, error: null };
  },
};
