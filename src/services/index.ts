// The ONLY place the concrete backend is referenced. Swap this line to plug in
// the real Tauri-backed audio engine later.
import { mockBackend } from "./mockBackend"
import type { MusicBackend } from "./backend"

export const backend: MusicBackend = mockBackend
export { getTrackSync } from "./mockBackend"
export type { MusicBackend, SearchResults, Unsubscribe } from "./backend"
