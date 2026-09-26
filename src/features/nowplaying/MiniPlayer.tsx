import { motion } from "framer-motion"
import { Play, Pause, SkipBack, SkipForward, Maximize2, Heart } from "lucide-react"
import { usePlayer } from "../../store/playerStore"
import { useUI } from "../../store/uiStore"
import { useLibrary } from "../../store/libraryStore"
import CoverArt from "../../components/CoverArt"
import WaveformSeek from "../../components/WaveformSeek"
import { coverGradient } from "../../utils/color"
import { formatTime } from "../../utils/format"

// Compact 360×120 "always-on-top" style view. Expandable back to the full app.
export default function MiniPlayer() {
  const p = usePlayer()
  const setMini = useUI((s) => s.setMiniPlayer)
  const favorites = useLibrary((s) => s.favorites)
  const toggleFav = useLibrary((s) => s.toggleFavorite)
  const track = p.currentTrack
  const isFav = track ? favorites.has(track.id) || track.favorite : false

  return (
    <div className="grid h-screen w-screen place-items-center p-4" style={{ background: track ? coverGradient(track.colors) : "var(--bg-0)" }}>
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="glass-panel relative flex w-[360px] flex-col gap-2 overflow-hidden rounded-3xl p-3"
        style={{ height: 132 }}
      >
        <div className="flex items-center gap-3">
          <CoverArt colors={track?.colors ?? { dominant: "#555", accent: "#777", muted: "#333" }} seed={track?.albumId} size={56} rounded="rounded-xl" usePhoto={!!track} icon={!track} className="h-14 w-14 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-hi">{track?.title ?? "Aucune lecture"}</div>
            <div className="truncate text-xs text-mid">{track?.artist ?? ""}</div>
          </div>
          {track && (
            <button onClick={() => toggleFav(track.id)} aria-label="J'aime" className="text-mid">
              <Heart size={16} style={isFav ? { color: "var(--accent)", fill: "var(--accent)" } : undefined} />
            </button>
          )}
          <button onClick={() => setMini(false)} aria-label="Agrandir" className="focus-ring rounded-lg p-1.5 text-mid hover:text-hi">
            <Maximize2 size={16} />
          </button>
        </div>

        <div className="[--accent:var(--accent)] flex items-center gap-2">
          <WaveformSeek positionMs={p.positionMs} durationMs={p.durationMs} onSeek={p.seek} seed={track?.id ?? "mini"} bars={40} />
        </div>

        <div className="flex items-center justify-center gap-4">
          <button onClick={p.previous} aria-label="Précédent" className="text-mid hover:text-hi">
            <SkipBack size={18} fill="currentColor" />
          </button>
          <button onClick={p.toggle} aria-label="Lecture/Pause" className="grid h-9 w-9 place-items-center rounded-full bg-white text-black">
            {p.status === "playing" ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" className="ml-0.5" />}
          </button>
          <button onClick={p.next} aria-label="Suivant" className="text-mid hover:text-hi">
            <SkipForward size={18} fill="currentColor" />
          </button>
          <span className="ml-2 text-xs text-lo tnum">{formatTime(p.positionMs)} / {formatTime(p.durationMs)}</span>
        </div>
      </motion.div>
    </div>
  )
}
