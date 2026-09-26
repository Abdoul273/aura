import { create } from "zustand"

export type Route =
  | { name: "home" }
  | { name: "tracks" }
  | { name: "albums" }
  | { name: "album"; id: string }
  | { name: "artists" }
  | { name: "artist"; id: string }
  | { name: "folders" }
  | { name: "favorites" }
  | { name: "playlist"; id: string }
  | { name: "search" }
  | { name: "radios" }
  | { name: "stats" }
  | { name: "equalizer" }
  | { name: "settings" }

export interface ContextMenuState {
  x: number
  y: number
  kind: "track" | "album" | "artist" | "playlist"
  id: string
  trackIds?: string[]
}

export interface Toast {
  id: string
  message: string
  action?: { label: string; onClick: () => void }
}

interface UIStore {
  route: Route
  past: Route[]
  future: Route[]
  navigate: (r: Route) => void
  back: () => void
  forward: () => void
  canBack: boolean
  canForward: boolean

  nowPlayingOpen: boolean
  miniPlayer: boolean
  commandOpen: boolean
  setNowPlaying: (v: boolean) => void
  setMiniPlayer: (v: boolean) => void
  setCommandOpen: (v: boolean) => void

  contextMenu: ContextMenuState | null
  openContextMenu: (m: ContextMenuState) => void
  closeContextMenu: () => void

  addToPlaylistFor: string[] | null
  setAddToPlaylistFor: (ids: string[] | null) => void

  propertiesTrackId: string | null
  setPropertiesTrackId: (id: string | null) => void

  toasts: Toast[]
  toast: (message: string, action?: Toast["action"]) => void
  dismissToast: (id: string) => void
}

export const useUI = create<UIStore>((set, get) => ({
  route: { name: "home" },
  past: [],
  future: [],
  canBack: false,
  canForward: false,
  navigate: (r) => {
    const { route, past } = get()
    set({ route: r, past: [...past, route], future: [], canBack: true, canForward: false })
  },
  back: () => {
    const { past, future, route } = get()
    if (!past.length) return
    const prev = past[past.length - 1]
    set({
      route: prev,
      past: past.slice(0, -1),
      future: [route, ...future],
      canBack: past.length - 1 > 0,
      canForward: true,
    })
  },
  forward: () => {
    const { past, future, route } = get()
    if (!future.length) return
    const nxt = future[0]
    set({
      route: nxt,
      future: future.slice(1),
      past: [...past, route],
      canForward: future.length - 1 > 0,
      canBack: true,
    })
  },

  nowPlayingOpen: false,
  miniPlayer: false,
  commandOpen: false,
  setNowPlaying: (v) => set({ nowPlayingOpen: v }),
  setMiniPlayer: (v) => set({ miniPlayer: v }),
  setCommandOpen: (v) => set({ commandOpen: v }),

  contextMenu: null,
  openContextMenu: (m) => set({ contextMenu: m }),
  closeContextMenu: () => set({ contextMenu: null }),

  addToPlaylistFor: null,
  setAddToPlaylistFor: (ids) => set({ addToPlaylistFor: ids }),

  propertiesTrackId: null,
  setPropertiesTrackId: (id) => set({ propertiesTrackId: id }),

  toasts: [],
  toast: (message, action) => {
    const id = `t${Date.now()}${Math.random()}`
    set({ toasts: [...get().toasts, { id, message, action }] })
    setTimeout(() => get().dismissToast(id), 5000)
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}))
