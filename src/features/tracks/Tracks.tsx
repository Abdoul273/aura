import { useEffect, useMemo, useRef, useState } from "react"
import { motion } from "framer-motion"
import { useVirtualizer } from "@tanstack/react-virtual"
import { Play, Shuffle, Heart, ArrowUp, ArrowDown, SlidersHorizontal, Check } from "lucide-react"
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

export default function Tracks() {
  const [tracks, setTracks] = useState<Track[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [lastIndex, setLastIndex] = useState<number | null>(null)
  const [hidden, setHidden] = useState<Set<ColKey>>(new Set())
  const [menuOpen, setMenuOpen] = useState(false)

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

  const ids = useMemo(() => tracks.map((t) => t.id), [tracks])
  const cols = useMemo(() => COLS.filter((c) => !hidden.has(c.key)), [hidden])
  const gridTemplate = cols.map((c) => c.width).join(" ")

  const virtualizer = useVirtualizer({
    count: tracks.length,
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
      for (let i = a; i <= b; i++) next.add(tracks[i].id)
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

  return (
    <div className="flex h-full flex-col p-8 pb-4">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-hi">Titres</h1>
          <p className="mt-1 text-sm text-mid">{formatCount(tracks.length)} titres{selected.size > 0 ? ` · ${selected.size} sélectionné(s)` : ""}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => ids.length && actions.playContext(ids, 0)}
            className="focus-ring flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold text-white transition-transform active:scale-95"
            style={{ background: "var(--accent)" }}
          >
            <Play size={16} fill="currentColor" /> Tout lire
          </button>
          <button
            onClick={() => ids.length && actions.playContext([...ids].sort(() => Math.random() - 0.5), 0)}
            className="glass focus-ring flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold text-hi transition-transform active:scale-95"
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
            <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
              {virtualizer.getVirtualItems().map((vi) => {
                const track = tracks[vi.index]
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
