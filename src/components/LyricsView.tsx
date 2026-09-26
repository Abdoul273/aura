import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { Mic2, Music2, RotateCw, LocateFixed } from "lucide-react"
import { usePlayer } from "../store/playerStore"
import { prefetchLyrics, useLyrics } from "../hooks/useLyrics"
import type { LyricsLine } from "../types"
import { cn } from "../utils/cn"

interface Props {
  /** Plein écran « Lecture en cours » (fond sombre, grande typo). */
  large?: boolean
}

// La ligne s'allume un peu avant d'être chantée, comme Spotify.
const LEAD_MS = 150
// Après un défilement manuel, on reprend le suivi automatique au bout de ce délai.
const RESUME_FOLLOW_MS = 3500

export default function LyricsView({ large }: Props) {
  const trackId = usePlayer((s) => s.currentTrackId)
  const nextId = usePlayer((s) => s.queue[s.queueIndex + 1]?.trackId)
  const { lyrics, loading, refresh } = useLyrics(trackId)

  useEffect(() => {
    // Laisse la requête courante passer avant de précharger la suivante.
    const t = window.setTimeout(() => prefetchLyrics(nextId), 1500)
    return () => window.clearTimeout(t)
  }, [nextId])

  if (!trackId) return <Message large={large} icon={<Music2 size={28} />} title="Aucune lecture" />
  if (loading) return <Skeleton large={large} />
  if (!lyrics)
    return (
      <Message large={large} icon={<Mic2 size={28} />} title="Aucune parole trouvée" hint="Ni fichier .lrc, ni tag, ni résultat en ligne pour ce titre.">
        <RefreshButton large={large} onClick={refresh} label="Relancer la recherche" />
      </Message>
    )
  if (lyrics.kind === "instrumental") return <Message large={large} icon={<Music2 size={28} />} title="Morceau instrumental" hint={`Source : ${lyrics.source}`} />
  if (lyrics.kind === "plain") return <PlainLyrics key={trackId} text={lyrics.text} source={lyrics.source} large={large} onRefresh={refresh} />
  return <SyncedLyrics key={trackId} lines={lyrics.lines} source={lyrics.source} large={large} onRefresh={refresh} />
}

// ---------- synchronisées ----------

/** Index de la ligne courante, calculé à 60 i/s en interpolant la position reçue toutes les 200 ms. */
function useActiveLine(lines: LyricsLine[]) {
  const [index, setIndex] = useState(-1)
  useEffect(() => {
    let anchor = { pos: usePlayer.getState().positionMs, at: performance.now() }
    const unsub = usePlayer.subscribe((s, prev) => {
      if (s.positionMs !== prev.positionMs || s.status !== prev.status) anchor = { pos: s.positionMs, at: performance.now() }
    })
    let raf = 0
    const tick = () => {
      const s = usePlayer.getState()
      const pos = s.status === "playing" ? anchor.pos + Math.min(performance.now() - anchor.at, 1000) : s.positionMs
      const t = pos + LEAD_MS
      // Recherche dichotomique de la dernière ligne commencée.
      let lo = 0
      let hi = lines.length - 1
      let found = -1
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (lines[mid].timeMs <= t) {
          found = mid
          lo = mid + 1
        } else hi = mid - 1
      }
      setIndex(found)
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => {
      cancelAnimationFrame(raf)
      unsub()
    }
  }, [lines])
  return index
}

