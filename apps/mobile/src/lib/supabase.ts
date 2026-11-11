import "react-native-url-polyfill/auto";

import { createClient } from "@supabase/supabase-js";

import { createFetchWithTimeout } from "@/lib/fetchWithTimeout";
import { authStorage } from "@/lib/storage";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabasePublishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error(
    "Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY before starting the app.",
  );
}

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    autoRefreshToken: true,
    detectSessionInUrl: false,
    persistSession: true,
    storage: authStorage,
  },
  // A hung server becomes an error after 20 s (120 s for Storage uploads)
  // instead of an endless spinner.
  global: { fetch: createFetchWithTimeout() },
});
