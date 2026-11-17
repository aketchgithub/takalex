import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { authStorage } from "@/lib/storage";
import { isTextSize, type TextSize } from "@/theme/textSize";

// Per-phone display preferences, kept on the device (not in the database).
type PreferencesState = {
  textSize: TextSize;
  setTextSize: (size: TextSize) => void;
};

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      textSize: "normal",
      setTextSize: (size) => set({ textSize: size }),
    }),
    {
      name: "takalex-preferences",
      storage: createJSONStorage(() => authStorage),
      partialize: (state) => ({ textSize: state.textSize }),
      version: 1,
      // Anything unexpected in storage falls back to Normal.
      migrate: (persisted) => {
        const saved = (persisted ?? {}) as Partial<PreferencesState>;
        return { textSize: isTextSize(saved.textSize) ? saved.textSize : "normal" } as PreferencesState;
      },
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<PreferencesState>;
        return { ...current, textSize: isTextSize(saved.textSize) ? saved.textSize : current.textSize };
      },
    },
  ),
);
