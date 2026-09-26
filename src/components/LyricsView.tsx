import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { Mic2, Music2, RotateCw, LocateFixed, Search, X, Check } from "lucide-react"
import { backend } from "../services"
import { usePlayer } from "../store/playerStore"
import { prefetchLyrics, useLyrics } from "../hooks/useLyrics"
import type { Lyrics, LyricsLine, LyricsResult } from "../types"
import { cn } from "../utils/cn"

interface Props {
  /** Plein écran « Lecture en cours » (fond sombre, grande typo). */
  large?: boolean
}

// La ligne s'allume un peu avant d'être chantée, comme Spotify.
const LEAD_MS = 0
// Après un défilement manuel, on reprend le suivi automatique au bout de ce délai.
const RESUME_FOLLOW_MS = 3500

export default function LyricsView({ large }: Props) {
  const trackId = usePlayer((s) => s.currentTrackId)
  const nextId = usePlayer((s) => s.queue[s.queueIndex + 1]?.trackId)
  const { lyrics, loading, refresh, replace } = useLyrics(trackId)
  const [searchFor, setSearchFor] = useState<string | null>(null)

  useEffect(() => {
    // Laisse la requête courante passer avant de précharger la suivante.
    const t = window.setTimeout(() => prefetchLyrics(nextId), 1500)
    return () => window.clearTimeout(t)
  }, [nextId])

  // Le panneau de recherche se referme au changement de morceau.
  useEffect(() => setSearchFor(null), [trackId])

  if (!trackId) return <Message large={large} icon={<Music2 size={28} />} title="Aucune lecture" />
  if (searchFor !== null)
    return (
      <ManualSearch
        key={trackId}
        trackId={trackId}
        large={large}
        onClose={() => setSearchFor(null)}
        onChosen={(l) => {
          replace(l)
          setSearchFor(null)
        }}
      />
    )
  if (loading) return <Skeleton large={large} />
  const openSearch = () => setSearchFor("")
  if (!lyrics)
    return (
      <Message large={large} icon={<Mic2 size={28} />} title="Aucune parole trouvée" hint="Aucune source (fichier .lrc, tags, LRCLIB, NetEase, Genius) n'a de résultat fiable pour ce titre.">
        <div className="flex flex-wrap justify-center gap-2">
          <RefreshButton large={large} onClick={openSearch} label="Chercher manuellement" icon={<Search size={14} />} />
          <RefreshButton large={large} onClick={refresh} label="Relancer" />
        </div>
      </Message>
    )
  if (lyrics.kind === "instrumental")
    return (
      <Message large={large} icon={<Music2 size={28} />} title="Morceau instrumental" hint={`Source : ${lyrics.source}`}>
        <RefreshButton large={large} onClick={openSearch} label="Chercher des paroles" icon={<Search size={14} />} />
      </Message>
    )
  if (lyrics.kind === "plain") return <PlainLyrics key={trackId} text={lyrics.text} source={lyrics.source} large={large} onRefresh={refresh} onSearch={openSearch} />
  return <SyncedLyrics key={trackId} lines={lyrics.lines} source={lyrics.source} approximate={!!lyrics.approximate} large={large} onRefresh={refresh} onSearch={openSearch} />
}

// ---------- recherche manuelle ----------

const fmtDuration = (s: number) => (s > 0 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : "")

