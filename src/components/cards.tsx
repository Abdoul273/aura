import { motion } from "framer-motion"
import { Play } from "lucide-react"
import type { Album, Artist, Playlist, RadioStation } from "../types"
import CoverArt from "./CoverArt"
import { useUI } from "../store/uiStore"
import { useOpenMenu } from "./TrackContextMenu"
import { backend } from "../services"
import { usePlaybackActions } from "../hooks/usePlaybackActions"
import { formatCount } from "../utils/format"
import { cn } from "../utils/cn"

function PlayFab({ onClick }: { onClick: (e: React.MouseEvent) => void }) {
  return (
    <motion.button
      initial={{ opacity: 0, y: 8 }}
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
      aria-label="Lire"
      className="absolute bottom-3 right-3 grid h-11 w-11 place-items-center rounded-full text-black opacity-0 shadow-xl transition-opacity duration-200 group-hover:opacity-100"
      style={{ background: "var(--accent)", color: "#fff" }}
    >
      <Play size={18} fill="currentColor" />
    </motion.button>
  )
}

export function AlbumCard({ album, width }: { album: Album; width?: number }) {
  const navigate = useUI((s) => s.navigate)
  const openMenu = useOpenMenu()
  const actions = usePlaybackActions()
  const play = async (e: React.MouseEvent) => {
    e.stopPropagation()
    const res = await backend.library.getAlbum(album.id)
    if (res) actions.playContext(res.tracks.map((t) => t.id), 0)
  }
  return (
    <motion.div
      whileHover={{ y: -4 }}
      style={{ width }}
      onClick={() => navigate({ name: "album", id: album.id })}
      onContextMenu={(e) => openMenu(e, "album", album.id)}
      className="group cursor-pointer"
    >
      <div className="relative mb-3">
        <CoverArt colors={album.colors} seed={album.id} size={220} className="shadow-lg transition-shadow group-hover:shadow-2xl" />
        <PlayFab onClick={play} />
      </div>
      <div className="truncate text-sm font-semibold text-hi">{album.title}</div>
      <div className="truncate text-xs text-mid">{album.artist} · {album.year}</div>
    </motion.div>
  )
}

export function ArtistCard({ artist, width }: { artist: Artist; width?: number }) {
  const navigate = useUI((s) => s.navigate)
  const openMenu = useOpenMenu()
  return (
    <motion.div
      whileHover={{ y: -4 }}
      style={{ width }}
      onClick={() => navigate({ name: "artist", id: artist.id })}
      onContextMenu={(e) => openMenu(e, "artist", artist.id)}
      className="group cursor-pointer text-center"
    >
      <CoverArt colors={artist.colors} seed={artist.id} size={200} rounded="rounded-full" className="mb-3 shadow-lg" />
      <div className="truncate text-sm font-semibold text-hi">{artist.name}</div>
      <div className="truncate text-xs text-mid">{formatCount(artist.monthlyListeners)} écoutes</div>
    </motion.div>
  )
}

export function PlaylistCard({ playlist, width }: { playlist: Playlist; width?: number }) {
  const navigate = useUI((s) => s.navigate)
  const openMenu = useOpenMenu()
  return (
    <motion.div
      whileHover={{ y: -4 }}
      style={{ width }}
      onClick={() => navigate({ name: "playlist", id: playlist.id })}
      onContextMenu={(e) => openMenu(e, "playlist", playlist.id)}
      className="group cursor-pointer"
    >
      <CoverArt colors={playlist.colors} seed={playlist.id} size={220} usePhoto={false} icon className="mb-3 shadow-lg" />
      <div className="truncate text-sm font-semibold text-hi">{playlist.name}</div>
      <div className="truncate text-xs text-mid">{playlist.trackIds.length} titres</div>
    </motion.div>
  )
}

export function RadioCard({ station, width, onPlay }: { station: RadioStation; width?: number; onPlay: () => void }) {
  return (
    <motion.div whileHover={{ y: -4 }} style={{ width }} onClick={onPlay} className="group cursor-pointer">
      <div className="relative mb-3">
        <CoverArt colors={station.colors} seed={station.id} usePhoto={false} icon size={220} className="shadow-lg" />
        {station.live && (
          <span className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-black/50 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-white backdrop-blur">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" /> Live
          </span>
        )}
        <PlayFab onClick={(e) => { e.stopPropagation(); onPlay() }} />
      </div>
      <div className="truncate text-sm font-semibold text-hi">{station.name}</div>
      <div className="truncate text-xs text-mid">{station.genre}</div>
    </motion.div>
  )
}

export function Carousel({ title, children, onSeeAll }: { title: string; children: React.ReactNode; onSeeAll?: () => void }) {
  return (
    <section className="mb-8">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-xl font-bold tracking-tight text-hi">{title}</h2>
        {onSeeAll && (
          <button onClick={onSeeAll} className="text-xs font-semibold text-mid hover:text-hi">
            Tout voir
          </button>
        )}
      </div>
      <div className={cn("flex gap-5 overflow-x-auto pb-2")}>{children}</div>
    </section>
  )
}
