import { useEffect, useMemo, useState } from "react"
import { motion } from "framer-motion"
import { Heart, Play, Shuffle } from "lucide-react"
import type { Track } from "../../types"
import { backend, getTrackSync } from "../../services"
import { useLibrary } from "../../store/libraryStore"
import { usePlayer } from "../../store/playerStore"
import { usePlaybackActions } from "../../hooks/usePlaybackActions"
import TrackRow from "../../components/TrackRow"
import EmptyState from "../../components/EmptyState"
import { RowsSkeleton } from "../../components/Skeleton"
import { formatCount, formatDuration } from "../../utils/format"

export default function Favorites() {
  const favorites = useLibrary((s) => s.favorites)
  const [ids, setIds] = useState<string[] | null>(null)
  const actions = usePlaybackActions()
  const toggleShuffle = usePlayer((s) => s.toggleShuffle)

  useEffect(() => {
    let alive = true
    backend.favorites.list().then((list) => {
      if (alive) setIds(list)
    })
    return () => {
      alive = false
    }
    // Re-read whenever the library favorites set changes.
  }, [favorites])

  const tracks = useMemo<Track[]>(
    () => (ids ?? []).map((id) => getTrackSync(id)).filter((t): t is Track => !!t),
    [ids],
  )
  const trackIds = tracks.map((t) => t.id)
  const totalMs = tracks.reduce((sum, t) => sum + t.durationMs, 0)

  if (ids === null) {
    return (
      <div className="p-8">
        <RowsSkeleton count={10} />
      </div>
    )
  }

  if (tracks.length === 0) {
    return (
      <div className="p-8">
        <EmptyState
          icon={<Heart size={34} />}
          title="Aucun favori"
          description="Aimez des titres pour les retrouver ici."
        />
      </div>
    )
  }

  return (
    <div className="p-8">
      <motion.header
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative mb-8 flex items-end gap-6 overflow-hidden rounded-3xl p-8"
        style={{ background: `linear-gradient(135deg, var(--accent) 0%, rgba(124,92,255,0.35) 60%, transparent 100%)` }}
      >
        <div className="absolute inset-0 bg-black/25" />
        <div className="relative grid h-36 w-36 shrink-0 place-items-center rounded-3xl bg-white/15 shadow-2xl backdrop-blur">
          <Heart size={64} className="text-white" fill="currentColor" />
        </div>
        <div className="relative min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-widest text-white/70">Playlist</p>
          <h1 className="mt-1 text-5xl font-bold tracking-tight text-white drop-shadow">Favoris</h1>
          <p className="mt-3 text-sm font-medium text-white/80 tnum">
            {formatCount(tracks.length)} titres · {formatDuration(totalMs)}
          </p>
          <div className="mt-5 flex items-center gap-3">
            <button
              onClick={() => actions.playContext(trackIds, 0)}
              className="flex items-center gap-2 rounded-full px-6 py-2.5 text-sm font-bold text-white shadow-lg transition-transform active:scale-95"
              style={{ background: "var(--accent)" }}
            >
              <Play size={16} fill="currentColor" /> Lire
            </button>
            <button
              onClick={() => {
                toggleShuffle()
                actions.playContext(trackIds, 0)
              }}
              className="flex items-center gap-2 rounded-full bg-white/15 px-5 py-2.5 text-sm font-semibold text-white backdrop-blur transition-transform active:scale-95"
            >
              <Shuffle size={16} /> Aléatoire
            </button>
          </div>
        </div>
      </motion.header>

      <div className="space-y-1">
        {tracks.map((t, i) => (
          <TrackRow
            key={t.id}
            track={t}
            index={i + 1}
            showCover
            showAlbum
            onPlay={() => actions.playContext(trackIds, i)}
          />
        ))}
      </div>
    </div>
  )
}
