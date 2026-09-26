import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { Mic2, Music2, RotateCw, LocateFixed, Search, X, Check, Crosshair, Minus, Plus } from "lucide-react"
import { create } from "zustand"
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

// ----- calage (global + par section), partagé entre le tiroir et le plein écran -----

/** `off` = temps des paroles − temps audio, à partir de la ligne `line` (ou global). */
interface SyncState {
  global: number
  anchors: { line: number; off: number }[]
}
const EMPTY_SYNC: SyncState = { global: 0, anchors: [] }

const useLyricSync = create<{ byTrack: Record<string, SyncState>; set: (id: string, s: SyncState) => void }>((set) => ({
  byTrack: {},
  set: (id, st) => {
    try {
      localStorage.setItem(`aura:lyric-sync:${id}`, JSON.stringify(st))
      localStorage.removeItem(`aura:lyric-offset:${id}`)
    } catch {
      /* stockage indisponible : le calage reste pour la session */
    }
    set((s) => ({ byTrack: { ...s.byTrack, [id]: st } }))
  },
}))

function readSync(id: string): SyncState {
  try {
    const raw = localStorage.getItem(`aura:lyric-sync:${id}`)
    if (raw) {
      const v = JSON.parse(raw) as SyncState
      if (typeof v.global === "number" && Array.isArray(v.anchors)) return v
    }
    const old = Number(localStorage.getItem(`aura:lyric-offset:${id}`))
    if (old) return { global: old, anchors: [] }
  } catch {
    /* ignoré */
  }
  return EMPTY_SYNC
}

function useSync(trackId: string | null) {
  const stored = useLyricSync((s) => (trackId ? s.byTrack[trackId] : undefined))
  const sync = useMemo(() => stored ?? (trackId ? readSync(trackId) : EMPTY_SYNC), [stored, trackId])
  const save = useCallback((st: SyncState) => trackId && useLyricSync.getState().set(trackId, st), [trackId])
  return [sync, save] as const
}

const offsetAt = (sync: SyncState, line: number) => {
  let off = sync.global
  for (const a of sync.anchors) if (a.line <= line) off = a.off
  return off
}

// ----- chronologie : quand chaque ligne et chaque mot sont réellement chantés -----

interface TimedWord {
  text: string
  start: number
  end: number
}
interface TimedLine {
  start: number
  /** Fin estimée (ou exacte) du chant : le balayage karaoké s'y termine. */
  end: number
  words: TimedWord[]
}

const VOWELS = /[aeiouyàáâãäåæèéêëìíîïòóôõöøùúûüýÿœɑəɛɔ]+/gi
const CJK = /[぀-ヿ㐀-鿿가-힯]/g

/** Nombre approximatif de syllabes (groupes de voyelles, un caractère par syllabe en CJK). */
function syllables(word: string) {
  const cjk = word.match(CJK)?.length ?? 0
  const latin = word.replace(CJK, "").match(VOWELS)?.length ?? 0
  const n = cjk + latin
  return n > 0 ? n : /[\p{L}\p{N}]/u.test(word) ? 1 : 0
}

const splitWords = (text: string) => text.split(/(?<=\s)(?=\S)/)

/**
 * Débit chanté du morceau (syllabes/ms), déduit des paroles : sur les lignes enchaînées, le chanteur remplit
 * presque tout l'intervalle ; on retient donc un débit haut (75e centile) pour ne pas étaler une ligne sur la
 * respiration qui la suit.
 */
function singingRate(lines: LyricsLine[]) {
  const rates: number[] = []
  lines.forEach((l, i) => {
    const next = lines[i + 1]
    if (!l.text || !next) return
    const gap = next.timeMs - l.timeMs
    if (gap < 700 || gap > 10000) return
    const syl = splitWords(l.text).reduce((n, w) => n + syllables(w), 0)
    if (syl > 0) rates.push(syl / gap)
  })
  if (rates.length < 3) return 4.2 / 1000
  rates.sort((a, b) => a - b)
  const r = rates[Math.floor(rates.length * 0.75)]
  return Math.max(2.6 / 1000, Math.min(9 / 1000, r))
}

