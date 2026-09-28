import { useEffect, useState } from "react"
import { motion } from "framer-motion"
import { Play, Shuffle, ListPlus, MoreHorizontal, Disc3, AudioLines, ImagePlus } from "lucide-react"
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
  const toast = useUI((s) => s.toast)
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
  const chooseCover = async () => {
    try {
      const path = await backend.system.pickImage()
      if (!path) return
      await backend.library.setAlbumCover(album.id, path)
      toast("Pochette mise à jour")
    } catch (error) {
      toast(`Impossible de changer la pochette : ${String(error)}`)
    }
  }
  const shufflePlay = () => {
    toggleShuffle()
    actions.playContext([...trackIds].sort(() => Math.random() - 0.5), 0)
  }

  let lastDisc = -1

  return (
    <div className="p-5 pb-10 md:p-8">
      <motion.header
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative mb-9 overflow-hidden rounded-[32px] border border-white/10 p-6 shadow-[0_28px_80px_-36px_rgba(0,0,0,.8)] md:p-9"
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-55"
          style={{ background: `radial-gradient(ellipse at 17% 15%, ${album.colors.accent}, transparent 58%), ${coverGradient(album.colors)}` }}
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/25 via-[#101018]/55 to-[#101018]/90" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/30 to-transparent" />
        <div className="relative flex flex-col items-center gap-8 md:flex-row md:items-end md:gap-10">
          <div className="relative shrink-0">
            <div className="absolute -inset-3 rounded-[30px] border border-white/15 bg-white/5" />
            <CoverArt colors={album.colors} seed={album.id} size={320} alt={`Pochette de ${album.title}`} priority className="relative h-52 w-52 shadow-[0_24px_70px_-12px_rgba(0,0,0,.75)] ring-1 ring-white/20 md:h-60 md:w-60" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="mb-4 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-white/75"><Disc3 size={15} /> Album · {album.quality}</div>
            <h1 className="max-w-[18ch] text-center text-3xl font-extrabold leading-[1.08] tracking-[-0.04em] text-white md:text-left md:text-5xl">{album.title}</h1>
            <button
              onClick={() => navigate({ name: "artist", id: album.artistId })}
              className="mt-4 block text-lg font-semibold text-white/90 transition-colors hover:text-white hover:underline"
            >
              {album.artist}
            </button>
            <div className="mt-2 text-sm text-white/65">
              {album.year || "Année inconnue"} <span className="mx-1 text-white/30">•</span> {album.trackCount} titre{album.trackCount > 1 ? "s" : ""} <span className="mx-1 text-white/30">•</span> {formatDuration(album.durationMs)}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Badge>{album.codec}</Badge>
              <Badge>{album.quality}</Badge>
              {first && <Badge>{first.sampleRate / 1000} kHz · {first.bitDepth} bits</Badge>}
              {album.genre && <Badge>{album.genre}</Badge>}
            </div>
          </div>
        </div>

        <div className="relative mt-9 flex flex-wrap items-center gap-3 border-t border-white/10 pt-6">
          <button
            onClick={playAll}
            className="focus-ring flex items-center gap-2 rounded-full bg-white px-7 py-3 text-sm font-bold text-[#14121c] shadow-[0_10px_30px_-8px_rgba(255,255,255,.55)] transition hover:bg-white/90 active:scale-95"
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
          <button onClick={() => void chooseCover()} className="focus-ring ml-auto flex items-center gap-2 rounded-full border border-white/20 px-4 py-2 text-xs font-semibold text-white/80 transition hover:bg-white/10 hover:text-white">
            <ImagePlus size={16} /> Changer la pochette
          </button>
        </div>
      </motion.header>

      <section className="mb-10">
        <div className="mb-3 flex items-center gap-2 px-3 text-xs font-bold uppercase tracking-[0.16em] text-mid"><AudioLines size={16} /> Titres <span className="ml-auto font-normal tracking-normal text-lo">{album.trackCount}</span></div>
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
