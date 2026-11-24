// Small key-value storage on the phone (expo-sqlite's kv-store), used for
// the collector's cached site and materials. The website uses kvStore.web.ts
// instead, so expo-sqlite is not part of the web bundle.

import Storage from "expo-sqlite/kv-store";

export const kvStore: {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
} = Storage;