function ManualSearch({ trackId, large, onClose, onChosen }: { trackId: string; large?: boolean; onClose: () => void; onChosen: (l: Lyrics) => void }) {
  const duration = usePlayer((s) => s.durationMs) / 1000
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<LyricsResult[] | null>(null)
  const [busy, setBusy] = useState(true)
  const [preview, setPreview] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  const run = (q?: string) => {
    setBusy(true)
    setPreview(null)
    backend.lyrics
      .search(trackId, q)
      .then((r) => {
        setQuery((prev) => (q === undefined ? r.query : prev))
        setResults(r.results)
      })
      .catch(() => setResults([]))
      .finally(() => setBusy(false))
  }
  // Première recherche avec la requête déduite du morceau.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => run(), [trackId])

  const choose = (r: LyricsResult) => {
    setSaving(true)
    backend.lyrics
      .choose(trackId, r)
      .then((l) => l && onChosen(l))
      .finally(() => setSaving(false))
  }

  const muted = large ? "text-white/55" : "text-lo"
  const card = large ? "bg-white/8 hover:bg-white/14" : "bg-[color-mix(in_srgb,var(--text-hi)_6%,transparent)] hover:bg-[color-mix(in_srgb,var(--text-hi)_11%,transparent)]"

  return (
    <div className={cn("flex h-full flex-col", large ? "px-2 pt-[8vh] text-white" : "px-5 pt-5 text-hi")}>
      <div className="mb-3 flex items-center justify-between">
        <div className={cn("font-bold", large ? "text-xl" : "text-base")}>Rechercher des paroles</div>
        <button onClick={onClose} className={cn("rounded-full p-1.5", large ? "hover:bg-white/10" : "hover:bg-[color-mix(in_srgb,var(--text-hi)_10%,transparent)]")} aria-label="Fermer la recherche">
          <X size={18} />
        </button>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          run(query)
        }}
        className="mb-3 flex gap-2"
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Artiste titre"
          className={cn("min-w-0 flex-1 rounded-full border px-4 py-2 text-sm outline-none", large ? "border-white/20 bg-white/10 placeholder:text-white/40" : "border-[var(--glass-border)] bg-transparent")}
        />
        <button type="submit" className={cn("flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold", large ? "bg-white text-black" : "bg-[var(--text-hi)] text-[var(--bg-0)]")}>
          <Search size={14} /> Chercher
        </button>
      </form>
      <div className="lyrics-scroll min-h-0 flex-1 overflow-y-auto pb-10">
        {busy && <div className={cn("py-8 text-center text-sm", muted)}>Recherche sur LRCLIB, NetEase et Genius…</div>}
        {!busy && results?.length === 0 && <div className={cn("py-8 text-center text-sm", muted)}>Aucun résultat. Essayez « artiste titre » sans mots superflus.</div>}
        {!busy &&
          results?.map((r, i) => {
            const diff = r.durationS > 0 && duration > 0 ? Math.abs(r.durationS - duration) : null
            const exact = diff !== null && diff <= Math.max(3, duration * 0.02)
            return (
              <div key={i} className={cn("mb-2 rounded-xl p-3 transition-colors", card)}>
                <button className="block w-full text-left" onClick={() => setPreview(preview === i ? null : i)}>
                  <div className="truncate font-semibold">{r.title}</div>
                  <div className={cn("truncate text-sm", muted)}>
                    {r.artist}
                    {r.album ? ` · ${r.album}` : ""}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
                    <Badge large={large} strong={r.synced}>{r.synced ? "Synchronisées" : "Texte seul"}</Badge>
                    <Badge large={large}>{r.source}</Badge>
                    {r.durationS > 0 && (
                      <Badge large={large} strong={exact}>
                        {fmtDuration(r.durationS)}
                        {exact ? " · même durée" : diff !== null ? ` · ${diff > 0 ? "écart " + Math.round(diff) + " s" : ""}` : ""}
                      </Badge>
                    )}
                  </div>
                </button>
                {preview === i && (
                  <div className="mt-3">
                    <div className={cn("max-h-48 overflow-y-auto whitespace-pre-line rounded-lg p-2 text-sm", large ? "bg-black/20 text-white/80" : "bg-[color-mix(in_srgb,var(--text-hi)_5%,transparent)] text-mid")}>
                      {r.text.replace(/\[\d{1,3}[:.,]\d{1,2}(?:[.:,]\d{1,3})?\]/g, "").replace(/<\d{1,3}:\d{1,2}(?:[.:,]\d{1,3})?>/g, "").trim().slice(0, 1200)}
                    </div>
                    <button
                      disabled={saving}
                      onClick={() => choose(r)}
                      className={cn("mt-2 flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-semibold disabled:opacity-50", large ? "bg-white text-black" : "bg-[var(--text-hi)] text-[var(--bg-0)]")}
                    >
                      <Check size={14} /> Utiliser ces paroles
                    </button>
                  </div>
                )}
              </div>
            )
          })}
      </div>
    </div>
  )
}

