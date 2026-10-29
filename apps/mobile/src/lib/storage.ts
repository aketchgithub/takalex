import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import type { StateStorage } from "zustand/middleware";

const manifestSuffix = ":manifest";
const manifestPrefix = "chunks:";
const maxChunkBytes = 1500;

function splitIntoChunks(value: string): string[] {
  const chunks: string[] = [];
  let chunk = "";
  let chunkBytes = 0;

  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) {
      throw new Error("Secure storage could not encode a session value.");
    }

    const bytes =
      codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
    if (chunkBytes + bytes > maxChunkBytes) {
      chunks.push(chunk);
      chunk = "";
      chunkBytes = 0;
    }
    chunk += character;
    chunkBytes += bytes;
  }

  if (chunk.length > 0 || chunks.length === 0) {
    chunks.push(chunk);
  }
  return chunks;
}

function getChunkKey(key: string, generation: string, index: number): string {
  return `${key}:chunk:${generation}:${index}`;
}

async function removePreviousChunks(
  key: string,
  manifest: string | null,
): Promise<void> {
  if (!manifest?.startsWith(manifestPrefix)) {
    return;
  }

  const [generation, countText] = manifest.slice(manifestPrefix.length).split(":");
  const count = Number(countText);
  if (!generation || !Number.isInteger(count) || count < 1) {
    throw new Error("Secure storage contains an invalid session manifest.");
  }

  await Promise.all(
    Array.from({ length: count }, (_, index) =>
      SecureStore.deleteItemAsync(getChunkKey(key, generation, index)),
    ),
  );
}

async function getSecureItem(key: string): Promise<string | null> {
  const manifestKey = `${key}${manifestSuffix}`;
  const manifest = await SecureStore.getItemAsync(manifestKey);
  if (!manifest) {
    return SecureStore.getItemAsync(key);
  }
  if (!manifest.startsWith(manifestPrefix)) {
    throw new Error("Secure storage contains an invalid session manifest.");
  }

  const [generation, countText] = manifest.slice(manifestPrefix.length).split(":");
  const count = Number(countText);
  if (!generation || !Number.isInteger(count) || count < 1) {
    throw new Error("Secure storage contains an invalid session manifest.");
  }

  const chunks = await Promise.all(
    Array.from({ length: count }, (_, index) =>
      SecureStore.getItemAsync(getChunkKey(key, generation, index)),
    ),
  );
  if (chunks.some((chunk) => chunk === null)) {
    throw new Error("A secure session value is incomplete.");
  }
  return chunks.join("");
}

async function setSecureItem(key: string, value: string): Promise<void> {
  const manifestKey = `${key}${manifestSuffix}`;
  const previousManifest = await SecureStore.getItemAsync(manifestKey);
  const generation = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  const chunks = splitIntoChunks(value);

  await Promise.all(
    chunks.map((chunk, index) =>
      SecureStore.setItemAsync(getChunkKey(key, generation, index), chunk),
    ),
  );
  await SecureStore.setItemAsync(
    manifestKey,
    `${manifestPrefix}${generation}:${chunks.length}`,
  );
  await SecureStore.deleteItemAsync(key);
  await removePreviousChunks(key, previousManifest);
}

async function removeSecureItem(key: string): Promise<void> {
  const manifestKey = `${key}${manifestSuffix}`;
  const manifest = await SecureStore.getItemAsync(manifestKey);
  await Promise.all([
    SecureStore.deleteItemAsync(key),
    SecureStore.deleteItemAsync(manifestKey),
  ]);
  await removePreviousChunks(key, manifest);
}

export const authStorage: StateStorage<void> = {
  getItem: async (key) => {
    if (Platform.OS === "web") {
      return typeof window === "undefined" ? null : window.localStorage.getItem(key);
    }

    return getSecureItem(key);
  },
  setItem: async (key, value) => {
    if (Platform.OS === "web") {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(key, value);
      }
      return;
    }

    await setSecureItem(key, value);
  },
  removeItem: async (key) => {
    if (Platform.OS === "web") {
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(key);
      }
      return;
    }

    await removeSecureItem(key);
  },
};
