import { useEffect, useMemo, useRef, useState } from "react"
import { motion } from "framer-motion"
import { useVirtualizer } from "@tanstack/react-virtual"
import { Play, Shuffle, Heart, ArrowUp, ArrowDown, SlidersHorizontal, Check, Search, Sparkles, BookmarkPlus, Trash2 } from "lucide-react"
import type { Track, SortSpec } from "../../types"
import { backend } from "../../services"
import CoverArt from "../../components/CoverArt"
import EqualizerBars from "../../components/EqualizerBars"
import { RowsSkeleton } from "../../components/Skeleton"
import { useOpenMenu } from "../../components/TrackContextMenu"
import { usePlaybackActions } from "../../hooks/usePlaybackActions"
import { usePlayer } from "../../store/playerStore"
import { useLibrary } from "../../store/libraryStore"
import { useSettings } from "../../store/settingsStore"
import { formatTime, formatCount } from "../../utils/format"
import { cn } from "../../utils/cn"

type ColKey = "index" | "title" | "artist" | "album" | "year" | "genre" | "duration" | "plays" | "fav"

interface Col {
  key: ColKey
  label: string
  sortKey?: string
  width: string
  hideable: boolean
  align?: "right"
}

const COLS: Col[] = [
  { key: "index", label: "#", width: "44px", hideable: false },
  { key: "title", label: "Titre", sortKey: "title", width: "minmax(220px,3fr)", hideable: false },
  { key: "artist", label: "Artiste", sortKey: "artist", width: "minmax(140px,2fr)", hideable: true },
  { key: "album", label: "Album", sortKey: "album", width: "minmax(140px,2fr)", hideable: true },
  { key: "year", label: "Année", sortKey: "year", width: "72px", hideable: true },
  { key: "genre", label: "Genre", sortKey: "genre", width: "120px", hideable: true },
  { key: "duration", label: "Durée", sortKey: "durationMs", width: "80px", hideable: true, align: "right" },
  { key: "plays", label: "Écoutes", sortKey: "plays", width: "84px", hideable: true, align: "right" },
  { key: "fav", label: "", width: "44px", hideable: false },
]

const ROW_H = 52
type View = "all" | "unplayed" | "recent" | "hires" | "duplicates"
const VIEWS: { id: View; label: string }[] = [
  { id: "all", label: "Tous" }, { id: "unplayed", label: "Jamais écoutés" },
  { id: "recent", label: "Ajoutés récemment" }, { id: "hires", label: "Haute résolution" },
  { id: "duplicates", label: "Doublons possibles" },
]

