import { useEffect } from "react"
import { usePlayer } from "../store/playerStore"
import { useSettings } from "../store/settingsStore"

// Pushes the current track's palette into CSS variables with a smooth
// transition, so the whole app re-tints when the track changes.
export function useDynamicColor() {
  const track = usePlayer((s) => s.currentTrack)
  const dynamic = useSettings((s) => s.settings?.dynamicColor ?? true)

  useEffect(() => {
    const root = document.documentElement
    root.style.transition = "background-color 800ms ease"
    if (!dynamic || !track) {
      root.style.setProperty("--dyn-dominant", "#6d5bd6")
      root.style.setProperty("--dyn-accent", "#b06dff")
      root.style.setProperty("--dyn-muted", "#241a3a")
      return
    }
    root.style.setProperty("--dyn-dominant", track.colors.dominant)
    root.style.setProperty("--dyn-accent", track.colors.accent)
    root.style.setProperty("--dyn-muted", track.colors.muted)
  }, [track, dynamic])
}
