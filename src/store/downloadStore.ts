import { create } from "zustand"
import { backend } from "../services"
import type { DlJob, DlResult, LyricsAvailability } from "../types"

// Téléchargements et recherche conservés hors de l'écran : on peut naviguer pendant qu'ils avancent.
interface DownloadStore {
  jobs: Record<string, DlJob>
  query: string
  results: DlResult[] | null
  searching: boolean
  error: string | null
  probes: Record<string, LyricsAvailability | "loading">
  search: (query: string) => Promise<void>
  editResult: (id: string, patch: Partial<Pick<DlResult, "artist" | "track">>) => void
  probe: (r: DlResult) => void
  start: (r: DlResult) => void
  cancel: (id: string) => void
  clearFinished: () => void
}

const probeKey = (r: DlResult) => `${r.id}|${r.artist}|${r.track}`

// Aperçu des paroles : trois à la fois pour ménager LRCLIB.
const probeQueue: DlResult[] = []
let probing = 0
function pumpProbes() {
  while (probing < 3 && probeQueue.length) {
    const r = probeQueue.shift()!
    probing++
    backend.downloads
      .probe(r)
      .catch(() => "none" as const)
      .then((kind) => useDownloads.setState((s) => ({ probes: { ...s.probes, [probeKey(r)]: kind } })))
      .finally(() => {
        probing--
        pumpProbes()
      })
  }
}

export const lyricsFor = (s: DownloadStore, r: DlResult) => s.probes[probeKey(r)]

export const useDownloads = create<DownloadStore>((set, get) => ({
  jobs: {},
  query: "",
  results: null,
  searching: false,
  error: null,
  probes: {},

  search: async (query) => {
    const q = query.trim()
    if (!q) return
    probeQueue.length = 0
    set({ query: q, searching: true, error: null })
    try {
      const results = await backend.downloads.search(q)
      set({ results, searching: false })
      results.filter((r) => r.kind !== "live").slice(0, 15).forEach((r) => get().probe(r))
    } catch (e) {
      set({ searching: false, results: [], error: String(e) })
    }
  },

  editResult: (id, patch) => set((s) => ({ results: s.results?.map((r) => (r.id === id ? { ...r, ...patch } : r)) ?? null })),

  probe: (r) => {
    const key = probeKey(r)
    if (get().probes[key]) return
    set((s) => ({ probes: { ...s.probes, [key]: "loading" } }))
    probeQueue.push(r)
    pumpProbes()
  },

  start: (r) => {
    void backend.downloads.start(r).then((job) => set((s) => ({ jobs: { ...s.jobs, [job.id]: job } })))
  },
  cancel: (id) => void backend.downloads.cancel(id),
  clearFinished: () => {
    void backend.downloads.clearFinished()
    set((s) => ({ jobs: Object.fromEntries(Object.entries(s.jobs).filter(([, j]) => !["done", "error", "canceled"].includes(j.status))) }))
  },
}))

backend.downloads.onUpdate((job) => useDownloads.setState((s) => ({ jobs: { ...s.jobs, [job.id]: job } })))
void backend.downloads
  .list()
  .then((list) => useDownloads.setState((s) => ({ jobs: { ...Object.fromEntries(list.map((j) => [j.id, j])), ...s.jobs } })))
  .catch(() => {})
