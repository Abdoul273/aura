import { useEffect, useMemo, useRef, useState } from "react"
import { motion } from "framer-motion"
import { Disc3 } from "lucide-react"
import type { Album } from "../../types"
import { AlbumCard } from "../../components/cards"
import { CardGridSkeleton } from "../../components/Skeleton"
import EmptyState from "../../components/EmptyState"
import { useLibrary } from "../../store/libraryStore"
import { cn } from "../../utils/cn"
import { formatCount } from "../../utils/format"

type SortKey = "title" | "artist" | "year" | "recent"

const SORTS: { key: SortKey; label: string }[] = [
  { key: "title", label: "Titre" },
  { key: "artist", label: "Artiste" },
  { key: "year", label: "Année" },
  { key: "recent", label: "Récent" },
]

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ#".split("")

function firstLetter(s: string): string {
  const c = s.trim().charAt(0).toUpperCase()
  return /[A-Z]/.test(c) ? c : "#"
}

function Select<T extends string>({ value, onChange, options, placeholder }: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  placeholder?: string
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="glass focus-ring rounded-full px-4 py-2 text-sm font-medium text-hi outline-none"
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-neutral-900">
          {o.label}
        </option>
      ))}
    </select>
  )
}

export default function Albums() {
  const albums = useLibrary((s) => s.albums)
  const loaded = useLibrary((s) => s.albumsLoaded)
  const loadAlbums = useLibrary((s) => s.loadAlbums)

  const [sortKey, setSortKey] = useState<SortKey>("title")
  const [fArtist, setFArtist] = useState("")
  const [fYear, setFYear] = useState("")
  const [fGenre, setFGenre] = useState("")
  const [fQuality, setFQuality] = useState("")
  const gridRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!loaded) loadAlbums()
  }, [loaded, loadAlbums])

  const artists = useMemo(() => [...new Set(albums.map((a) => a.artist))].sort(), [albums])
  const years = useMemo(() => [...new Set(albums.map((a) => a.year))].sort((a, b) => b - a).map(String), [albums])
  const genres = useMemo(() => [...new Set(albums.map((a) => a.genre))].sort(), [albums])
  const qualities = useMemo(() => [...new Set(albums.map((a) => a.quality))], [albums])

  const filtered = useMemo(() => {
    let list = albums.filter(
      (a) =>
        (!fArtist || a.artist === fArtist) &&
        (!fYear || String(a.year) === fYear) &&
        (!fGenre || a.genre === fGenre) &&
        (!fQuality || a.quality === fQuality),
    )
    const sorters: Record<SortKey, (a: Album, b: Album) => number> = {
      title: (a, b) => a.title.localeCompare(b.title, "fr"),
      artist: (a, b) => a.artist.localeCompare(b.artist, "fr") || a.year - b.year,
      year: (a, b) => b.year - a.year,
      recent: (a, b) => b.addedAt - a.addedAt,
    }
    return [...list].sort(sorters[sortKey])
  }, [albums, fArtist, fYear, fGenre, fQuality, sortKey])

  const scrollToLetter = (letter: string) => {
    const el = gridRef.current
    if (!el) return
    const idx = filtered.findIndex((a) => firstLetter(a.title) === letter)
    if (idx < 0) return
    const target = el.querySelector<HTMLElement>(`[data-idx="${idx}"]`)
    target?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  const activeLetters = useMemo(() => new Set(filtered.map((a) => firstLetter(a.title))), [filtered])

  return (
    <div className="p-8 pb-8">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight text-hi">Albums</h1>
        <p className="mt-1 text-sm text-mid">{formatCount(filtered.length)} albums</p>
      </header>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Select value={sortKey} onChange={setSortKey} options={SORTS.map((s) => ({ value: s.key, label: s.label }))} />
        <Select value={fArtist} onChange={setFArtist} placeholder="Tous les artistes" options={artists.map((a) => ({ value: a, label: a }))} />
        <Select value={fYear} onChange={setFYear} placeholder="Toutes les années" options={years.map((y) => ({ value: y, label: y }))} />
        <Select value={fGenre} onChange={setFGenre} placeholder="Tous les genres" options={genres.map((g) => ({ value: g, label: g }))} />
        <Select value={fQuality} onChange={setFQuality} placeholder="Tous les formats" options={qualities.map((q) => ({ value: q, label: q }))} />
      </div>

      {!loaded ? (
        <CardGridSkeleton count={18} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Disc3 size={40} />}
          title="Aucun album"
          description="Aucun album ne correspond à vos filtres. Essayez de les réinitialiser."
          action={{ label: "Réinitialiser", onClick: () => { setFArtist(""); setFYear(""); setFGenre(""); setFQuality("") } }}
        />
      ) : (
        <div className="relative">
          <div ref={gridRef} className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-6 pr-8">
            {filtered.map((a, i) => (
              <motion.div
                key={a.id}
                data-idx={i}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i, 20) * 0.02 }}
              >
                <AlbumCard album={a} />
              </motion.div>
            ))}
          </div>

          {sortKey === "title" && (
            <div className="fixed right-3 top-1/2 z-20 flex -translate-y-1/2 flex-col items-center gap-0.5">
              {LETTERS.map((l) => {
                const active = activeLetters.has(l)
                return (
                  <button
                    key={l}
                    onClick={() => active && scrollToLetter(l)}
                    disabled={!active}
                    className={cn(
                      "text-[10px] font-semibold leading-none transition-colors",
                      active ? "text-mid hover:text-hi" : "text-lo/40 cursor-default",
                    )}
                  >
                    {l}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