export default function Tracks() {
  const [tracks, setTracks] = useState<Track[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [lastIndex, setLastIndex] = useState<number | null>(null)
  const [hidden, setHidden] = useState<Set<ColKey>>(new Set())
  const [menuOpen, setMenuOpen] = useState(false)
  const [view, setView] = useState<View>("all")
  const [query, setQuery] = useState("")
  const [genre, setGenre] = useState("")
  const [quality, setQuality] = useState("")
  const [savingView, setSavingView] = useState(false)
  const [viewName, setViewName] = useState("")
  const [savedId, setSavedId] = useState("")

  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)
  const sort: SortSpec = settings?.tracksSort ?? { key: "title", dir: "asc" }

  const currentId = usePlayer((s) => s.currentTrackId)
  const status = usePlayer((s) => s.status)
  const favorites = useLibrary((s) => s.favorites)
  const toggleFav = useLibrary((s) => s.toggleFavorite)
  const openMenu = useOpenMenu()
  const actions = usePlaybackActions()
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
    setSelected(new Set())
  }, [view, query, genre, quality])

  useEffect(() => {
    let alive = true
    setLoading(true)
    backend.library.getTracks("", sort, { offset: 0, limit: 100000 }).then((res) => {
      if (!alive) return
      setTracks(res.items)
      setLoading(false)
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort.key, sort.dir])

  const duplicateIds = useMemo(() => {
    const groups = new Map<string, Track[]>()
    for (const t of tracks) {
      const key = `${t.artist.toLocaleLowerCase("fr").trim()}|${t.title.toLocaleLowerCase("fr").trim()}`
      const group = groups.get(key) ?? []
      group.push(t)
      groups.set(key, group)
    }
    const result = new Set<string>()
    for (const group of groups.values()) {
      group.sort((a, b) => a.durationMs - b.durationMs)
      for (let i = 1; i < group.length; i++) {
        if (group[i].durationMs - group[i - 1].durationMs <= 2000) {
          result.add(group[i].id)
          result.add(group[i - 1].id)
        }
      }
    }
    return result
  }, [tracks])
  const genres = useMemo(() => [...new Set(tracks.map((t) => t.genre).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr")), [tracks])
  const visibleTracks = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("fr")
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
    return tracks.filter((t) => {
      if (view === "unplayed" && t.plays > 0) return false
      if (view === "recent" && t.addedAt < cutoff) return false
      if (view === "hires" && t.quality !== "Hi-Res") return false
      if (view === "duplicates" && !duplicateIds.has(t.id)) return false
      if (genre && t.genre !== genre) return false
      if (quality && t.quality !== quality) return false
      return !q || `${t.title} ${t.artist} ${t.album}`.toLocaleLowerCase("fr").includes(q)
    })
  }, [tracks, view, duplicateIds, genre, quality, query])
  const ids = useMemo(() => visibleTracks.map((t) => t.id), [visibleTracks])
  const cols = useMemo(() => COLS.filter((c) => !hidden.has(c.key)), [hidden])
  const gridTemplate = cols.map((c) => c.width).join(" ")

  const virtualizer = useVirtualizer({
    count: visibleTracks.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 12,
  })

  const toggleSort = (sortKey?: string) => {
    if (!sortKey) return
    const dir = sort.key === sortKey && sort.dir === "asc" ? "desc" : "asc"
    update({ tracksSort: { key: sortKey, dir } })
  }

  const onRowClick = (e: React.MouseEvent, index: number, id: string) => {
    const next = new Set(selected)
    if (e.shiftKey && lastIndex !== null) {
      const [a, b] = [Math.min(lastIndex, index), Math.max(lastIndex, index)]
      for (let i = a; i <= b; i++) next.add(visibleTracks[i].id)
    } else if (e.metaKey || e.ctrlKey) {
      next.has(id) ? next.delete(id) : next.add(id)
      setLastIndex(index)
    } else {
      next.clear()
      next.add(id)
      setLastIndex(index)
    }
    setSelected(next)
  }

  const toggleHidden = (key: ColKey) => {
    const next = new Set(hidden)
    next.has(key) ? next.delete(key) : next.add(key)
    setHidden(next)
  }

  const dragIds = (id: string) => (selected.has(id) && selected.size > 1 ? Array.from(selected) : [id])
  const saveView = () => {
    const name = viewName.trim()
    if (!name) return
    const item = { id: `sv_${Date.now()}`, name, view, query, genre, quality }
    void update({ smartViews: [...(settings?.smartViews ?? []), item] })
    setSavedId(item.id)
    setViewName("")
    setSavingView(false)
  }
  const selectSaved = (id: string) => {
    setSavedId(id)
    const item = settings?.smartViews.find((v) => v.id === id)
    if (!item) return
    setView(item.view)
    setQuery(item.query)
    setGenre(item.genre)
    setQuality(item.quality)
    setSelected(new Set())
    scrollRef.current?.scrollTo({ top: 0 })
  }

  return (
    <div className="flex h-full flex-col p-8 pb-4">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-hi">Titres</h1>
          <p className="mt-1 text-sm text-mid">{formatCount(visibleTracks.length)} sur {formatCount(tracks.length)} titres{selected.size > 0 ? ` · ${selected.size} sélectionné(s)` : ""}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            disabled={!ids.length}
            onClick={() => ids.length && actions.playContext(ids, 0)}
            className="focus-ring flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold text-white transition-transform active:scale-95 disabled:opacity-40"
            style={{ background: "var(--accent)" }}
          >
            <Play size={16} fill="currentColor" /> Tout lire
          </button>
          <button
            disabled={!ids.length}
            onClick={() => ids.length && actions.playContext([...ids].sort(() => Math.random() - 0.5), 0)}
            className="glass focus-ring flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold text-hi transition-transform active:scale-95 disabled:opacity-40"
          >
            <Shuffle size={16} /> Lecture aléatoire
          </button>
          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="glass focus-ring grid h-10 w-10 place-items-center rounded-full text-mid hover:text-hi"
              aria-label="Colonnes"
            >
              <SlidersHorizontal size={16} />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                <div className="glass-panel absolute right-0 z-50 mt-2 w-52 rounded-2xl p-2 shadow-2xl">
                  <div className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-lo">Colonnes</div>
                  {COLS.filter((c) => c.hideable).map((c) => (
                    <button
                      key={c.key}
                      onClick={() => toggleHidden(c.key)}
                      className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-sm text-hi hover:bg-white/8"
                    >
                      {c.label}
                      {!hidden.has(c.key) && <Check size={15} style={{ color: "var(--accent)" }} />}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="mb-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2" aria-label="Vues intelligentes">
          <Sparkles size={16} className="mr-1 text-mid" />
          {VIEWS.map((item) => <button key={item.id} onClick={() => { setView(item.id); setSavedId(""); setSelected(new Set()); scrollRef.current?.scrollTo({ top: 0 }) }} className={cn("focus-ring rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors", view === item.id ? "border-[var(--accent)] bg-[var(--accent)] text-white" : "border-[var(--glass-border)] text-mid hover:text-hi")}>{item.label}</button>)}
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="flex min-w-48 flex-1 items-center gap-2 rounded-xl border border-[var(--glass-border)] bg-white/5 px-3"><Search size={16} className="text-lo" /><input value={query} onChange={(e) => { setQuery(e.target.value); setSavedId("") }} placeholder="Filtrer les titres…" aria-label="Filtrer les titres" className="w-full bg-transparent py-2 text-sm text-hi outline-none placeholder:text-lo" /></label>
          <select value={genre} onChange={(e) => { setGenre(e.target.value); setSavedId("") }} aria-label="Filtrer par genre" className="focus-ring rounded-xl border border-[var(--glass-border)] bg-[var(--bg-1)] px-3 text-sm text-hi"><option value="">Tous les genres</option>{genres.map((g) => <option key={g} value={g}>{g}</option>)}</select>
          <select value={quality} onChange={(e) => { setQuality(e.target.value); setSavedId("") }} aria-label="Filtrer par qualité" className="focus-ring rounded-xl border border-[var(--glass-border)] bg-[var(--bg-1)] px-3 text-sm text-hi"><option value="">Toutes les qualités</option><option value="Hi-Res">Hi-Res</option><option value="Lossless">Lossless</option><option value="Lossy">Lossy</option></select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={savedId} onChange={(e) => selectSaved(e.target.value)} aria-label="Vues enregistrées" className="focus-ring rounded-xl border border-[var(--glass-border)] bg-[var(--bg-1)] px-3 py-2 text-xs text-hi"><option value="">Vues enregistrées</option>{(settings?.smartViews ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
          {savedId && <button onClick={() => { void update({ smartViews: (settings?.smartViews ?? []).filter((v) => v.id !== savedId) }); setSavedId("") }} aria-label="Supprimer la vue enregistrée" className="focus-ring rounded-xl border border-[var(--glass-border)] p-2 text-mid hover:text-red-400"><Trash2 size={15} /></button>}
          {savingView ? <form onSubmit={(e) => { e.preventDefault(); saveView() }} className="flex items-center gap-2"><input autoFocus value={viewName} onChange={(e) => setViewName(e.target.value)} placeholder="Nom de la vue" aria-label="Nom de la vue" className="focus-ring rounded-xl border border-[var(--glass-border)] bg-white/5 px-3 py-2 text-xs text-hi outline-none" /><button type="submit" className="rounded-xl bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-white">Enregistrer</button><button type="button" onClick={() => setSavingView(false)} className="text-xs text-mid">Annuler</button></form> : <button onClick={() => setSavingView(true)} className="focus-ring flex items-center gap-1.5 rounded-xl border border-[var(--glass-border)] px-3 py-2 text-xs text-mid hover:text-hi"><BookmarkPlus size={15} /> Enregistrer ces filtres</button>}
        </div>
      </div>

      {loading ? (
        <RowsSkeleton count={16} />
      ) : (
        <div className="glass-panel flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl">
          <div
            className="grid shrink-0 items-center gap-3 border-b border-white/8 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-mid"
            style={{ gridTemplateColumns: gridTemplate }}
          >
            {cols.map((c) => (
              <button
                key={c.key}
                onClick={() => toggleSort(c.sortKey)}
                disabled={!c.sortKey}
                className={cn(
                  "flex items-center gap-1 truncate",
                  c.align === "right" && "justify-end",
                  c.sortKey ? "hover:text-hi" : "cursor-default",
                  sort.key === c.sortKey && "text-hi",
                )}
              >
                {c.key === "fav" ? <Heart size={13} /> : c.label}
                {sort.key === c.sortKey && (sort.dir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
              </button>
            ))}
          </div>

          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
            {visibleTracks.length === 0 && <div className="grid h-full place-items-center px-6 text-center text-sm text-mid">Aucun titre ne correspond à ces filtres.</div>}
            <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
              {virtualizer.getVirtualItems().map((vi) => {
                const track = visibleTracks[vi.index]
                const isCurrent = currentId === track.id
                const playing = isCurrent && status === "playing"
                const isSel = selected.has(track.id)
                const isFav = favorites.has(track.id) || track.favorite
                return (
                  <div
                    key={track.id}
                    className={cn(
                      "group absolute left-0 top-0 grid w-full cursor-default items-center gap-3 px-4 transition-colors",
                      isSel ? "bg-white/10" : "hover:bg-white/6",
                    )}
                    style={{ height: ROW_H, transform: `translateY(${vi.start}px)`, gridTemplateColumns: gridTemplate }}
                    onClick={(e) => onRowClick(e, vi.index, track.id)}
                    onDoubleClick={() => actions.playContext(ids, vi.index)}
                    onContextMenu={(e) =>
                      openMenu(e, "track", track.id, isSel && selected.size > 1 ? Array.from(selected) : undefined)
                    }
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData("application/x-track-ids", JSON.stringify(dragIds(track.id)))}
                  >
                    {cols.map((c) => {
                      switch (c.key) {
                        case "index":
                          return (
                            <div key={c.key} className="grid place-items-center text-sm text-lo tnum">
                              {playing ? (
                                <EqualizerBars playing size={14} />
                              ) : (
                                <>
                                  <span className="group-hover:hidden" style={isCurrent ? { color: "var(--accent)" } : undefined}>
                                    {vi.index + 1}
                                  </span>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      actions.playContext(ids, vi.index)
                                    }}
                                    className="hidden text-hi group-hover:block"
                                    aria-label="Lire"
                                  >
                                    <Play size={14} fill="currentColor" />
                                  </button>
                                </>
                              )}
                            </div>
                          )
                        case "title":
                          return (
                            <div key={c.key} className="flex min-w-0 items-center gap-3">
                              <CoverArt colors={track.colors} seed={track.albumId} size={36} rounded="rounded-md" className="h-9 w-9 shrink-0" />
                              <span
                                className="truncate text-sm font-medium text-hi"
                                style={isCurrent ? { color: "var(--accent)" } : undefined}
                              >
                                {track.title}
                              </span>
                            </div>
                          )
                        case "artist":
                          return <span key={c.key} className="truncate text-sm text-mid">{track.artist}</span>
                        case "album":
                          return <span key={c.key} className="truncate text-sm text-mid">{track.album}</span>
                        case "year":
                          return <span key={c.key} className="text-sm text-mid tnum">{track.year}</span>
                        case "genre":
                          return <span key={c.key} className="truncate text-sm text-mid">{track.genre}</span>
                        case "duration":
                          return <span key={c.key} className="text-right text-sm text-lo tnum">{formatTime(track.durationMs)}</span>
                        case "plays":
                          return <span key={c.key} className="text-right text-sm text-lo tnum">{formatCount(track.plays)}</span>
                        case "fav":
                          return (
                            <button
                              key={c.key}
                              onClick={(e) => {
                                e.stopPropagation()
                                toggleFav(track.id)
                              }}
                              className={cn("grid place-items-center transition-opacity", isFav ? "opacity-100" : "opacity-0 group-hover:opacity-100")}
                              aria-label={isFav ? "Retirer des favoris" : "Ajouter aux favoris"}
                            >
                              <Heart size={15} className={isFav ? "" : "text-mid"} style={isFav ? { color: "var(--accent)", fill: "var(--accent)" } : undefined} />
                            </button>
                          )
                        default:
                          return null
                      }
                    })}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
