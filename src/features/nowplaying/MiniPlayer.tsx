import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Play, Pause, SkipBack, SkipForward, Maximize2, Heart, Shuffle, Repeat, Repeat1 } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { usePlayer } from "../../store/playerStore"
import { useUI } from "../../store/uiStore"
import { useLibrary } from "../../store/libraryStore"
import CoverArt from "../../components/CoverArt"
import Visualizer from "../../components/Visualizer"
import { meshGradient } from "../../utils/color"
import { formatTime } from "../../utils/format"
import { cn } from "../../utils/cn"

const FALLBACK = { dominant: "#2a2a3a", accent: "#6d5dfc", muted: "#15151f" }

// Mini-lecteur flottant : occupe toute la fenêtre et s'adapte à sa taille
// (bandeau compact en dessous de 260 px de haut, carte verticale au-dessus).
export default function MiniPlayer() {
  const p = usePlayer(useShallow((s) => ({ ...s, positionMs: 0 })))
  const setMini = useUI((s) => s.setMiniPlayer)
  const favorites = useLibrary((s) => s.favorites)
  const toggleFav = useLibrary((s) => s.toggleFavorite)
  const track = p.currentTrack
  const colors = track?.colors ?? FALLBACK
  const isFav = track ? favorites.has(track.id) || track.favorite : false
  const playing = p.status === "playing"
  const RepeatIcon = p.repeat === "one" ? Repeat1 : Repeat
  const tall = useTall()

  // Raccourcis : espace = lecture/pause, flèches = piste, Échap = agrandir.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      if (e.code === "Space") {
        e.preventDefault()
        p.toggle()
      } else if (e.key === "ArrowRight" && e.ctrlKey) p.next()
      else if (e.key === "ArrowLeft" && e.ctrlKey) p.previous()
      else if (e.key === "Escape") setMini(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [p, setMini])

  const cover = (
    <motion.div
      key={track?.albumId ?? "none"}
      initial={{ scale: 0.85, opacity: 0, rotate: -4 }}
      animate={{ scale: playing ? 1 : 0.93, opacity: 1, rotate: 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 22 }}
      className="relative aspect-square h-full max-h-full shrink-0"
    >
      {/* Halo aux couleurs de la pochette, qui respire pendant la lecture. */}
      <div
        className={cn("absolute -inset-3 rounded-[28px] opacity-60", playing && "mini-breathe")}
        style={{ background: `radial-gradient(closest-side, ${colors.accent}, transparent)` }}
      />
      <CoverArt
        colors={colors}
        seed={track?.albumId}
        size={tall ? 320 : 128}
        rounded={tall ? "rounded-3xl" : "rounded-2xl"}
        usePhoto={!!track}
        icon={!track}
        className="relative h-full w-full shadow-[0_12px_40px_-8px_rgba(0,0,0,.7)] ring-1 ring-white/10"
      />
    </motion.div>
  )

  const info = (
    <div className={cn("min-w-0", tall && "text-center")}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={track?.id ?? "none"}
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -10, opacity: 0 }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        >
          <Marquee className={cn("font-bold tracking-tight text-white", tall ? "text-xl" : "text-[15px] leading-tight")}>{track?.title ?? "Aucune lecture"}</Marquee>
          <div className={cn("truncate text-white/65", tall ? "mt-0.5 text-sm" : "text-xs")}>{track?.artist ?? "Choisissez un morceau"}</div>
        </motion.div>
      </AnimatePresence>
    </div>
  )

  const iconBtn = "grid place-items-center rounded-full text-white/75 transition hover:bg-white/12 hover:text-white active:scale-90"

  const controls = (
    <div className={cn("flex items-center", tall ? "justify-center gap-5" : "gap-1.5")}>
      {tall && (
        <button onClick={p.toggleShuffle} aria-label="Aléatoire" className={cn(iconBtn, "h-9 w-9", p.shuffle && "text-white")} style={p.shuffle ? { color: colors.accent } : undefined}>
          <Shuffle size={17} />
        </button>
      )}
      <button onClick={p.previous} aria-label="Précédent" className={cn(iconBtn, tall ? "h-11 w-11" : "h-8 w-8")}>
        <SkipBack size={tall ? 22 : 16} fill="currentColor" />
      </button>
      <motion.button
        whileHover={{ scale: 1.06 }}
        whileTap={{ scale: 0.9 }}
        onClick={p.toggle}
        aria-label="Lecture/Pause"
        className={cn("relative grid place-items-center rounded-full bg-white text-black", tall ? "h-14 w-14" : "h-10 w-10")}
        style={{ boxShadow: `0 6px 24px -4px ${colors.accent}` }}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span key={playing ? "pause" : "play"} initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0 }} transition={{ duration: 0.15 }}>
            {playing ? <Pause size={tall ? 24 : 17} fill="currentColor" /> : <Play size={tall ? 24 : 17} fill="currentColor" className="ml-0.5" />}
          </motion.span>
        </AnimatePresence>
      </motion.button>
      <button onClick={p.next} aria-label="Suivant" className={cn(iconBtn, tall ? "h-11 w-11" : "h-8 w-8")}>
        <SkipForward size={tall ? 22 : 16} fill="currentColor" />
      </button>
      {tall && (
        <button onClick={p.cycleRepeat} aria-label="Répéter" className={cn(iconBtn, "h-9 w-9")} style={p.repeat !== "off" ? { color: colors.accent } : undefined}>
          <RepeatIcon size={17} />
        </button>
      )}
    </div>
  )

  const actions = (
    <div className="flex items-center gap-0.5 opacity-0 transition-opacity duration-300 group-hover:opacity-100 focus-within:opacity-100">
      {track && (
        <motion.button whileTap={{ scale: 0.8 }} onClick={() => toggleFav(track.id)} aria-label="J'aime" className={cn(iconBtn, "h-8 w-8")}>
          <Heart size={16} style={isFav ? { color: "#ff4d6d", fill: "#ff4d6d" } : undefined} />
        </motion.button>
      )}
      <button onClick={() => setMini(false)} aria-label="Agrandir" className={cn(iconBtn, "h-8 w-8")}>
        <Maximize2 size={15} />
      </button>
    </div>
  )

  return (
    <div data-tauri-drag-region className="group relative h-screen w-screen select-none overflow-hidden bg-[#0a0a10]">
      {/* Fond : dégradé maillé de la pochette + visualiseur en filigrane. */}
      <div className="pointer-events-none absolute inset-0 opacity-80 transition-[background] duration-700" style={{ background: meshGradient(colors) }} />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,.15),rgba(0,0,0,.55))]" />
      <div className={cn("pointer-events-none absolute inset-x-0 bottom-0 opacity-25 transition-opacity duration-500", tall ? "h-1/3" : "h-2/3", !playing && "opacity-0")}>
        <Visualizer mode="bars" color="#ffffff" />
      </div>
      <div className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-white/10" />

      {tall ? (
        <div data-tauri-drag-region className="relative flex h-full flex-col items-center gap-4 px-6 pb-5 pt-9">
          <div className="absolute right-3 top-3">{actions}</div>
          <div data-tauri-drag-region className="grid min-h-0 w-full flex-1 place-items-center">
            {cover}
          </div>
          <div className="w-full">{info}</div>
          <Progress accent={colors.accent} />
          {controls}
        </div>
      ) : (
        <div data-tauri-drag-region className="relative flex h-full items-center gap-3.5 p-3">
          {cover}
          <div data-tauri-drag-region className="flex h-full min-w-0 flex-1 flex-col justify-between py-0.5">
            <div data-tauri-drag-region className="flex items-start gap-2">
              <div className="min-w-0 flex-1">{info}</div>
              {actions}
            </div>
            <Progress accent={colors.accent} compact />
            {controls}
          </div>
        </div>
      )}
    </div>
  )
}

