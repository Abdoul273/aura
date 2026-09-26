import { useEffect, useState } from "react"
import { AnimatePresence, motion, useMotionValue, useSpring, useTransform } from "framer-motion"
import {
  ChevronDown, Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1,
  Heart, Mic2, AudioWaveform, CircleDot, BarChart3,
} from "lucide-react"
import { usePlayer } from "../../store/playerStore"
import { useUI } from "../../store/uiStore"
import { useLibrary } from "../../store/libraryStore"
import { getTrackSync } from "../../services"
import CoverArt from "../../components/CoverArt"
import WaveformSeek from "../../components/WaveformSeek"
import LyricsView from "../../components/LyricsView"
import Visualizer, { type VizMode } from "../../components/Visualizer"
import IconButton from "../../components/IconButton"
import Tooltip from "../../components/Tooltip"
import { coverGradient } from "../../utils/color"

type Panel = "none" | "lyrics" | "viz"

export default function NowPlaying() {
  const open = useUI((s) => s.nowPlayingOpen)
  const setOpen = useUI((s) => s.setNowPlaying)
  const p = usePlayer()
  const favorites = useLibrary((s) => s.favorites)
  const toggleFav = useLibrary((s) => s.toggleFavorite)
  const [panel, setPanel] = useState<Panel>("none")
  const [vizMode, setVizMode] = useState<VizMode>("bars")

  // 3D tilt
  const mx = useMotionValue(0)
  const my = useMotionValue(0)
  const rx = useSpring(useTransform(my, [-0.5, 0.5], [8, -8]), { stiffness: 150, damping: 20 })
  const ry = useSpring(useTransform(mx, [-0.5, 0.5], [-8, 8]), { stiffness: 150, damping: 20 })

  useEffect(() => {
    if (!open) setPanel("none")
  }, [open])

  const track = p.currentTrack
  const isFav = track ? favorites.has(track.id) || track.favorite : false
  const RepeatIcon = p.repeat === "one" ? Repeat1 : Repeat
  const upNext = p.queue.slice(p.queueIndex + 1, p.queueIndex + 4)

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[110] overflow-hidden"
          onMouseMove={(e) => {
            mx.set(e.clientX / window.innerWidth - 0.5)
            my.set(e.clientY / window.innerHeight - 0.5)
          }}
        >
          {/* artwork-colored background */}
          <div className="absolute inset-0" style={{ background: track ? coverGradient(track.colors) : "var(--bg-0)" }} />
          <motion.div
            className="aurora absolute -inset-1/4"
            style={{ background: track ? `radial-gradient(50% 50% at 30% 30%, ${track.colors.accent}, transparent 70%), radial-gradient(50% 50% at 70% 70%, ${track.colors.dominant}, transparent 70%)` : undefined, filter: "blur(80px)", opacity: 0.9 }}
          />
          <div className="absolute inset-0 bg-black/40 backdrop-blur-2xl" />

          {/* header */}
          <div className="relative flex items-center justify-between p-6">
            <IconButton label="Réduire" onClick={() => setOpen(false)} size={44}>
              <ChevronDown size={24} className="text-white" />
            </IconButton>
            <div className="text-center text-xs font-semibold uppercase tracking-[0.2em] text-white/70">Lecture en cours</div>
            <div className="flex gap-1">
              <IconButton label="Paroles" active={panel === "lyrics"} onClick={() => setPanel((v) => (v === "lyrics" ? "none" : "lyrics"))} size={44}>
                <Mic2 size={20} className="text-white" />
              </IconButton>
              <IconButton label="Visualiseur" active={panel === "viz"} onClick={() => setPanel((v) => (v === "viz" ? "none" : "viz"))} size={44}>
                <BarChart3 size={20} className="text-white" />
              </IconButton>
            </div>
          </div>

          {/* body */}
          <div className="relative grid h-[calc(100%-180px)] grid-cols-1 place-items-center gap-8 px-10 lg:grid-cols-2">
            <div className="grid place-items-center" style={{ perspective: 1200 }}>
              {track && (
                <motion.div layoutId="np-cover" style={{ rotateX: rx, rotateY: ry, transformStyle: "preserve-3d" }} className="relative">
                  <CoverArt colors={track.colors} seed={track.albumId} size={420} rounded="rounded-3xl" className="w-[min(42vw,420px)] shadow-2xl" />
                  {/* reflection */}
                  <div
                    className="absolute left-0 top-full mt-2 w-full opacity-30"
                    style={{ height: 120, background: coverGradient(track.colors), transform: "scaleY(-1)", maskImage: "linear-gradient(to bottom, rgba(0,0,0,.5), transparent)", WebkitMaskImage: "linear-gradient(to bottom, rgba(0,0,0,.5), transparent)", borderRadius: 24 }}
                  />
                </motion.div>
              )}
            </div>

            <AnimatePresence mode="wait">
              {panel === "lyrics" && (
                <motion.div key="lyrics" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 30 }} className="h-full max-h-[60vh] w-full max-w-lg overflow-y-auto">
                  <LyricsView large />
                </motion.div>
              )}
              {panel === "viz" && (
                <motion.div key="viz" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 30 }} className="flex h-full w-full max-w-lg flex-col">
                  <div className="min-h-0 flex-1">
                    <Visualizer mode={vizMode} color="#ffffff" />
                  </div>
                  <div className="mt-3 flex justify-center gap-2">
                    {([["bars", BarChart3], ["circular", CircleDot], ["waves", AudioWaveform]] as const).map(([m, Ico]) => (
                      <Tooltip key={m} label={m === "bars" ? "Barres" : m === "circular" ? "Circulaire" : "Ondes"}>
                        <button onClick={() => setVizMode(m)} className={`rounded-full p-2.5 ${vizMode === m ? "bg-white/25 text-white" : "text-white/60 hover:text-white"}`} aria-label={m}>
                          <Ico size={18} />
                        </button>
                      </Tooltip>
                    ))}
                  </div>
                </motion.div>
              )}
              {panel === "none" && upNext.length > 0 && (
                <motion.div key="next" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="w-full max-w-sm">
                  <div className="mb-3 text-xs font-semibold uppercase tracking-widest text-white/60">À suivre</div>
                  <div className="space-y-2">
                    {upNext.map((q) => {
                      const t = getTrackSync(q.trackId)
                      if (!t) return null
                      return (
                        <div key={q.uid} className="glass flex items-center gap-3 rounded-2xl p-2.5">
                          <CoverArt colors={t.colors} seed={t.albumId} size={44} rounded="rounded-lg" className="h-11 w-11" />
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-white">{t.title}</div>
                            <div className="truncate text-xs text-white/60">{t.artist}</div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* controls */}
          <div className="absolute bottom-0 left-0 right-0 p-8">
            <div className="mx-auto max-w-3xl">
              <div className="mb-4 flex items-end justify-between gap-4">
                <div className="min-w-0">
                  <h1 className="truncate text-3xl font-bold tracking-tight text-white">{track?.title ?? "—"}</h1>
                  <p className="truncate text-lg text-white/70">{track?.artist ?? ""}</p>
                </div>
                {track && (
                  <button onClick={() => toggleFav(track.id)} aria-label="J'aime" className="shrink-0">
                    <Heart size={26} className="text-white" style={isFav ? { fill: "#fff" } : { opacity: 0.7 }} />
                  </button>
                )}
              </div>
              <div className="[--accent:#ffffff]">
                <WaveformSeek positionMs={p.positionMs} durationMs={p.durationMs} onSeek={p.seek} seed={track?.id ?? "np"} bars={120} />
              </div>
              <div className="mt-5 flex items-center justify-center gap-6">
                <IconButton label="Aléatoire" active={p.shuffle} onClick={p.toggleShuffle} size={48}>
                  <Shuffle size={22} className="text-white" />
                </IconButton>
                <IconButton label="Précédent" onClick={p.previous} size={52}>
                  <SkipBack size={28} className="text-white" fill="currentColor" />
                </IconButton>
                <motion.button whileTap={{ scale: 0.92 }} onClick={p.toggle} aria-label="Lecture/Pause" className="grid h-16 w-16 place-items-center rounded-full bg-white text-black shadow-2xl">
                  {p.status === "playing" ? <Pause size={28} fill="currentColor" /> : <Play size={28} fill="currentColor" className="ml-1" />}
                </motion.button>
                <IconButton label="Suivant" onClick={p.next} size={52}>
                  <SkipForward size={28} className="text-white" fill="currentColor" />
                </IconButton>
                <IconButton label="Répéter" active={p.repeat !== "off"} onClick={p.cycleRepeat} size={48}>
                  <RepeatIcon size={22} className="text-white" />
                </IconButton>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
