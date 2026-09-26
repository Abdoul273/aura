import { useEffect, useRef } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Play, ListPlus, ListEnd, FolderOpen, Disc3, User, Heart, Info, Plus } from "lucide-react"
import { useUI } from "../store/uiStore"
import { usePlaybackActions } from "../hooks/usePlaybackActions"
import { usePlayer } from "../store/playerStore"

export default function TrackContextMenu() {
  const menu = useUI((s) => s.contextMenu)
  const close = useUI((s) => s.closeContextMenu)
  const setAddTo = useUI((s) => s.setAddToPlaylistFor)
  const setProps = useUI((s) => s.setPropertiesTrackId)
  const actions = usePlaybackActions()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close()
    window.addEventListener("mousedown", onDown)
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("mousedown", onDown)
      window.removeEventListener("keydown", onKey)
    }
  }, [menu, close])

  if (!menu) return null
  const ids = menu.trackIds ?? [menu.id]
  const primaryTrack = menu.kind === "track" ? menu.id : ids[0]

  const items: { icon: any; label: string; onClick: () => void; danger?: boolean; sub?: boolean }[] = [
    { icon: Play, label: "Lire", onClick: () => actions.playContext(ids, 0) },
    { icon: ListPlus, label: "Lire ensuite", onClick: () => actions.playNext(ids) },
    { icon: ListEnd, label: "Ajouter à la file", onClick: () => actions.addToQueue(ids) },
    { icon: Plus, label: "Ajouter à une playlist…", onClick: () => setAddTo(ids), sub: true },
  ]
  if (menu.kind === "track" || menu.kind === "album") {
    items.push({ icon: Disc3, label: "Aller à l'album", onClick: () => actions.goToAlbum(primaryTrack) })
    items.push({ icon: User, label: "Aller à l'artiste", onClick: () => actions.goToArtist(primaryTrack) })
  }
  if (menu.kind === "track") {
    items.push({ icon: Heart, label: "J'aime", onClick: () => actions.toggleFavorite(menu.id) })
    items.push({ icon: FolderOpen, label: "Afficher dans le dossier", onClick: () => actions.openInFileManager(primaryTrack) })
    items.push({ icon: Info, label: "Propriétés", onClick: () => setProps(menu.id) })
  }

  const maxX = window.innerWidth - 240
  const maxY = window.innerHeight - items.length * 40 - 24

  return (
    <AnimatePresence>
      <motion.div
        key="ctx"
        ref={ref}
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.94 }}
        transition={{ duration: 0.12 }}
        className="glass fixed z-[100] w-56 origin-top-left rounded-2xl p-1.5"
        style={{ left: Math.min(menu.x, maxX), top: Math.min(menu.y, maxY) }}
      >
        {menu.trackIds && menu.trackIds.length > 1 && (
          <div className="px-3 py-1.5 text-xs text-lo">{menu.trackIds.length} titres sélectionnés</div>
        )}
        {items.map((it, i) => (
          <button
            key={i}
            onClick={() => {
              it.onClick()
              close()
            }}
            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors hover:bg-white/8 ${it.danger ? "text-red-400" : "text-mid hover:text-hi"}`}
          >
            <it.icon size={16} />
            <span className="flex-1">{it.label}</span>
            {it.sub && <span className="text-lo">›</span>}
          </button>
        ))}
      </motion.div>
    </AnimatePresence>
  )
}

// helper to wire onContextMenu on any element
export function useOpenMenu() {
  const open = useUI((s) => s.openContextMenu)
  const currentIsPlaying = usePlayer((s) => s.status === "playing")
  void currentIsPlaying
  return (e: React.MouseEvent, kind: "track" | "album" | "artist" | "playlist", id: string, trackIds?: string[]) => {
    e.preventDefault()
    e.stopPropagation()
    open({ x: e.clientX, y: e.clientY, kind, id, trackIds })
  }
}