function buildTimeline(lines: LyricsLine[], sync: SyncState): TimedLine[] {
  const rate = singingRate(lines)
  let prev = -Infinity
  const starts = lines.map((l, i) => {
    // Temps audio de la ligne ; ordre préservé même si deux sections se chevauchent après calage.
    const t = Math.max(prev + 1, l.timeMs - offsetAt(sync, i))
    prev = t
    return t
  })
  return lines.map((l, i) => {
    const shift = starts[i] - l.timeMs
    const nextStart = starts[i + 1] ?? starts[i] + 8000
    const room = Math.max(250, nextStart - starts[i] - 90)
    if (l.words?.length) {
      const ws = l.words.map((w) => ({ text: w.text, start: w.timeMs + shift }))
      const lastEnd = l.endMs !== undefined ? l.endMs + shift : ws[ws.length - 1].start + Math.max(200, syllables(ws[ws.length - 1].text) / rate)
      const words = ws.map((w, k) => ({ ...w, end: Math.max(w.start + 60, ws[k + 1]?.start ?? lastEnd) }))
      return { start: starts[i], end: Math.min(lastEnd, nextStart), words }
    }
    const parts = splitWords(l.text)
    const syl = parts.map((w) => syllables(w))
    const total = syl.reduce((a, b) => a + b, 0) || 1
    const dur = Math.max(350, Math.min(room, total / rate))
    let acc = 0
    const words = parts.map((text, k) => {
      const start = starts[i] + (acc / total) * dur
      acc += syl[k]
      return { text, start, end: starts[i] + (acc / total) * dur }
    })
    return { start: starts[i], end: starts[i] + dur, words }
  })
}

// ----- horloge -----

/** Position audio interpolée entre les mises à jour du moteur (~5/s), lissée pour éviter les micro-sauts. */
function usePlaybackClock() {
  const anchor = useRef({ pos: usePlayer.getState().positionMs, at: performance.now() })
  useEffect(
    () =>
      usePlayer.subscribe((s, prev) => {
        if (s.positionMs === prev.positionMs && s.status === prev.status) return
        const t = performance.now()
        const a = anchor.current
        const predicted = a.pos + (prev.status === "playing" ? t - a.at : 0)
        const err = s.positionMs - predicted
        // Petite dérive : correction progressive ; seek, pause ou gros écart : recalage immédiat.
        const pos = s.status === "playing" && prev.status === "playing" && Math.abs(err) < 120 ? predicted + err * 0.35 : s.positionMs
        anchor.current = { pos, at: t }
      }),
    [],
  )
  return useCallback(() => {
    const s = usePlayer.getState()
    const a = anchor.current
    return s.status === "playing" ? a.pos + Math.min(performance.now() - a.at, 1500) + LEAD_MS : s.positionMs + LEAD_MS
  }, [])
}

/** Index de la dernière ligne commencée. */
function useActiveLine(timeline: TimedLine[], now: () => number) {
  const [index, setIndex] = useState(-1)
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const t = now()
      let lo = 0
      let hi = timeline.length - 1
      let found = -1
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (timeline[mid].start <= t) {
          found = mid
          lo = mid + 1
        } else hi = mid - 1
      }
      setIndex((previous) => (previous === found ? previous : found))
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [timeline, now])
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

// Le balayage part un poil avant l'attaque : la syllabe s'allume au moment où on l'entend, pas après.
const SWEEP_LEAD_MS = 70