function useTall() {
  const [tall, setTall] = useState(() => window.innerHeight >= 260 && window.innerWidth >= 220)
  useEffect(() => {
    const onResize = () => setTall(window.innerHeight >= 260 && window.innerWidth >= 220)
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])
  return tall
}

/** Barre de progression fine, qui s'épaissit au survol, avec bouton de glissement. */
function Progress({ accent, compact }: { accent: string; compact?: boolean }) {
  const positionMs = usePlayer((s) => s.positionMs)
  const durationMs = usePlayer((s) => s.durationMs)
  const seek = usePlayer((s) => s.seek)
  const ref = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<number | null>(null)

  const ratio = (x: number) => {
    const r = ref.current!.getBoundingClientRect()
    return Math.max(0, Math.min(1, (x - r.left) / r.width))
  }
  const shown = drag ?? (durationMs > 0 ? positionMs / durationMs : 0)

  const start = (e: React.PointerEvent) => {
    if (durationMs <= 0) return
    e.stopPropagation()
    setDrag(ratio(e.clientX))
    const move = (ev: PointerEvent) => setDrag(ratio(ev.clientX))
    const up = (ev: PointerEvent) => {
      seek(ratio(ev.clientX) * durationMs)
      setDrag(null)
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }

  const time = (ms: number) => <span className="w-9 shrink-0 text-[10.5px] font-medium text-white/60 tnum">{formatTime(ms)}</span>

  return (
    <div className="flex w-full items-center gap-2">
      {!compact && time(drag !== null ? drag * durationMs : positionMs)}
      <div ref={ref} onPointerDown={start} role="slider" aria-label="Progression" aria-valuenow={Math.round(positionMs / 1000)} aria-valuemax={Math.round(durationMs / 1000)} className="group/bar relative flex h-4 flex-1 cursor-pointer items-center">
        <div className={cn("relative w-full overflow-hidden rounded-full bg-white/18 transition-[height] duration-200", drag !== null ? "h-[6px]" : "h-[4px] group-hover/bar:h-[6px]")}>
          <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${shown * 100}%`, background: `linear-gradient(90deg, ${accent}, #fff)` }} />
        </div>
        <div
          className={cn("absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-md transition-transform duration-150", drag !== null ? "scale-100" : "scale-0 group-hover/bar:scale-100")}
          style={{ left: `${shown * 100}%` }}
        />
      </div>
      {compact ? (
        <span className="shrink-0 text-[10.5px] font-medium text-white/60 tnum">
          {formatTime(drag !== null ? drag * durationMs : positionMs)}
          <span className="text-white/35"> / {formatTime(durationMs)}</span>
        </span>
      ) : (
        time(durationMs)
      )}
    </div>
  )
}

/** Titre qui défile en boucle uniquement s'il déborde. */
function Marquee({ children, className }: { children: string; className?: string }) {
  const box = useRef<HTMLDivElement>(null)
  const text = useRef<HTMLSpanElement>(null)
  const [overflow, setOverflow] = useState(0)
  useEffect(() => {
    const measure = () => setOverflow(Math.max(0, (text.current?.scrollWidth ?? 0) - (box.current?.clientWidth ?? 0)))
    measure()
    const ro = new ResizeObserver(measure)
    if (box.current) ro.observe(box.current)
    return () => ro.disconnect()
  }, [children])
  return (
    <div
      ref={box}
      className={cn("overflow-hidden whitespace-nowrap", className)}
      style={overflow ? { maskImage: "linear-gradient(90deg, transparent, #000 6%, #000 90%, transparent)", WebkitMaskImage: "linear-gradient(90deg, transparent, #000 6%, #000 90%, transparent)" } : undefined}
    >
      <span
        ref={text}
        className={cn("inline-block", overflow > 0 && "mini-marquee")}
        style={overflow ? { ["--dx" as string]: `-${overflow + 24}px`, animationDuration: `${Math.max(6, (overflow + 24) / 22)}s` } : undefined}
      >
        {children}
      </span>
    </div>
  )
}
