import { useEffect, useMemo, useState } from "react"
import { motion } from "framer-motion"
import { Play, Shuffle, Check, Plus } from "lucide-react"
import type { Album, Artist, Track } from "../../types"
import { backend } from "../../services"
import { usePlaybackActions } from "../../hooks/usePlaybackActions"
import { usePlayer } from "../../store/playerStore"
import CoverArt from "../../components/CoverArt"
import TrackRow from "../../components/TrackRow"
import { AlbumCard, ArtistCard, Carousel } from "../../components/cards"
import { RowsSkeleton, Skeleton } from "../../components/Skeleton"
import { formatCount } from "../../utils/format"
import { cn } from "../../utils/cn"
import { coverGradient } from "../../utils/color"

interface Data {
  artist: Artist
  albums: Album[]
  topTracks: Track[]
  similar: Artist[]
}

type TabKey = "Albums" | "EP" | "Singles"
const TAB_ORDER: TabKey[] = ["Albums", "EP", "Singles"]

function bucket(album: Album): TabKey {
  if (album.trackCount >= 7) return "Albums"
  if (album.trackCount >= 3) return "EP"
  return "Singles"
}

export default function ArtistDetail({ id }: { id: string }) {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [following, setFollowing] = useState(false)
  const actions = usePlaybackActions()
  const toggleShuffle = usePlayer((s) => s.toggleShuffle)

  useEffect(() => {
    let alive = true
    setLoading(true)
    backend.library.getArtist(id).then((res) => {
      if (!alive) return
      setData(res)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [id])

  const groups = useMemo(() => {
    const g: Record<TabKey, Album[]> = { Albums: [], EP: [], Singles: [] }
    data?.albums.forEach((a) => g[bucket(a)].push(a))
    return g
  }, [data])

  const availableTabs = useMemo(() => TAB_ORDER.filter((t) => groups[t].length > 0), [groups])
  const [tab, setTab] = useState<TabKey>("Albums")

  useEffect(() => {
    if (availableTabs.length && !availableTabs.includes(tab)) setTab(availableTabs[0])
  }, [availableTabs, tab])

  if (loading) {
    return (
      <div className="p-8">
        <Skeleton className="mb-8 h-64 w-full rounded-3xl" />
        <RowsSkeleton count={6} />
      </div>
    )
  }

  if (!data) {
    return <div className="p-8 text-mid">Artiste introuvable.</div>
  }

  const { artist, topTracks, similar } = data
  const trackIds = topTracks.map((t) => t.id)

  return (
    <div className="p-8">
      {/* Banner */}
      <motion.header
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative mb-10 overflow-hidden rounded-3xl p-8"
        style={{ background: coverGradient(artist.colors) }}
      >
        <div className="absolute inset-0 bg-black/35" />
        <div className="relative flex flex-col items-center gap-6 sm:flex-row sm:items-end">
          <CoverArt
            colors={artist.colors}
            seed={artist.id}
            size={180}
            rounded="rounded-full"
            className="h-40 w-40 shrink-0 shadow-2xl ring-4 ring-white/10"
          />
          <div className="min-w-0 flex-1 text-center sm:text-left">
            <h1 className="truncate text-5xl font-bold tracking-tight text-white drop-shadow">{artist.name}</h1>
            <p className="mt-2 text-sm font-medium text-white/80 tnum">
              {formatCount(artist.monthlyListeners)} écoutes
            </p>
            <div className="mt-3 flex flex-wrap justify-center gap-2 sm:justify-start">
              {artist.genres.map((g) => (
                <span key={g} className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold text-white backdrop-blur">
                  {g}
                </span>
              ))}
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-3 sm:justify-start">
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
              <button
                onClick={() => setFollowing((f) => !f)}
                className={cn(
                  "flex items-center gap-2 rounded-full border px-5 py-2.5 text-sm font-semibold text-white backdrop-blur transition-transform active:scale-95",
                  following ? "border-white/60 bg-white/20" : "border-white/40",
                )}
              >
                {following ? <Check size={16} /> : <Plus size={16} />}
                {following ? "Suivi" : "Suivre"}
              </button>
            </div>
          </div>
        </div>
      </motion.header>

      {/* Titres populaires */}
      {topTracks.length > 0 && (
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="mb-10"
        >
          <h2 className="mb-4 text-xl font-bold tracking-tight text-hi">Titres populaires</h2>
          <div className="space-y-1">
            {topTracks.map((t, i) => (
              <TrackRow
                key={t.id}
                track={t}
                index={i + 1}
                showAlbum
                onPlay={() => actions.playContext(trackIds, i)}
              />
            ))}
          </div>
        </motion.section>
      )}

      {/* Discographie */}
      {availableTabs.length > 0 && (
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="mb-10"
        >
          <h2 className="mb-4 text-xl font-bold tracking-tight text-hi">Discographie</h2>
          <div className="mb-5 flex gap-6 border-b border-[var(--glass-border)]">
            {availableTabs.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  "relative pb-3 text-sm font-semibold transition-colors",
                  tab === t ? "text-hi" : "text-mid hover:text-hi",
                )}
              >
                {t}
                {tab === t && (
                  <motion.span
                    layoutId="artist-disco-underline"
                    className="absolute inset-x-0 -bottom-px h-0.5 rounded-full"
                    style={{ background: "var(--accent)" }}
                  />
                )}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-6">
            {groups[tab].map((album) => (
              <AlbumCard key={album.id} album={album} />
            ))}
          </div>
        </motion.section>
      )}

      {/* Artistes similaires */}
      {similar.length > 0 && (
        <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <Carousel title="Artistes similaires">
            {similar.map((a) => (
              <div key={a.id} className="shrink-0">
                <ArtistCard artist={a} width={160} />
              </div>
            ))}
          </Carousel>
        </motion.section>
      )}
    </div>
  )
}