/** Ligne active : balayage karaoké mot à mot, calé sur la chronologie (mots horodatés ou estimés). */
function KaraokeLine({ line, now, large }: { line: TimedLine; now: () => number; large?: boolean }) {
  const spans = useRef<(HTMLSpanElement | null)[]>([])
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const t = now() + SWEEP_LEAD_MS
      line.words.forEach((w, i) => {
        const el = spans.current[i]
        if (!el) return
        const f = Math.max(0, Math.min(1, (t - w.start) / Math.max(1, w.end - w.start)))
        el.style.setProperty("--f", `${(f * 124 - 12).toFixed(1)}%`)
        el.style.transform = `translateY(${(-2.5 * Math.sin(Math.min(1, f * 1.4) * Math.PI)).toFixed(2)}px)`
      })
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [line, now])
  const lit = large ? "#fff" : "var(--text-hi)"
  const dim = large ? "rgba(255,255,255,.38)" : "color-mix(in srgb, var(--text-hi) 38%, transparent)"
  return (
    <>
      {line.words.map((w, i) => {
        const trailing = w.text.match(/\s+$/)?.[0] ?? ""
        return (
          <span key={i}>
            <span
              ref={(el) => void (spans.current[i] = el)}
              className="inline-block"
              style={{
                ["--f" as string]: "-12%",
                backgroundImage: `linear-gradient(90deg, ${lit} calc(var(--f) - 12%), ${dim} calc(var(--f) + 12%))`,
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
                WebkitTextFillColor: "transparent",
              }}
            >
              {w.text.trimEnd()}
            </span>
            {trailing}
          </span>
        )
      })}
    </>
  )
}

// Un seul composant monté (tiroir ou plein écran) répond aux raccourcis de calage : le dernier arrivé.
const keyOwners: number[] = []
let keyOwnerSeq = 0

function SyncedLyrics({ lines, source, approximate, large, onRefresh, onSearch }: { lines: LyricsLine[]; source: string; approximate: boolean; large?: boolean; onRefresh: () => void; onSearch: () => void }) {
  const seek = usePlayer((s) => s.seek)
  const trackId = usePlayer((s) => s.currentTrackId)
  const [sync, saveSync] = useSync(trackId)
  const timeline = useMemo(() => buildTimeline(lines, sync), [lines, sync])
  const now = usePlaybackClock()
  const active = useActiveLine(timeline, now)
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
  const clampOff = (v: number) => Math.round(Math.max(-600000, Math.min(600000, v)))
  /** Décale la section en cours (ou tout le morceau s'il n'y a pas de section). */
  const nudge = (delta: number) => {
    const line = Math.max(0, active)
    const idx = sync.anchors.reduce((k, a, j) => (a.line <= line ? j : k), -1)
    if (idx < 0) saveSync({ ...sync, global: clampOff(sync.global + delta) })
    else saveSync({ ...sync, anchors: sync.anchors.map((a, j) => (j === idx ? { ...a, off: clampOff(a.off + delta) } : a)) })
  }
  /**
   * « Caler » : la ligne dont le début est le plus proche de l'instant présent démarre maintenant.
   * Premier calage = tout le morceau ; les suivants créent une section à partir de cette ligne.
   */
  const tap = () => {
    const t = now()
    const candidates = [active, active + 1].filter((i) => i >= 0 && i < lines.length && lines[i].text)
    if (!candidates.length) return
    const j = candidates.reduce((best, i) => (Math.abs(timeline[i].start - t) < Math.abs(timeline[best].start - t) ? i : best))
    const off = clampOff(lines[j].timeMs - t)
    if (!sync.anchors.length && sync.global === 0) saveSync({ global: off, anchors: [] })
    else saveSync({ ...sync, anchors: [...sync.anchors.filter((a) => a.line !== j), { line: j, off }].sort((a, b) => a.line - b.line) })
    setFlash(j)
    window.setTimeout(() => setFlash((f) => (f === j ? null : f)), 700)
  }
  const [flash, setFlash] = useState<number | null>(null)
  const synced = sync.global !== 0 || sync.anchors.length > 0
  const sectionOff = offsetAt(sync, Math.max(0, active))

  // Raccourcis : T = caler, [ et ] = ∓ 0,1 s.
  const handlers = useRef({ tap, nudge })
  handlers.current = { tap, nudge }
  useEffect(() => {
    const id = ++keyOwnerSeq
    keyOwners.push(id)
    const onKey = (e: KeyboardEvent) => {
      if (keyOwners[keyOwners.length - 1] !== id || e.ctrlKey || e.metaKey || e.altKey) return
      const el = document.activeElement
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || (el as HTMLElement).isContentEditable)) return
      if (e.key === "t" || e.key === "T") handlers.current.tap()
      else if (e.key === "[") handlers.current.nudge(-100)
      else if (e.key === "]") handlers.current.nudge(100)
    }
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("keydown", onKey)
      keyOwners.splice(keyOwners.indexOf(id), 1)
    }
  }, [])

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
    <div className="group/lyrics relative h-full">
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
              Synchro d'une autre version : appuyez sur « Caler » (T) au début d'une ligne si besoin
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
                  seek(Math.max(0, timeline[i].start))
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
                  textShadow: flash === i ? "0 0 32px rgba(120,255,190,.8)" : state === "active" && large ? "0 0 28px rgba(255,255,255,.35)" : "0 0 0 transparent",
                  // Effet de vague : les lignes suivantes rattrapent la position avec un léger retard.
                  transitionDelay: follow && dist > 0 ? `${Math.min(dist, 6) * 40}ms` : "0ms",
                }}
              >
                {state === "active" ? (
                  <KaraokeLine line={timeline[i]} now={now} large={large} />
                ) : (
                  line.text
                )}
              </button>
            )
          })}
          <Footer source={source} large={large} onRefresh={onRefresh} onSearch={onSearch} />
        </div>
      </div>

      <SyncBar large={large} offsetMs={sectionOff} sections={sync.anchors.length} synced={synced} onNudge={nudge} onTap={tap} onReset={() => saveSync(EMPTY_SYNC)} lifted={!follow} />

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

