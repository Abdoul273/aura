import { Heart, Play, Pause } from "lucide-react"
import type { Track } from "../types"
import CoverArt from "./CoverArt"
import EqualizerBars from "./EqualizerBars"
import { usePlayer } from "../store/playerStore"
import { useLibrary } from "../store/libraryStore"
import { useOpenMenu } from "./TrackContextMenu"
import { formatTime } from "../utils/format"
import { cn } from "../utils/cn"

interface Props {
  track: Track
  index?: number
  showCover?: boolean
  showAlbum?: boolean
  onPlay: () => void
  draggable?: boolean
  onDragStart?: (e: React.DragEvent) => void
}

export default function TrackRow({ track, index, showCover = true, showAlbum, onPlay, draggable, onDragStart }: Props) {
  const currentId = usePlayer((s) => s.currentTrackId)
  const status = usePlayer((s) => s.status)
  const favorites = useLibrary((s) => s.favorites)
  const toggleFav = useLibrary((s) => s.toggleFavorite)
  const openMenu = useOpenMenu()
  const isCurrent = currentId === track.id
  const isFav = favorites.has(track.id) || track.favorite
  const playing = isCurrent && status === "playing"

  return (
    <div
      onDoubleClick={onPlay}
      onContextMenu={(e) => openMenu(e, "track", track.id)}
      draggable={draggable}
      onDragStart={onDragStart}
      className={cn(
        "group flex items-center gap-3 rounded-xl px-3 py-2 transition-colors",
        isCurrent ? "bg-white/8" : "hover:bg-white/6",
      )}
    >
      <div className="grid w-6 shrink-0 place-items-center text-sm text-lo tnum">
        {playing ? (
          <EqualizerBars playing size={14} />
        ) : (
          <>
            <span className="group-hover:hidden">{isCurrent ? <Pause size={14} className="text-hi" /> : index ?? ""}</span>
            <button onClick={onPlay} aria-label="Lire" className="hidden text-hi group-hover:block">
              <Play size={14} fill="currentColor" />
            </button>
          </>
        )}
      </div>
      {showCover && <CoverArt colors={track.colors} seed={track.albumId} size={40} rounded="rounded-lg" className="h-10 w-10 shrink-0" />}
      <div className="min-w-0 flex-1">
        <div className={cn("truncate text-sm font-medium", isCurrent ? "text-hi" : "text-hi")} style={isCurrent ? { color: "var(--accent)" } : undefined}>
          {track.title}
        </div>
        <div className="truncate text-xs text-mid">{track.artist}</div>
      </div>
      {showAlbum && <div className="hidden min-w-0 flex-1 truncate text-sm text-mid md:block">{track.album}</div>}
      <button
        onClick={() => toggleFav(track.id)}
        aria-label={isFav ? "Retirer des favoris" : "Ajouter aux favoris"}
        className={cn("shrink-0 transition-opacity", isFav ? "opacity-100" : "opacity-0 group-hover:opacity-100")}
      >
        <Heart size={15} className={isFav ? "" : "text-mid"} style={isFav ? { color: "var(--accent)", fill: "var(--accent)" } : undefined} />
      </button>
      <span className="w-12 shrink-0 text-right text-sm text-lo tnum">{formatTime(track.durationMs)}</span>
    </div>
  )
}
