import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { authStorage } from "@/lib/storage";
import { isAppearance, type Appearance } from "@/theme/appearance";
import { isTextSize, type TextSize } from "@/theme/textSize";

// Per-phone display preferences (text size, appearance), kept on the device
// (not in the database).
type PreferencesState = {
  textSize: TextSize;
  appearance: Appearance;
  setTextSize: (size: TextSize) => void;
  setAppearance: (appearance: Appearance) => void;
};

type Saved = Pick<PreferencesState, "textSize" | "appearance">;

// Anything unexpected in storage falls back to the default.
function readSaved(persisted: unknown, fallback: Saved): Saved {
  const saved = (persisted ?? {}) as Partial<Saved>;
  return {
    textSize: isTextSize(saved.textSize) ? saved.textSize : fallback.textSize,
    appearance: isAppearance(saved.appearance) ? saved.appearance : fallback.appearance,
  };
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      textSize: "normal",
      appearance: "light",
      setTextSize: (size) => set({ textSize: size }),
      setAppearance: (appearance) => set({ appearance }),
    }),
    {
      name: "takalex-preferences",
      storage: createJSONStorage(() => authStorage),
      partialize: (state): Saved => ({ textSize: state.textSize, appearance: state.appearance }),
      // Version 1 kept only the text size; Appearance then starts at Light.
      version: 2,
      migrate: (persisted) => readSaved(persisted, { textSize: "normal", appearance: "light" }) as PreferencesState,
      merge: (persisted, current) => ({ ...current, ...readSaved(persisted, current) }),
    },
  ),
);
