import { useEffect, useState } from "react"
import { motion } from "framer-motion"
import { ChevronRight, Folder, FolderOpen, Music, Play } from "lucide-react"
import type { FolderNode } from "../../types"
import { backend, getTrackSync } from "../../services"
import { usePlaybackActions } from "../../hooks/usePlaybackActions"
import { useOpenMenu } from "../../components/TrackContextMenu"
import { usePlayer } from "../../store/playerStore"
import { RowsSkeleton } from "../../components/Skeleton"
import { cn } from "../../utils/cn"

function collectTrackIds(node: FolderNode): string[] {
  if (node.type === "file") return node.trackId ? [node.trackId] : []
  return (node.children ?? []).flatMap(collectTrackIds)
}

function FolderRow({ node, depth, defaultOpen }: { node: FolderNode; depth: number; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen)
  const actions = usePlaybackActions()
  const openMenu = useOpenMenu()
  const currentId = usePlayer((s) => s.currentTrackId)
  const indent = { paddingLeft: 12 + depth * 18 }

  if (node.type === "file") {
    const isCurrent = node.trackId ? currentId === node.trackId : false
    const track = node.trackId ? getTrackSync(node.trackId) : undefined
    return (
      <div
        onDoubleClick={() => node.trackId && actions.playContext([node.trackId], 0)}
        onContextMenu={(e) => node.trackId && openMenu(e, "track", node.trackId)}
        style={indent}
        className={cn(
          "group flex cursor-default items-center gap-2.5 rounded-lg py-1.5 pr-3 transition-colors",
          isCurrent ? "bg-white/8" : "hover:bg-white/6",
        )}
      >
        <Music size={15} className="shrink-0" style={isCurrent ? { color: "var(--accent)" } : { color: "var(--text-lo)" }} />
        <span className={cn("truncate text-sm", isCurrent ? "" : "text-mid group-hover:text-hi")} style={isCurrent ? { color: "var(--accent)" } : undefined}>
          {track?.title ?? node.name}
        </span>
      </div>
    )
  }

  const descendantIds = collectTrackIds(node)

  return (
    <div>
      <div
        onClick={() => setOpen((o) => !o)}
        style={indent}
        className="group flex cursor-pointer items-center gap-2 rounded-lg py-1.5 pr-3 transition-colors hover:bg-white/6"
      >
        <motion.span animate={{ rotate: open ? 90 : 0 }} className="shrink-0 text-lo">
          <ChevronRight size={15} />
        </motion.span>
        {open ? (
          <FolderOpen size={16} className="shrink-0" style={{ color: "var(--accent)" }} />
        ) : (
          <Folder size={16} className="shrink-0 text-mid" />
        )}
        <span className="truncate text-sm font-medium text-hi">{node.name}</span>
        <span className="ml-auto flex items-center gap-2">
          {descendantIds.length > 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                actions.playContext(descendantIds, 0)
              }}
              className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100"
              style={{ background: "var(--accent)" }}
            >
              <Play size={12} fill="currentColor" /> Lire le dossier
            </button>
          )}
        </span>
      </div>
      {open && (
        <div>
          {(node.children ?? []).map((child) => (
            <FolderRow key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function Folders() {
  const [tree, setTree] = useState<FolderNode[] | null>(null)

  useEffect(() => {
    let alive = true
    backend.library.getFolders().then((res) => {
      if (alive) setTree(res)
    })
    return () => {
      alive = false
    }
  }, [])

  return (
    <div className="p-8">
      <motion.header initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-hi">Dossiers</h1>
      </motion.header>

      {!tree ? (
        <RowsSkeleton count={10} />
      ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="glass-panel rounded-2xl p-2"
        >
          {tree.map((node, i) => (
            <FolderRow key={node.id} node={node} depth={0} defaultOpen={i === 0} />
          ))}
        </motion.div>
      )}
    </div>
  )
}
