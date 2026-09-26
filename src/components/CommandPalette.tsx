import { useEffect, useMemo, useRef, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Search, Shuffle, SlidersHorizontal, Radio, BarChart3, Settings as Cog, Play, Disc3, User, Music2 } from "lucide-react"
import { useUI } from "../store/uiStore"
import { backend } from "../services"
import type { SearchResults } from "../services"
import { usePlaybackActions } from "../hooks/usePlaybackActions"

interface Command {
  id: string
  label: string
  icon: any
  hint?: string
  run: () => void
}

export default function CommandPalette() {
  const open = useUI((s) => s.commandOpen)
  const setOpen = useUI((s) => s.setCommandOpen)
  const navigate = useUI((s) => s.navigate)
  const actions = usePlaybackActions()
  const [q, setQ] = useState("")
  const [results, setResults] = useState<SearchResults | null>(null)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const staticCommands: Command[] = useMemo(
    () => [
      { id: "shuffle-all", label: "Lecture aléatoire de tout", icon: Shuffle, run: async () => {
          const { items } = await backend.library.getTracks("", { key: "title", dir: "asc" }, { offset: 0, limit: 500 })
          const ids = items.map((t) => t.id).sort(() => Math.random() - 0.5)
          actions.playContext(ids, 0)
        } },
      { id: "go-eq", label: "Ouvrir l'égaliseur", icon: SlidersHorizontal, run: () => navigate({ name: "equalizer" }) },
      { id: "go-radio", label: "Ouvrir les radios", icon: Radio, run: () => navigate({ name: "radios" }) },
      { id: "go-stats", label: "Voir les statistiques", icon: BarChart3, run: () => navigate({ name: "stats" }) },
      { id: "go-settings", label: "Ouvrir les paramètres", icon: Cog, run: () => navigate({ name: "settings" }) },
    ],
    [navigate],
  )

  useEffect(() => {
    if (open) {
      setQ("")
      setResults(null)
      setActive(0)
      setTimeout(() => inputRef.current?.focus(), 20)
    }
  }, [open])

  useEffect(() => {
    if (!q.trim()) {
      setResults(null)
      return
    }
    let cancel = false
    backend.library.search(q).then((r) => !cancel && setResults(r))
    return () => {
      cancel = true
    }
  }, [q])

  const filteredCommands = staticCommands.filter((c) => c.label.toLowerCase().includes(q.toLowerCase()))
  const flat: Command[] = useMemo(() => {
    const list: Command[] = [...filteredCommands]
    if (results) {
      results.tracks.slice(0, 5).forEach((t) =>
        list.push({ id: "t" + t.id, label: t.title, hint: t.artist, icon: Music2, run: () => actions.playContext([t.id], 0) }),
      )
      results.albums.slice(0, 4).forEach((a) =>
        list.push({ id: "a" + a.id, label: a.title, hint: a.artist, icon: Disc3, run: () => navigate({ name: "album", id: a.id }) }),
      )
      results.artists.slice(0, 4).forEach((ar) =>
        list.push({ id: "ar" + ar.id, label: ar.name, hint: "Artiste", icon: User, run: () => navigate({ name: "artist", id: ar.id }) }),
      )
    }
    return list
  }, [filteredCommands, results])

  const runAt = (i: number) => {
    const cmd = flat[i]
    if (cmd) {
      cmd.run()
      setOpen(false)
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[140] flex items-start justify-center p-6 pt-[12vh]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: -12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -12 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="glass-panel relative z-10 w-full max-w-xl overflow-hidden rounded-3xl"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault()
                setActive((a) => Math.min(a + 1, flat.length - 1))
              } else if (e.key === "ArrowUp") {
                e.preventDefault()
                setActive((a) => Math.max(a - 1, 0))
              } else if (e.key === "Enter") {
                e.preventDefault()
                runAt(active)
              }
            }}
          >
            <div className="flex items-center gap-3 border-b border-[var(--glass-border)] px-5 py-4">
              <Search size={18} className="text-lo" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => {
                  setQ(e.target.value)
                  setActive(0)
                }}
                placeholder="Rechercher ou taper une commande…"
                className="flex-1 bg-transparent text-base text-hi placeholder:text-lo focus:outline-none"
              />
              <kbd className="rounded-md bg-white/8 px-2 py-0.5 text-xs text-lo">Échap</kbd>
            </div>
            <div className="max-h-[50vh] overflow-auto p-2">
              {flat.length === 0 && <div className="px-4 py-8 text-center text-sm text-lo">Aucun résultat</div>}
              {flat.map((c, i) => (
                <button
                  key={c.id}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => runAt(i)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${i === active ? "bg-white/10 text-hi" : "text-mid"}`}
                >
                  <c.icon size={16} className="shrink-0" />
                  <span className="flex-1 truncate">{c.label}</span>
                  {c.hint && <span className="truncate text-xs text-lo">{c.hint}</span>}
                  {i === active && <Play size={13} className="text-lo" />}
                </button>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