function SyncedLyrics({ lines, source, large, onRefresh }: { lines: LyricsLine[]; source: string; large?: boolean; onRefresh: () => void }) {
  const seek = usePlayer((s) => s.seek)
  const active = useActiveLine(lines)
  const scroller = useRef<HTMLDivElement>(null)
  const refs = useRef<(HTMLElement | null)[]>([])
  const introRef = useRef<HTMLDivElement>(null)
  const [follow, setFollow] = useState(true)
  const resumeTimer = useRef(0)
  const firstScroll = useRef(true)
  const hasIntro = lines[0].timeMs > 2500

  const scrollToActive = (smooth: boolean) => {
    const box = scroller.current
    const el = active >= 0 ? refs.current[active] : introRef.current
    if (!box || !el) return
    const top = el.offsetTop - box.clientHeight * 0.36 + el.offsetHeight / 2
    box.scrollTo({ top: Math.max(0, top), behavior: smooth ? "smooth" : "auto" })
  }

  useLayoutEffect(() => {
    if (!follow) return
    scrollToActive(!firstScroll.current)
    firstScroll.current = false
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, follow])

  // Suivi recalé si la zone change de taille (ouverture du tiroir, redimensionnement).
  useEffect(() => {
    const box = scroller.current
    if (!box) return
    const ro = new ResizeObserver(() => follow && scrollToActive(false))
    ro.observe(box)
    return () => ro.disconnect()
  })

  useEffect(() => () => window.clearTimeout(resumeTimer.current), [])

  const userScrolled = () => {
    setFollow(false)
    window.clearTimeout(resumeTimer.current)
    resumeTimer.current = window.setTimeout(() => setFollow(true), RESUME_FOLLOW_MS)
  }
  const resync = () => {
    window.clearTimeout(resumeTimer.current)
    setFollow(true)
  }

  const colorFor = (state: "active" | "past" | "next") =>
    large
      ? state === "active"
        ? "#ffffff"
        : state === "past"
          ? "rgba(255,255,255,.58)"
          : "rgba(255,255,255,.3)"
      : state === "active"
        ? "var(--text-hi)"
        : state === "past"
          ? "color-mix(in srgb, var(--text-hi) 55%, transparent)"
          : "color-mix(in srgb, var(--text-hi) 32%, transparent)"

  return (
    <div className="relative h-full">
      <div
        ref={scroller}
        onWheel={userScrolled}
        onTouchMove={userScrolled}
        onKeyDown={(e) => ["ArrowUp", "ArrowDown", "PageUp", "PageDown"].includes(e.key) && userScrolled()}
        className={cn("lyrics-scroll relative h-full overflow-y-auto", large ? "px-2" : "px-5")}
      >
        <div className={cn("flex flex-col", large ? "gap-6 pb-[45vh] pt-[22vh]" : "gap-4 pb-[60%] pt-[30%]")}>
          {hasIntro && (
            <div ref={introRef}>
              <Dots on={active === -1} large={large} />
            </div>
          )}
          {lines.map((line, i) => {
            const state = i === active ? "active" : i < active ? "past" : "next"
            if (!line.text)
              return (
                <div key={i} ref={(el) => void (refs.current[i] = el)}>
                  <Dots on={state === "active"} large={large} />
                </div>
              )
            return (
              <button
                key={i}
                ref={(el) => void (refs.current[i] = el)}
                onClick={() => {
                  seek(line.timeMs)
                  resync()
                }}
                className={cn(
                  "block w-full rounded-lg text-left font-extrabold tracking-tight antialiased transition-[color,transform] duration-300 ease-out",
                  large ? "text-[clamp(1.6rem,2.5vw,2.35rem)] leading-[1.18]" : "text-[1.3rem] leading-[1.25]",
                  "text-[color:var(--c)] hover:text-[color:var(--hover)]",
                )}
                style={{ ["--c" as string]: colorFor(state), ["--hover" as string]: state === "active" ? colorFor(state) : large ? "rgba(255,255,255,.85)" : "var(--text-hi)" }}
              >
                {line.text}
              </button>
            )
          })}
          <Footer source={source} large={large} onRefresh={onRefresh} />
        </div>
      </div>

      {!follow && (
        <button
          onClick={resync}
          className={cn(
            "absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold shadow-lg transition-transform hover:scale-105",
            large ? "bg-white text-black" : "bg-[var(--text-hi)] text-[var(--bg-0)]",
          )}
        >
          <LocateFixed size={15} /> Synchroniser
        </button>
      )}
    </div>
  )
}

