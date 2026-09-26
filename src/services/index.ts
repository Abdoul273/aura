// The ONLY place the concrete backend is chosen: the real Tauri engine inside
// the desktop app, the in-memory mock in a plain browser (`npm run dev`).
import { isTauri } from "@tauri-apps/api/core"
import { mockBackend, getTrackSync as getMockTrack } from "./mockBackend"
import { tauriBackend, initTauriBackend, getTrackSyncTauri } from "./tauriBackend"
import type { MusicBackend } from "./backend"
import type { Track } from "../types"

const native = isTauri()

export const backend: MusicBackend = native ? tauriBackend : mockBackend

/** Resolves once the backend can answer synchronous calls (player state, track cache). */
export const backendReady: Promise<void> = native ? initTauriBackend() : Promise.resolve()

export function getTrackSync(id: string): Track | undefined {
  return native ? getTrackSyncTauri(id) : getMockTrack(id)
}

export type { MusicBackend, SearchResults, Unsubscribe } from "./backend"