function Badge({ children, strong, large }: { children: React.ReactNode; strong?: boolean; large?: boolean }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5",
        strong
          ? large
            ? "bg-white/85 text-black"
            : "bg-[var(--text-hi)] text-[var(--bg-0)]"
          : large
            ? "bg-white/12 text-white/70"
            : "bg-[color-mix(in_srgb,var(--text-hi)_9%,transparent)] text-mid",
      )}
    >
      {children}
    </span>
  )
}

// ---------- synchronisées ----------

/** Position de lecture interpolée entre les mises à jour du moteur audio (lecture à la demande, sans rendu). */
function usePlaybackClock(offsetMs: number) {
  const anchor = useRef({ pos: usePlayer.getState().positionMs, at: performance.now() })
  useEffect(
    () =>
      usePlayer.subscribe((s, prev) => {
        if (s.positionMs !== prev.positionMs || s.status !== prev.status) anchor.current = { pos: s.positionMs, at: performance.now() }
      }),
    [],
  )
  const offset = useRef(offsetMs)
  offset.current = offsetMs
  return useCallback(() => {
    const s = usePlayer.getState()
    const a = anchor.current
    const pos = s.status === "playing" ? a.pos + Math.min(performance.now() - a.at, 1000) : s.positionMs
    return pos + LEAD_MS + offset.current
  }, [])
}

/** Index de la dernière ligne commencée. */
function useActiveLine(lines: LyricsLine[], now: () => number) {
  const [index, setIndex] = useState(-1)
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const t = now()
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
      setIndex((previous) => (previous === found ? previous : found))
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [lines, now])
  return index
}

/** Défilement animé (ease-out) : plus doux et régulier que le smooth natif de WebKitGTK. */
function useSmoothScroll() {
  const raf = useRef(0)
  const cancel = useCallback(() => cancelAnimationFrame(raf.current), [])
  const to = useCallback((box: HTMLElement, target: number, duration = 750) => {
    cancelAnimationFrame(raf.current)
    const from = box.scrollTop
    const delta = target - from
    if (Math.abs(delta) < 1) return
    const t0 = performance.now()
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / duration)
      const e = 1 - Math.pow(1 - k, 4)
      box.scrollTop = from + delta * e
      if (k < 1) raf.current = requestAnimationFrame(step)
    }
    raf.current = requestAnimationFrame(step)
  }, [])
  useEffect(() => cancel, [cancel])
  return { to, cancel }
}

