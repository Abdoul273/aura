import { create } from "zustand"
import { backend } from "../services"
import type { Album, Artist, ScanProgress } from "../types"

interface LibraryStore {
  albums: Album[]
  artists: Artist[]
  favorites: Set<string>
  scan: ScanProgress
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
