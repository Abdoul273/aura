import { useCallback, useEffect, useState } from "react"
import { backend } from "../services"
import type { Lyrics } from "../types"

// Cache mémoire partagé entre le tiroir et le plein écran ; les requêtes en vol sont mutualisées.
const cache = new Map<string, Lyrics>()
const inflight = new Map<string, Promise<Lyrics>>()

function load(trackId: string, force = false): Promise<Lyrics> {
  if (!force && cache.has(trackId)) return Promise.resolve(cache.get(trackId) ?? null)
  const pending = !force && inflight.get(trackId)
  if (pending) return pending
  const p = backend.lyrics
    .get(trackId, force)
    .catch(() => null)
    .then((l) => {
      cache.set(trackId, l)
      inflight.delete(trackId)
      return l
    })
  inflight.set(trackId, p)
  return p
}

/** Précharge les paroles (morceau suivant) pour un affichage instantané. */
export function prefetchLyrics(trackId: string | null | undefined) {
  if (trackId && !cache.has(trackId)) void load(trackId)
}

export function useLyrics(trackId: string | null) {
  const [state, setState] = useState<{ id: string | null; lyrics: Lyrics; loading: boolean }>(() => ({
    id: trackId,
    lyrics: trackId ? (cache.get(trackId) ?? null) : null,
    loading: !!trackId && !cache.has(trackId),
  }))

  useEffect(() => {
    if (!trackId) {
      setState({ id: null, lyrics: null, loading: false })
      return
    }
    let alive = true
    const hit = cache.has(trackId)
    setState({ id: trackId, lyrics: cache.get(trackId) ?? null, loading: !hit })
    if (!hit) load(trackId).then((l) => alive && setState({ id: trackId, lyrics: l, loading: false }))
    return () => {
      alive = false
    }
  }, [trackId])

  const refresh = useCallback(() => {
    if (!trackId) return
    setState({ id: trackId, lyrics: null, loading: true })
    load(trackId, true).then((l) => setState((s) => (s.id === trackId ? { id: trackId, lyrics: l, loading: false } : s)))
  }, [trackId])

  return { lyrics: state.id === trackId ? state.lyrics : null, loading: state.id === trackId ? state.loading : true, refresh }
}
