import { useEffect } from "react"
import { usePlayer } from "../store/playerStore"
import { useUI } from "../store/uiStore"
import { useLibrary } from "../store/libraryStore"

function isTyping(): boolean {
  const el = document.activeElement
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || (el as HTMLElement).isContentEditable)
}

export function useKeyboardShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = useUI.getState()
      const p = usePlayer.getState()

      // Command palette — always available
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        ui.setCommandOpen(!ui.commandOpen)
        return
      }
      if (e.key === "/" && !isTyping()) {
        e.preventDefault()
        ui.navigate({ name: "search" })
        return
      }
      if (isTyping()) return

      if ((e.ctrlKey || e.metaKey) && e.key === "ArrowRight") {
        e.preventDefault()
        p.next()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "ArrowLeft") {
        e.preventDefault()
        p.previous()
        return
      }

      switch (e.key) {
        case " ":
          e.preventDefault()
          p.toggle()
          break
        case "ArrowRight":
          p.seekBy(5000)
          break
        case "ArrowLeft":
          p.seekBy(-5000)
          break
        case "ArrowUp":
          e.preventDefault()
          p.changeVolume(0.05)
          break
        case "ArrowDown":
          e.preventDefault()
          p.changeVolume(-0.05)
          break
        case "m":
        case "M":
          p.toggleMute()
          break
        case "s":
        case "S":
          p.toggleShuffle()
          break
        case "r":
        case "R":
          p.cycleRepeat()
          break
        case "l":
        case "L":
          if (p.currentTrackId) useLibrary.getState().toggleFavorite(p.currentTrackId)
          break
        case "f":
        case "F":
          ui.setNowPlaying(!ui.nowPlayingOpen)
          break
        case "Escape":
          if (ui.nowPlayingOpen) ui.setNowPlaying(false)
          break
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
}
