import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { motion } from "framer-motion"
import { Search as SearchIcon, X, Clock, Play } from "lucide-react"
import { backend, type SearchResults } from "../../services"
import { useUI } from "../../store/uiStore"
import { usePlaybackActions } from "../../hooks/usePlaybackActions"
import CoverArt from "../../components/CoverArt"
import TrackRow from "../../components/TrackRow"
import { AlbumCard, ArtistCard, PlaylistCard } from "../../components/cards"
import EmptyState from "../../components/EmptyState"
import { cn } from "../../utils/cn"
import type { Track } from "../../types"

type Filter = "tout" | "titres" | "albums" | "artistes" | "playlists" | "paroles"
const FILTERS: { id: Filter; label: string }[] = [
  { id: "tout", label: "Tout" },
  { id: "titres", label: "Titres" },
  { id: "albums", label: "Albums" },
  { id: "artistes", label: "Artistes" },
  { id: "playlists", label: "Playlists" },
  { id: "paroles", label: "Paroles" },
]
const SUGGESTIONS = ["Jazz", "Ambient", "Piano", "Live", "Années 80", "Acoustique"]
const RECENT_KEY = "aura-recent-search"

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

export default function Search() {
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<Filter>("tout")
  const [results, setResults] = useState<SearchResults | null>(null)
  const [lyricsTracks, setLyricsTracks] = useState<Track[]>([])
  const [lyricsLoading, setLyricsLoading] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const [recent, setRecent] = useState<string[]>(loadRecent)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useUI((s) => s.navigate)
  const actions = usePlaybackActions()

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const trimmed = query.trim()
  useEffect(() => {
    if (!trimmed) {
      setResults(null)
      return
    }
    let alive = true
    const t = setTimeout(async () => {
      try {
        const r = await backend.library.search(trimmed)
        if (alive) { setResults(r); setHighlight(0) }
      } catch { if (alive) setResults(null) }
    }, 180)
    return () => { alive = false; clearTimeout(t) }
  }, [trimmed])

  useEffect(() => {
    if (filter !== "paroles" || trimmed.length < 3) { setLyricsTracks([]); setLyricsLoading(false); return }
    let alive = true
    setLyricsLoading(true)
    const timer = setTimeout(() => {
      backend.library.searchLyrics(trimmed).then((items) => { if (alive) setLyricsTracks(items) })
        .catch(() => { if (alive) setLyricsTracks([]) })
        .finally(() => { if (alive) setLyricsLoading(false) })
    }, 250)
    return () => { alive = false; clearTimeout(timer) }
  }, [trimmed, filter])

  const commitRecent = useCallback((q: string) => {
    const v = q.trim()
    if (!v) return
    setRecent((prev) => {
      const next = [v, ...prev.filter((x) => x.toLowerCase() !== v.toLowerCase())].slice(0, 6)
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next))
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  const clearRecent = () => {
    setRecent([])
    try {
      localStorage.removeItem(RECENT_KEY)
    } catch {
      /* ignore */
    }
  }

  const show = (f: Filter) => filter === "tout" || filter === f
  const tracks = results?.tracks ?? []
  const visibleTracks = filter === "paroles" ? lyricsTracks : show("titres") ? tracks : []

  const playTrack = useCallback(
    (id: string) => {
      commitRecent(trimmed)
      actions.playContext([id], 0)
    },
    [actions, commitRecent, trimmed],
  )

  const best = useMemo(() => {
    if (!results?.best) return null
    const { kind, id } = results.best
    if (kind === "track") return { kind, item: results.tracks.find((t) => t.id === id) }
    if (kind === "album") return { kind, item: results.albums.find((a) => a.id === id) }
    if (kind === "artist") return { kind, item: results.artists.find((a) => a.id === id) }
    return { kind, item: results.playlists.find((p) => p.id === id) }
  }, [results])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!visibleTracks.length) return
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setHighlight((h) => Math.min(h + 1, visibleTracks.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
    } else if (e.key === "Enter") {
      e.preventDefault()
      const t = visibleTracks[highlight]
      if (t) playTrack(t.id)
    }
  }

  const bestClick = () => {
    if (!best?.item) return
    commitRecent(trimmed)
    if (best.kind === "track") actions.playContext([(best.item as { id: string }).id], 0)
    else navigate({ name: best.kind, id: (best.item as { id: string }).id })
  }

  const hasResults = filter === "paroles" ? lyricsTracks.length > 0 :
    !!(results && (results.tracks.length || results.albums.length || results.artists.length || results.playlists.length))

  return (
    <div className="p-8">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="glass flex items-center gap-3 rounded-2xl px-5 py-4">
        <SearchIcon size={22} className="shrink-0 text-mid" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Rechercher des titres, albums, artistes…"
          className="w-full bg-transparent text-lg text-hi placeholder:text-lo focus:outline-none"
        />
        {query && (
          <button onClick={() => setQuery("")} aria-label="Effacer" className="shrink-0 rounded-full p-1 text-mid hover:text-hi">
            <X size={18} />
          </button>
        )}
      </motion.div>

      {trimmed && (
        <div className="mt-5 flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                "rounded-full px-4 py-1.5 text-sm font-semibold transition-colors",
                filter === f.id ? "text-white" : "glass text-mid hover:text-hi",
              )}
              style={filter === f.id ? { background: "var(--accent)" } : undefined}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {trimmed && filter === "paroles" && <p className="mt-3 text-xs text-mid">Recherche hors ligne dans les paroles déjà chargées et les fichiers .lrc/.txt de votre bibliothèque. Saisissez au moins 3 caractères.</p>}
      {trimmed && filter === "paroles" && lyricsLoading && <p className="mt-8 text-sm text-mid">Recherche dans les paroles…</p>}

      {!trimmed && (
        <div className="mt-10 space-y-8">
          {recent.length > 0 && (
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-mid">Recherches récentes</h2>
                <button onClick={clearRecent} className="text-xs font-semibold text-lo hover:text-hi">
                  Effacer
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {recent.map((q) => (
                  <button
                    key={q}
                    onClick={() => setQuery(q)}
                    className="glass flex items-center gap-2 rounded-full px-4 py-1.5 text-sm text-hi hover:bg-white/8"
                  >
                    <Clock size={13} className="text-lo" /> {q}
                  </button>
                ))}
              </div>
            </section>
          )}
          <section>
            <h2 className="mb-3 text-sm font-semibold text-mid">Suggestions</h2>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((q) => (
                <button key={q} onClick={() => setQuery(q)} className="glass rounded-full px-4 py-1.5 text-sm text-hi hover:bg-white/8">
                  {q}
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      {trimmed && results && !hasResults && !lyricsLoading && (
        <EmptyState
          icon={<SearchIcon size={34} />}
          title="Aucun résultat"
          description={`Aucun résultat pour « ${trimmed} ». Essayez un autre terme.`}
        />
      )}

      {trimmed && hasResults ? (
        <div className="mt-8 space-y-10">
          {filter === "paroles" && lyricsTracks.length > 0 && <section><h2 className="mb-3 text-xl font-bold tracking-tight text-hi">Paroles correspondantes</h2><div className="space-y-1">{lyricsTracks.map((t, i) => <TrackRow key={t.id} track={t} index={i + 1} showAlbum onPlay={() => playTrack(t.id)} />)}</div></section>}
          {best?.item && filter === "tout" && (
            <section>
              <h2 className="mb-4 text-xl font-bold tracking-tight text-hi">Meilleur résultat</h2>
              <motion.button
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                whileHover={{ y: -3 }}
                onClick={bestClick}
                className="glass group flex w-full max-w-md items-center gap-4 rounded-2xl p-4 text-left"
              >
                <CoverArt
                  colors={(best.item as { colors: import("../../types").AlbumColors }).colors}
                  seed={(best.item as { id: string }).id}
                  size={88}
                  rounded={best.kind === "artist" ? "rounded-full" : "rounded-xl"}
                  className="h-22 w-22 shrink-0"
                />
                <div className="min-w-0">
                  <div className="truncate text-lg font-bold text-hi">
                    {"title" in best.item ? best.item.title : "name" in best.item ? best.item.name : ""}
                  </div>
                  <div className="mt-1 text-xs uppercase tracking-wide text-mid">
                    {best.kind === "track" ? "Titre" : best.kind === "album" ? "Album" : best.kind === "artist" ? "Artiste" : "Playlist"}
                  </div>
                </div>
                <span
                  className="ml-auto grid h-11 w-11 shrink-0 place-items-center rounded-full text-white opacity-0 transition-opacity group-hover:opacity-100"
                  style={{ background: "var(--accent)" }}
                >
                  <Play size={18} fill="currentColor" />
                </span>
              </motion.button>
            </section>
          )}

          {show("titres") && tracks.length > 0 && (
            <section>
              <h2 className="mb-3 text-xl font-bold tracking-tight text-hi">Titres</h2>
              <div className="space-y-1">
                {tracks.map((t, i) => (
                  <div key={t.id} className={cn("rounded-xl", i === highlight && "ring-1 ring-white/20")}>
                    <TrackRow track={t} index={i + 1} showAlbum onPlay={() => playTrack(t.id)} />
                  </div>
                ))}
              </div>
            </section>
          )}

          {show("albums") && !!results?.albums.length && (
            <section>
              <h2 className="mb-4 text-xl font-bold tracking-tight text-hi">Albums</h2>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-6">
                {results?.albums.map((a) => (
                  <AlbumCard key={a.id} album={a} />
                ))}
              </div>
            </section>
          )}

          {show("artistes") && !!results?.artists.length && (
            <section>
              <h2 className="mb-4 text-xl font-bold tracking-tight text-hi">Artistes</h2>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-6">
                {results?.artists.map((a) => (
                  <ArtistCard key={a.id} artist={a} />
                ))}
              </div>
            </section>
          )}

          {show("playlists") && !!results?.playlists.length && (
            <section>
              <h2 className="mb-4 text-xl font-bold tracking-tight text-hi">Playlists</h2>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-6">
                {results?.playlists.map((p) => (
                  <PlaylistCard key={p.id} playlist={p} />
                ))}
              </div>
            </section>
          )}
        </div>
      ) : null}
    </div>
  )
}