function Dots({ on, large }: { on: boolean; large?: boolean }) {
  const size = large ? 12 : 9
  return (
    <div className={cn("flex items-center gap-2 transition-opacity duration-300", large ? "h-10" : "h-7")} style={{ opacity: on ? 1 : 0.25 }}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={cn("rounded-full", on && "lyric-dot")}
          style={{ width: size, height: size, background: large ? "#fff" : "var(--text-hi)", animationDelay: `${i * 0.22}s` }}
        />
      ))}
    </div>
  )
}

// ---------- texte brut / états ----------

function PlainLyrics({ text, source, large, onRefresh }: { text: string; source: string; large?: boolean; onRefresh: () => void }) {
  return (
    <div className={cn("lyrics-scroll h-full overflow-y-auto", large ? "px-2" : "px-5")}>
      <div className={cn(large ? "pb-[30vh] pt-[12vh]" : "pb-20 pt-10")}>
        <div className={cn("mb-5 inline-flex rounded-full px-3 py-1 text-xs font-semibold", large ? "bg-white/15 text-white/80" : "bg-[color-mix(in_srgb,var(--text-hi)_10%,transparent)] text-mid")}>
          Paroles non synchronisées
        </div>
        <div
          className={cn("whitespace-pre-line font-extrabold tracking-tight antialiased", large ? "text-[clamp(1.4rem,2.1vw,2rem)] leading-[1.35] text-white/85" : "text-lg leading-snug text-hi")}
        >
          {text}
        </div>
        <Footer source={source} large={large} onRefresh={onRefresh} />
      </div>
    </div>
  )
}

function Footer({ source, large, onRefresh }: { source: string; large?: boolean; onRefresh: () => void }) {
  return (
    <div className={cn("mt-10 flex items-center gap-3 text-xs", large ? "text-white/50" : "text-lo")}>
      <span>Paroles fournies par {source}</span>
      <button onClick={onRefresh} className={cn("flex items-center gap-1 rounded-full px-2 py-1", large ? "hover:bg-white/10 hover:text-white" : "hover:text-hi")} aria-label="Rechercher à nouveau">
        <RotateCw size={12} /> Actualiser
      </button>
    </div>
  )
}

function RefreshButton({ onClick, label, large }: { onClick: () => void; label: string; large?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn("mt-4 flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold", large ? "bg-white/15 text-white hover:bg-white/25" : "bg-[color-mix(in_srgb,var(--text-hi)_10%,transparent)] text-hi hover:bg-[color-mix(in_srgb,var(--text-hi)_16%,transparent)]")}
    >
      <RotateCw size={14} /> {label}
    </button>
  )
}

function Message({ icon, title, hint, large, children }: { icon: React.ReactNode; title: string; hint?: string; large?: boolean; children?: React.ReactNode }) {
  return (
    <div className={cn("flex h-full flex-col items-center justify-center p-8 text-center", large ? "text-white" : "text-hi")}>
      <div className={cn("mb-3 grid h-14 w-14 place-items-center rounded-full", large ? "bg-white/12" : "bg-[color-mix(in_srgb,var(--text-hi)_8%,transparent)]")}>{icon}</div>
      <div className={cn("font-bold", large ? "text-xl" : "text-base")}>{title}</div>
      {hint && <div className={cn("mt-1 max-w-xs text-sm", large ? "text-white/60" : "text-lo")}>{hint}</div>}
      {children}
    </div>
  )
}

function Skeleton({ large }: { large?: boolean }) {
  const widths = [72, 88, 54, 80, 64, 90, 46]
  return (
    <div className={cn("flex h-full flex-col justify-center", large ? "gap-6 px-2" : "gap-4 px-5")}>
      {widths.map((w, i) => (
        <div
          key={i}
          className={cn("animate-pulse rounded-lg", large ? "h-8 bg-white/12" : "h-5 bg-[color-mix(in_srgb,var(--text-hi)_9%,transparent)]")}
          style={{ width: `${w}%`, animationDelay: `${i * 90}ms` }}
        />
      ))}
    </div>
  )
}