/** Ligne active : balayage karaoké mot à mot, réparti selon la longueur des mots. */
function KaraokeLine({ text, start, end, now, large }: { text: string; start: number; end: number; now: () => number; large?: boolean }) {
  const words = useMemo(() => text.split(/(\s+)/).filter(Boolean), [text])
  const spans = useRef<(HTMLSpanElement | null)[]>([])
  useEffect(() => {
    const weights = words.map((w) => (/^\s+$/.test(w) ? 0 : w.length + 2))
    const total = weights.reduce((a, b) => a + b, 0) || 1
    // Durée chantée : bornée par la ligne suivante, estimée d'après la longueur du texte.
    const dur = Math.max(400, Math.min(end - start - 150, Math.max(1100, total * 85)))
    let raf = 0
    const tick = () => {
      const p = Math.max(0, Math.min(1, (now() - start) / dur)) * total
      let acc = 0
      words.forEach((_, i) => {
        const el = spans.current[i]
        const w = weights[i]
        if (!el || !w) return
        const f = Math.max(0, Math.min(1, (p - acc) / w))
        acc += w
        el.style.setProperty("--f", `${(f * 124 - 12).toFixed(1)}%`)
        el.style.transform = `translateY(${(-2 * Math.sin(f * Math.PI)).toFixed(2)}px)`
      })
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [words, start, end, now])
  const lit = large ? "#fff" : "var(--text-hi)"
  const dim = large ? "rgba(255,255,255,.38)" : "color-mix(in srgb, var(--text-hi) 38%, transparent)"
  return (
    <>
      {words.map((w, i) =>
        /^\s+$/.test(w) ? (
          w
        ) : (
          <span
            key={i}
            ref={(el) => void (spans.current[i] = el)}
            className="inline-block"
            style={{
              ["--f" as string]: "-12%",
              backgroundImage: `linear-gradient(90deg, ${lit} calc(var(--f) - 12%), ${dim} calc(var(--f) + 12%))`,
              backgroundSize: "100% 100%",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
              WebkitTextFillColor: "transparent",
            }}
          >
            {w}
          </span>
        ),
      )}
    </>
  )
}

function SyncedLyrics({ lines, source, approximate, large, onRefresh, onSearch }: { lines: LyricsLine[]; source: string; approximate: boolean; large?: boolean; onRefresh: () => void; onSearch: () => void }) {
  const seek = usePlayer((s) => s.seek)
  const trackId = usePlayer((s) => s.currentTrackId)
  const [offsetMs, setOffsetMs] = useState(() => Number(localStorage.getItem(`aura:lyric-offset:${trackId}`)) || 0)
  const now = usePlaybackClock(offsetMs)
  const active = useActiveLine(lines, now)
  const smooth = useSmoothScroll()
  const scroller = useRef<HTMLDivElement>(null)
  const refs = useRef<(HTMLElement | null)[]>([])
  const introRef = useRef<HTMLDivElement>(null)
  const [follow, setFollow] = useState(true)
  const followRef = useRef(follow)
  followRef.current = follow
  const resumeTimer = useRef(0)
  const firstScroll = useRef(true)
  const hasIntro = lines[0].timeMs > 2500

  const scrollToActive = (animate: boolean) => {
    const box = scroller.current
    const el = active >= 0 ? refs.current[active] : introRef.current
    if (!box || !el) return
    const top = Math.max(0, Math.min(box.scrollHeight - box.clientHeight, el.offsetTop - box.clientHeight * 0.36 + el.offsetHeight / 2))
    if (animate) smooth.to(box, top)
    else {
      smooth.cancel()
      box.scrollTop = top
    }
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
    const ro = new ResizeObserver(() => followRef.current && scrollToActive(false))
    ro.observe(box)
    return () => ro.disconnect()
  })

  useEffect(() => () => window.clearTimeout(resumeTimer.current), [])

  const userScrolled = () => {
    smooth.cancel()
    setFollow(false)
    window.clearTimeout(resumeTimer.current)
    resumeTimer.current = window.setTimeout(() => setFollow(true), RESUME_FOLLOW_MS)
  }
  const resync = () => {
    window.clearTimeout(resumeTimer.current)
    setFollow(true)
  }
  const adjustOffset = (delta: number) => {
    const next = Math.max(-10000, Math.min(10000, offsetMs + delta))
    setOffsetMs(next)
    localStorage.setItem(`aura:lyric-offset:${trackId}`, String(next))
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
          {approximate && (
            <div className={cn("self-start rounded-full px-3 py-1 text-xs font-semibold", large ? "bg-white/15 text-white/80" : "bg-[color-mix(in_srgb,var(--text-hi)_10%,transparent)] text-mid")}>
              Synchro d'une autre version : ajustez le décalage en bas si besoin
            </div>
          )}
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
            const dist = i - active
            return (
              <button
                key={i}
                ref={(el) => void (refs.current[i] = el)}
                onClick={() => {
                  seek(Math.max(0, line.timeMs - offsetMs))
                  resync()
                }}
                className={cn(
                  "block w-full origin-left rounded-lg text-left font-extrabold tracking-tight antialiased",
                  "transition-[color,transform,opacity,text-shadow] duration-[650ms] ease-[cubic-bezier(.22,1,.36,1)]",
                  large ? "text-[clamp(1.7rem,2.6vw,2.6rem)] leading-[1.18]" : "text-[1.3rem] leading-[1.25]",
                  "text-[color:var(--c)] hover:text-[color:var(--hover)]",
                )}
                style={{
                  ["--c" as string]: colorFor(state),
                  ["--hover" as string]: state === "active" ? colorFor(state) : large ? "rgba(255,255,255,.85)" : "var(--text-hi)",
                  transform: state === "active" ? "scale(1)" : `scale(${large ? 0.94 : 0.96})`,
                  opacity: state === "active" ? 1 : follow ? Math.max(large ? 0.35 : 0.5, 1 - Math.abs(dist) * 0.14) : 1,
                  textShadow: state === "active" && large ? "0 0 28px rgba(255,255,255,.35)" : "0 0 0 transparent",
                  // Effet de vague : les lignes suivantes rattrapent la position avec un léger retard.
                  transitionDelay: follow && dist > 0 ? `${Math.min(dist, 6) * 40}ms` : "0ms",
                }}
              >
                {state === "active" ? (
                  <KaraokeLine text={line.text} start={line.timeMs} end={lines[i + 1]?.timeMs ?? line.timeMs + 6000} now={now} large={large} />
                ) : (
                  line.text
                )}
              </button>
            )
          })}
          <div className={cn("mt-7 flex flex-wrap items-center gap-2 text-xs", large ? "text-white/60" : "text-mid")}>
            <span>Décalage {offsetMs > 0 ? "+" : ""}{(offsetMs / 1000).toFixed(1)} s</span>
            <button onClick={() => adjustOffset(-500)} className="rounded-md border border-[var(--glass-border)] px-2 py-1" aria-label="Retarder les paroles de 0,5 seconde">− 0,5 s</button>
            <button onClick={() => adjustOffset(500)} className="rounded-md border border-[var(--glass-border)] px-2 py-1" aria-label="Avancer les paroles de 0,5 seconde">+ 0,5 s</button>
            {offsetMs !== 0 && <button onClick={() => adjustOffset(-offsetMs)} className="rounded-md px-2 py-1 underline">Réinitialiser</button>}
          </div>
          <Footer source={source} large={large} onRefresh={onRefresh} onSearch={onSearch} />
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

