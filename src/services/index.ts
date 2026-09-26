// Single injection point: the real Tauri engine (Rust + mpv). No fake data.
import { isTauri } from "@tauri-apps/api/core"
import { tauriBackend, initTauriBackend, getTrackSyncTauri } from "./tauriBackend"
import type { MusicBackend } from "./backend"
import type { Track } from "../types"

export const backend: MusicBackend = tauriBackend

/** Resolves once the engine can answer synchronous calls (player state, track cache). */
export const backendReady: Promise<void> = isTauri()
  ? initTauriBackend()
  : Promise.reject(new Error("Aura doit être ouvert dans sa fenêtre d'application (npm run tauri dev), pas dans un navigateur."))

export function getTrackSync(id: string): Track | undefined {
  return getTrackSyncTauri(id)
}

export type { MusicBackend, SearchResults, Unsubscribe } from "./backend"
