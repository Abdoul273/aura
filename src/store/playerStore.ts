import { create } from "zustand"
import { backend } from "../services"
import type { PlayerState, Track } from "../types"

interface PlayerStore extends PlayerState {
  currentTrack: Track | null
  analyser: number[]
  // actions
  playTracks: (trackIds: string[], startIndex: number) => void
  toggle: () => void
  next: () => void
  previous: () => void
  seek: (ms: number) => void
  seekBy: (ms: number) => void
  setVolume: (v: number) => void
  changeVolume: (delta: number) => void
  toggleMute: () => void
  toggleShuffle: () => void
  cycleRepeat: () => void
}

const initial = backend.player.getState()

export const usePlayer = create<PlayerStore>((set, get) => ({
  ...initial,
  currentTrack: null,
  analyser: new Array(64).fill(0),

  playTracks: (trackIds, startIndex) => backend.player.play(trackIds, startIndex),
  toggle: () => {
    const s = get()
    if (s.status === "playing") backend.player.pause()
    else backend.player.resume()
  },
  next: () => backend.player.next(),
  previous: () => backend.player.previous(),
  seek: (ms) => backend.player.seek(ms),
  seekBy: (ms) => backend.player.seek(get().positionMs + ms),
  setVolume: (v) => backend.player.setVolume(v),
  changeVolume: (delta) => backend.player.setVolume(Math.max(0, Math.min(1, get().volume + delta))),
  toggleMute: () => backend.player.setMuted(!get().muted),
  toggleShuffle: () => backend.player.setShuffle(!get().shuffle),
  cycleRepeat: () => {
    const order = ["off", "all", "one"] as const
    const cur = order.indexOf(get().repeat)
    backend.player.setRepeat(order[(cur + 1) % 3])
  },
}))

// Wire backend events -> store. These run once for the app lifetime.
backend.player.onStateChange(async (s) => {
  const track = s.currentTrackId ? await backend.library.getTrack(s.currentTrackId) : null
  usePlayer.setState({ ...s, currentTrack: track })
})
backend.player.onPosition((ms) => usePlayer.setState({ positionMs: ms }))
backend.player.onAnalyser((bins) => usePlayer.setState({ analyser: bins }))
