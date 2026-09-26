import { ChevronLeft, ChevronRight, Search, Settings as Cog, Loader2 } from "lucide-react"
import { useUI } from "../../store/uiStore"
import { useLibrary } from "../../store/libraryStore"
import IconButton from "../../components/IconButton"
import { motion } from "framer-motion"

export default function TopBar() {
  const { back, forward, canBack, canForward, navigate, setCommandOpen } = useUI()
  const scan = useLibrary((s) => s.scan)

  return (
    // data-tauri-drag-region : la barre sert de poignée quand la fenêtre est flottante.
    <header data-tauri-drag-region className="flex items-center gap-3 px-1 py-3">
      <div className="flex items-center gap-1">
        <IconButton label="Précédent" onClick={back} disabled={!canBack} size={36} className="disabled:opacity-30">
          <ChevronLeft size={20} />
        </IconButton>
        <IconButton label="Suivant" onClick={forward} disabled={!canForward} size={36} className="disabled:opacity-30">
          <ChevronRight size={20} />
        </IconButton>
      </div>

      <button
        onClick={() => setCommandOpen(true)}
        className="focus-ring glass flex h-10 max-w-md flex-1 items-center gap-3 rounded-full px-4 text-left text-sm text-lo transition-colors hover:text-mid"
      >
        <Search size={16} />
        <span className="flex-1">Rechercher un titre, un album, un artiste…</span>
        <kbd className="rounded-md bg-white/8 px-2 py-0.5 text-xs">Ctrl K</kbd>
      </button>

      <div className="flex-1" />

      {scan.scanning && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass flex items-center gap-2 rounded-full px-3 py-1.5 text-xs text-mid">
          <Loader2 size={14} className="animate-spin" style={{ color: "var(--accent)" }} />
          <span className="tnum">Analyse {scan.current}/{scan.total}</span>
        </motion.div>
      )}

      <IconButton label="Paramètres" onClick={() => navigate({ name: "settings" })} size={36}>
        <Cog size={19} />
      </IconButton>
    </header>
  )
}
