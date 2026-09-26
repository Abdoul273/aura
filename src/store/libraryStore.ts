import { create } from "zustand"
import { backend } from "../services"
import type { Album, Artist, ScanProgress } from "../types"

interface LibraryStore {
  albums: Album[]
  artists: Artist[]
  favorites: Set<string>
  scan: ScanProgress
  /** Bumped whenever the library content changes, so screens can reload. */
  version: number
  albumsLoaded: boolean
  artistsLoaded: boolean
  loadAlbums: () => Promise<void>
  loadArtists: () => Promise<void>
  loadFavorites: () => Promise<void>
  toggleFavorite: (trackId: string) => Promise<boolean>
  rescan: () => Promise<void>
}

export const useLibrary = create<LibraryStore>((set, get) => ({
  albums: [],
  artists: [],
  favorites: new Set(),
  scan: { scanning: false, current: 0, total: 0, currentPath: "" },
  version: 0,
  albumsLoaded: false,
  artistsLoaded: false,
  loadAlbums: async () => {
    const albums = await backend.library.getAlbums()
    set({ albums, albumsLoaded: true })
  },
  loadArtists: async () => {
    const artists = await backend.library.getArtists()
    set({ artists, artistsLoaded: true })
  },
  loadFavorites: async () => {
    const list = await backend.favorites.list()
    set({ favorites: new Set(list) })
  },
  toggleFavorite: async (trackId) => {
    const fav = await backend.favorites.toggle(trackId)
    const next = new Set(get().favorites)
    if (fav) next.add(trackId)
    else next.delete(trackId)
    set({ favorites: next })
    return fav
  },
  rescan: async () => {
    await backend.library.rescan()
    await get().loadAlbums()
    await get().loadArtists()
  },
}))

backend.library.onScanProgress((p) => useLibrary.setState({ scan: p }))
backend.library.onChanged(() => {
  const s = useLibrary.getState()
  useLibrary.setState({ version: s.version + 1 })
  if (s.albumsLoaded) void s.loadAlbums()
  if (s.artistsLoaded) void s.loadArtists()
  void s.loadFavorites()
})
