import { create } from "zustand"
import { backend } from "../services"
import type { Settings } from "../types"

interface SettingsStore {
  settings: Settings | null
  load: () => Promise<void>
  update: (patch: Partial<Settings>) => Promise<void>
}

export const useSettings = create<SettingsStore>((set, get) => ({
  settings: null,
  load: async () => {
    const s = await backend.settings.get()
    set({ settings: s })
    applyTheme(s)
  },
  update: async (patch) => {
    const s = await backend.settings.update(patch)
    set({ settings: s })
    applyTheme(s)
  },
}))

export function applyTheme(s: Settings) {
  const root = document.documentElement
  root.classList.toggle("light", s.theme === "light")
  root.style.setProperty("--accent", s.accent)
  // Keep the glass effect subtle: large blurred surfaces are costly in WebKitGTK.
  root.style.setProperty("--blur", `${4 + (s.blurIntensity / 100) * 10}px`)
  root.dataset.animations = s.animations ? "on" : "off"
}