/** Barre de calage : discrète, elle s'affiche au survol des paroles. */
function SyncBar({ large, offsetMs, sections, synced, onNudge, onTap, onReset, lifted }: { large?: boolean; offsetMs: number; sections: number; synced: boolean; onNudge: (d: number) => void; onTap: () => void; onReset: () => void; lifted: boolean }) {
  const btn = cn("grid h-7 min-w-7 place-items-center rounded-full px-1.5 transition active:scale-90", large ? "hover:bg-white/15" : "hover:bg-[color-mix(in_srgb,var(--text-hi)_10%,transparent)]")
  return (
    <div
      className={cn(
        "absolute right-2 flex items-center gap-0.5 rounded-full p-1 text-xs font-semibold opacity-0 shadow-lg transition-all duration-300 group-hover/lyrics:opacity-100 focus-within:opacity-100",
        lifted ? "bottom-16" : "bottom-3",
        large ? "bg-black/35 text-white/85 ring-1 ring-white/10" : "glass text-mid",
      )}
    >
      <button onClick={() => onNudge(-100)} className={btn} aria-label="Retarder les paroles de 0,1 s ([)" title="Paroles plus tard ([)">
        <Minus size={13} />
      </button>
      <span className="w-14 text-center tnum" title={sections ? `${sections + 1} sections calées` : "Décalage"}>
        {offsetMs > 0 ? "+" : offsetMs < 0 ? "−" : "±"}
        {(Math.abs(offsetMs) / 1000).toFixed(1)} s
      </span>
      <button onClick={() => onNudge(100)} className={btn} aria-label="Avancer les paroles de 0,1 s (])" title="Paroles plus tôt (])">
        <Plus size={13} />
      </button>
      <button onClick={onTap} className={cn(btn, "gap-1 px-2.5", large ? "bg-white/15" : "bg-[color-mix(in_srgb,var(--text-hi)_10%,transparent)]")} title="Appuyez quand la ligne commence à être chantée (T)">
        <span className="flex items-center gap-1">
          <Crosshair size={13} /> Caler
        </span>
      </button>
      {synced && (
        <button onClick={onReset} className={btn} aria-label="Réinitialiser le calage" title="Réinitialiser">
          <RotateCw size={12} />
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