function PlainLyrics({ text, source, large, onRefresh, onSearch }: { text: string; source: string; large?: boolean; onRefresh: () => void; onSearch: () => void }) {
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
        <Footer source={source} large={large} onRefresh={onRefresh} onSearch={onSearch} />
      </div>
    </div>
  )
}

function Footer({ source, large, onRefresh, onSearch }: { source: string; large?: boolean; onRefresh: () => void; onSearch: () => void }) {
  return (
    <div className={cn("mt-10 flex items-center gap-3 text-xs", large ? "text-white/50" : "text-lo")}>
      <span>Paroles fournies par {source}</span>
      <button onClick={onRefresh} className={cn("flex items-center gap-1 rounded-full px-2 py-1", large ? "hover:bg-white/10 hover:text-white" : "hover:text-hi")} aria-label="Rechercher à nouveau">
        <RotateCw size={12} /> Actualiser
      </button>
      <button onClick={onSearch} className={cn("flex items-center gap-1 rounded-full px-2 py-1", large ? "hover:bg-white/10 hover:text-white" : "hover:text-hi")}>
        <Search size={12} /> Mauvaises paroles ?
      </button>
    </div>
  )
}

function RefreshButton({ onClick, label, large, icon }: { onClick: () => void; label: string; large?: boolean; icon?: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn("mt-4 flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold", large ? "bg-white/15 text-white hover:bg-white/25" : "bg-[color-mix(in_srgb,var(--text-hi)_10%,transparent)] text-hi hover:bg-[color-mix(in_srgb,var(--text-hi)_16%,transparent)]")}
    >
      {icon ?? <RotateCw size={14} />} {label}
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
