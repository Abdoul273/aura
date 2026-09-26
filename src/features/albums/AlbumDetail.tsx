import { useEffect, useState } from "react"
import { motion } from "framer-motion"
import { Play, Shuffle, ListPlus, MoreHorizontal } from "lucide-react"
import type { Album, Track } from "../../types"
import { backend } from "../../services"
import CoverArt from "../../components/CoverArt"
import TrackRow from "../../components/TrackRow"
import { AlbumCard, Carousel } from "../../components/cards"
import { Skeleton } from "../../components/Skeleton"
import IconButton from "../../components/IconButton"
import { useOpenMenu } from "../../components/TrackContextMenu"
import { usePlaybackActions } from "../../hooks/usePlaybackActions"
import { usePlayer } from "../../store/playerStore"
import { useUI } from "../../store/uiStore"
import { formatDuration } from "../../utils/format"
import { coverGradient } from "../../utils/color"

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="glass rounded-full px-2.5 py-1 text-xs font-semibold text-hi">{children}</span>
}

export default function AlbumDetail({ id }: { id: string }) {
  const [data, setData] = useState<{ album: Album; tracks: Track[] } | null>(null)
  const [siblings, setSiblings] = useState<Album[]>([])
  const [loading, setLoading] = useState(true)
  const actions = usePlaybackActions()
  const navigate = useUI((s) => s.navigate)
  const openMenu = useOpenMenu()
  const toggleShuffle = usePlayer((s) => s.toggleShuffle)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setSiblings([])
    backend.library.getAlbum(id).then((res) => {
      if (!alive) return
      setData(res)
      setLoading(false)
      if (res) {
        backend.library.getArtist(res.album.artistId).then((art) => {
          if (alive && art) setSiblings(art.albums.filter((a) => a.id !== res.album.id))
        })
      }
    })
    return () => {
      alive = false
    }
  }, [id])

  if (loading) {
    return (
      <div className="p-8 pb-8">
        <div className="flex gap-8">
          <Skeleton className="h-56 w-56 rounded-3xl" />
          <div className="flex-1 space-y-4 pt-8">
            <Skeleton className="h-10 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-10 w-40 rounded-full" />
          </div>
        </div>
      </div>
    )
  }

  if (!data) {
    return <div className="p-8 text-mid">Album introuvable.</div>
  }

  const { album, tracks } = data
  const trackIds = tracks.map((t) => t.id)
  const first = tracks[0]

  const playAll = () => actions.playContext(trackIds, 0)
  const shufflePlay = () => {
    toggleShuffle()
    actions.playContext([...trackIds].sort(() => Math.random() - 0.5), 0)
  }

  let lastDisc = -1

  return (
    <div className="p-8 pb-8">
      <motion.header
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative mb-10 overflow-hidden rounded-3xl p-8"
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-30"
          style={{ background: coverGradient(album.colors) }}
        />
        <div className="pointer-events-none absolute inset-0" style={{ background: "linear-gradient(to bottom, transparent, rgba(0,0,0,.35))" }} />
        <div className="relative flex flex-col items-center gap-8 md:flex-row md:items-end">
          <CoverArt colors={album.colors} seed={album.id} size={220} className="h-56 w-56 shrink-0 shadow-2xl" />
          <div className="min-w-0 flex-1">
            <span className="text-xs font-semibold uppercase tracking-widest text-mid">Album</span>
            <h1 className="mt-2 text-4xl font-bold leading-tight tracking-tight text-hi">{album.title}</h1>
            <button
              onClick={() => navigate({ name: "artist", id: album.artistId })}
              className="mt-2 text-lg font-semibold text-hi hover:underline"
            >
              {album.artist}
            </button>
            <div className="mt-2 text-sm text-mid">
              {album.year} · {album.trackCount} titres · {formatDuration(album.durationMs)}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Badge>{album.codec}</Badge>
              <Badge>{album.quality}</Badge>
              {first && <Badge>{first.sampleRate / 1000} kHz · {first.bitDepth} bits</Badge>}
              {album.genre && <Badge>{album.genre}</Badge>}
            </div>
          </div>
        </div>

        <div className="relative mt-8 flex items-center gap-3">
          <button
            onClick={playAll}
            className="focus-ring flex items-center gap-2 rounded-full px-7 py-3 text-sm font-semibold text-white transition-transform active:scale-95"
            style={{ background: "var(--accent)" }}
          >
            <Play size={18} fill="currentColor" /> Lecture
          </button>
          <IconButton label="Lecture aléatoire" onClick={shufflePlay}>
            <Shuffle size={18} />
          </IconButton>
          <IconButton label="Ajouter à la file" onClick={() => actions.addToQueue(trackIds)}>
            <ListPlus size={18} />
          </IconButton>
          <IconButton label="Plus d'options" onClick={(e) => openMenu(e as React.MouseEvent, "album", album.id, trackIds)}>
            <MoreHorizontal size={18} />
          </IconButton>
        </div>
      </motion.header>

      <section className="mb-10">
        {tracks.map((t, i) => {
          const showDisc = t.discNumber !== lastDisc
          lastDisc = t.discNumber
          const discCount = new Set(tracks.map((x) => x.discNumber)).size
          return (
            <div key={t.id}>
              {showDisc && discCount > 1 && (
                <div className="mb-2 mt-5 px-3 text-xs font-semibold uppercase tracking-wide text-lo first:mt-0">
                  Disque {t.discNumber}
                </div>
              )}
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i, 25) * 0.02 }}
              >
                <TrackRow
                  track={t}
                  index={t.trackNumber}
                  showCover={false}
                  showAlbum={false}
                  onPlay={() => actions.playContext(trackIds, i)}
                />
              </motion.div>
            </div>
          )
        })}
      </section>

      {siblings.length > 0 && (
        <Carousel title={`Autres albums de ${album.artist}`}>
          {siblings.map((a, i) => (
            <motion.div
              key={a.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              className="w-[172px] shrink-0"
            >
              <AlbumCard album={a} width={172} />
            </motion.div>
          ))}
        </Carousel>
      )}
    </div>
  )
}
