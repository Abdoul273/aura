import { useEffect, useState } from "react"
import { AnimatePresence, motion, useMotionValue, useSpring, useTransform } from "framer-motion"
import {
  ChevronDown, Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1,
  Heart, Mic2, AudioWaveform, CircleDot, BarChart3,
} from "lucide-react"
import { usePlayer } from "../../store/playerStore"
import { useShallow } from "zustand/react/shallow"
import { useUI } from "../../store/uiStore"
import { useLibrary } from "../../store/libraryStore"
import { useSettings } from "../../store/settingsStore"
import { getTrackSync } from "../../services"
import CoverArt from "../../components/CoverArt"
import WaveformSeek from "../../components/WaveformSeek"
import LyricsView from "../../components/LyricsView"
import Visualizer from "../../components/Visualizer"
import IconButton from "../../components/IconButton"
import Tooltip from "../../components/Tooltip"
import { meshGradient } from "../../utils/color"

type Panel = "none" | "lyrics" | "viz"

export default function NowPlaying() {
  const open = useUI((s) => s.nowPlayingOpen)
  const setOpen = useUI((s) => s.setNowPlaying)
  const p = usePlayer(useShallow((s) => ({ ...s, positionMs: 0 })))
  const favorites = useLibrary((s) => s.favorites)
  const toggleFav = useLibrary((s) => s.toggleFavorite)
  const [panel, setPanel] = useState<Panel>("none")
  const settings = useSettings((s) => s.settings)
  const updateSettings = useSettings((s) => s.update)
  const vizMode = settings?.visualizerMode ?? "bars"
  const vizColor = settings?.visualizerColor ?? "white"

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
          {/* Fond aux couleurs de la pochette : dégradés purs, sans filter/backdrop-filter
              (un blur animé plein écran sous WebKitGTK finit en écran noir). */}
          <div className="absolute inset-0 bg-[#08080d]" />
          {track && <div className="absolute inset-0 opacity-90" style={{ background: meshGradient(track.colors) }} />}
          <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(0,0,0,.25) 0%, rgba(0,0,0,.45) 55%, rgba(0,0,0,.78) 100%)" }} />
          <div className="pointer-events-none absolute inset-5 rounded-[34px] border border-white/[0.08]" />

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
          <div className="absolute inset-x-0 bottom-[272px] top-[92px] grid grid-cols-1 grid-rows-[minmax(0,1fr)] place-items-center gap-8 px-5 md:px-10 lg:grid-cols-2">
            <div className={panel === "none" ? "grid place-items-center" : "hidden place-items-center lg:grid"} style={{ perspective: 1200 }}>
              {track && (
                <motion.div layoutId="np-cover" style={{ rotateX: rx, rotateY: ry, transformStyle: "preserve-3d" }} className="relative">
                  <div className="pointer-events-none absolute -inset-4 rounded-[36px] border border-white/15 bg-white/[0.04]" />
                  <CoverArt colors={track.colors} seed={track.albumId} size={480} alt={`Pochette de ${track.album}`} priority rounded="rounded-3xl" className="relative w-[min(42vw,460px,calc(100vh-400px))] shadow-[0_36px_90px_-22px_rgba(0,0,0,.85)] ring-1 ring-white/20" />
                  {/* reflection */}
                  <div
                    className="pointer-events-none absolute left-0 top-full mt-3 h-28 w-full overflow-hidden rounded-3xl opacity-20"
                    style={{ transform: "scaleY(-1)", maskImage: "linear-gradient(to bottom, transparent, #000)", WebkitMaskImage: "linear-gradient(to bottom, transparent, #000)" }}
                  ><CoverArt colors={track.colors} seed={track.albumId} size={480} className="w-full" /></div>
                </motion.div>
              )}
            </div>

            <AnimatePresence mode="wait">
              {panel === "lyrics" && (
                <motion.div key="lyrics" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 30 }} className="h-full min-h-0 w-full max-w-2xl self-stretch">
                  <LyricsView large />
                </motion.div>
              )}
              {panel === "viz" && (
                <motion.div key="viz" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 30 }} className="flex h-full w-full max-w-lg flex-col">
                  <div className="min-h-0 flex-1">
                    <Visualizer mode={vizMode} color={vizColor === "artwork" ? (track?.colors.accent ?? "#ffffff") : "#ffffff"} />
                  </div>
                  <div className="mt-3 flex justify-center gap-2">
                    {([["bars", BarChart3], ["circular", CircleDot], ["waves", AudioWaveform]] as const).map(([m, Ico]) => (
                      <Tooltip key={m} label={m === "bars" ? "Barres" : m === "circular" ? "Circulaire" : "Ondes"}>
                        <button onClick={() => void updateSettings({ visualizerMode: m })} className={`rounded-full p-2.5 ${vizMode === m ? "bg-white/25 text-white" : "text-white/60 hover:text-white"}`} aria-label={m} aria-pressed={vizMode === m}>
                          <Ico size={18} />
                        </button>
                      </Tooltip>
                    ))}
                  </div>
                  <div className="mt-2 flex justify-center gap-2 text-xs">
                    <button onClick={() => void updateSettings({ visualizerColor: "white" })} aria-pressed={vizColor === "white"} className={`rounded-full px-3 py-1.5 ${vizColor === "white" ? "bg-white/20 text-white" : "text-white/55 hover:text-white"}`}>Blanc</button>
                    <button onClick={() => void updateSettings({ visualizerColor: "artwork" })} aria-pressed={vizColor === "artwork"} className={`rounded-full px-3 py-1.5 ${vizColor === "artwork" ? "bg-white/20 text-white" : "text-white/55 hover:text-white"}`}>Couleur de la pochette</button>
                  </div>
                </motion.div>
              )}
              {panel === "none" && upNext.length > 0 && (
                <motion.div key="next" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="hidden w-full max-w-sm lg:block">
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
                  <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.24em] text-white/50">À l'écoute</div>
                  <h1 className="truncate text-3xl font-extrabold tracking-[-0.04em] text-white">{track?.title ?? "—"}</h1>
                  <p className="truncate text-lg text-white/70">{track?.artist ?? ""}</p>
                </div>
                {track && (
                  <button onClick={() => toggleFav(track.id)} aria-label="J'aime" className="shrink-0">
                    <Heart size={26} className="text-white" style={isFav ? { fill: "#fff" } : { opacity: 0.7 }} />
                  </button>
                )}
              </div>
              <div className="[--accent:#ffffff]">
                <NowPlayingProgress durationMs={p.durationMs} onSeek={p.seek} seed={track?.id ?? "np"} />
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

function NowPlayingProgress({ durationMs, onSeek, seed }: { durationMs: number; onSeek: (ms: number) => void; seed: string }) {
  const positionMs = usePlayer((s) => s.positionMs)
  return <WaveformSeek positionMs={positionMs} durationMs={durationMs} onSeek={onSeek} seed={seed} bars={120} />
}
