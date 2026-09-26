import { create } from "zustand"
import { backend } from "../services"
import type { Playlist } from "../types"

interface PlaylistStore {
  playlists: Playlist[]
  load: () => Promise<void>
  create: (name: string) => Promise<Playlist>
  rename: (id: string, name: string) => Promise<void>
  update: (id: string, patch: Partial<Pick<Playlist, "name" | "description">>) => Promise<void>
  remove: (id: string) => Promise<void>
  addTracks: (id: string, trackIds: string[]) => Promise<void>
  removeTracks: (id: string, trackIds: string[]) => Promise<void>
  reorder: (id: string, from: number, to: number) => Promise<void>
}

export const usePlaylists = create<PlaylistStore>((set, get) => ({
  playlists: [],
  load: async () => set({ playlists: await backend.playlists.list() }),
  create: async (name) => {
    const p = await backend.playlists.create(name)
    await get().load()
    return p
  },
  rename: async (id, name) => {
    await backend.playlists.rename(id, name)
    await get().load()
  },
  update: async (id, patch) => {
    await backend.playlists.update(id, patch)
    await get().load()
  },
  remove: async (id) => {
    await backend.playlists.delete(id)
    await get().load()
  },
  addTracks: async (id, trackIds) => {
    await backend.playlists.addTracks(id, trackIds)
    await get().load()
  },
  removeTracks: async (id, trackIds) => {
    await backend.playlists.removeTracks(id, trackIds)
    await get().load()
  },
  reorder: async (id, from, to) => {
    await backend.playlists.reorder(id, from, to)
    await get().load()
  },
}))
