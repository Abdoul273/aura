import { useEffect, useMemo, useRef, useState } from "react"
import { motion, Reorder, useDragControls } from "framer-motion"
import { Play, Shuffle, MoreHorizontal, Trash2, X, ListMusic, Sparkles, GripVertical } from "lucide-react"
import type { Playlist, Track } from "../../types"
import { backend, getTrackSync } from "../../services"
import { usePlaylists } from "../../store/playlistStore"
import { useUI } from "../../store/uiStore"
import { usePlayer } from "../../store/playerStore"
import { usePlaybackActions } from "../../hooks/usePlaybackActions"
import { useOpenMenu } from "../../components/TrackContextMenu"
import CoverArt from "../../components/CoverArt"
import EmptyState from "../../components/EmptyState"
import Modal from "../../components/Modal"
import { RowsSkeleton, Skeleton } from "../../components/Skeleton"
import { formatCount, formatDuration, formatTime } from "../../utils/format"
import { cn } from "../../utils/cn"

// Find the single moved element between two id orderings.
function diffMove(prev: string[], next: string[]): { from: number; to: number } | null {
  if (prev.length !== next.length) return null
  let from = -1
  for (let i = 0; i < prev.length; i++) {
    if (prev[i] !== next[i]) {
      from = i
      break
    }
  }
  if (from === -1) return null
  const moved = next.find((id, i) => prev[i] !== id && prev.indexOf(id) !== i)
  const to = moved ? next.indexOf(moved) : from
  const fromIdx = moved ? prev.indexOf(moved) : from
  return { from: fromIdx, to }
}

function ReorderRow({
  track,
  index,
  isCurrent,
  onPlay,
  onRemove,
  onContextMenu,
  onCommit,
}: {
  track: Track
  index: number
  isCurrent: boolean
  onPlay: () => void
  onRemove: () => void
  onContextMenu: (e: React.MouseEvent) => void
  onCommit: () => void
}) {
  const controls = useDragControls()
  return (
    <Reorder.Item
      value={track}
      dragListener={false}
      dragControls={controls}
      onDragEnd={onCommit}
      onDoubleClick={onPlay}
      onContextMenu={onContextMenu}
      className={cn(
        "group flex items-center gap-3 rounded-xl px-3 py-2 transition-colors",
        isCurrent ? "bg-white/8" : "hover:bg-white/6",
      )}
    >
      <button
        onPointerDown={(e) => controls.start(e)}
        aria-label="Réordonner"
        className="cursor-grab touch-none text-lo opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing"
      >
        <GripVertical size={16} />
      </button>
      <span className="w-5 shrink-0 text-center text-sm text-lo tnum">{index + 1}</span>
      <CoverArt colors={track.colors} seed={track.albumId} size={40} rounded="rounded-lg" className="h-10 w-10 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-hi" style={isCurrent ? { color: "var(--accent)" } : undefined}>
          {track.title}
        </div>
        <div className="truncate text-xs text-mid">{track.artist}</div>
      </div>
      <div className="hidden min-w-0 flex-1 truncate text-sm text-mid md:block">{track.album}</div>
      <button
        onClick={onRemove}
        aria-label="Retirer de la playlist"
        className="shrink-0 text-mid opacity-0 transition-opacity hover:text-hi group-hover:opacity-100"
      >
        <X size={16} />
      </button>
      <span className="w-12 shrink-0 text-right text-sm text-lo tnum">{formatTime(track.durationMs)}</span>
    </Reorder.Item>
  )
}

export default function PlaylistDetail({ id }: { id: string }) {
  const [playlist, setPlaylist] = useState<Playlist | null>(null)
  const [loading, setLoading] = useState(true)
  const [order, setOrder] = useState<Track[]>([])
  const prevOrder = useRef<string[]>([])
  const [editingName, setEditingName] = useState(false)
  const [editingDesc, setEditingDesc] = useState(false)
  const [nameDraft, setNameDraft] = useState("")
  const [descDraft, setDescDraft] = useState("")
  const [confirmDelete, setConfirmDelete] = useState(false)

  const pl = usePlaylists()
  const navigate = useUI((s) => s.navigate)
  const toast = useUI((s) => s.toast)
  const actions = usePlaybackActions()
  const openMenu = useOpenMenu()
  const toggleShuffle = usePlayer((s) => s.toggleShuffle)
  const currentId = usePlayer((s) => s.currentTrackId)

  const refresh = () => {
    setLoading(true)
    backend.playlists.get(id).then((p) => {
      setPlaylist(p)
      if (p) {
        const tracks = p.trackIds.map((tid) => getTrackSync(tid)).filter((t): t is Track => !!t)
        setOrder(tracks)
        prevOrder.current = tracks.map((t) => t.id)
      }
      setLoading(false)
    })
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const trackIds = useMemo(() => order.map((t) => t.id), [order])
  const totalMs = order.reduce((sum, t) => sum + t.durationMs, 0)

  const commitReorder = async () => {
    const next = order.map((t) => t.id)
    const move = diffMove(prevOrder.current, next)
    prevOrder.current = next
    if (move && move.from !== move.to) await pl.reorder(id, move.from, move.to)
  }

  const saveName = async () => {
    setEditingName(false)
    const name = nameDraft.trim()
    if (playlist && name && name !== playlist.name) {
      await pl.rename(id, name)
      setPlaylist({ ...playlist, name })
    }
  }

  const saveDesc = async () => {
    setEditingDesc(false)
    if (playlist && descDraft !== playlist.description) {
      await pl.update(id, { description: descDraft })
      setPlaylist({ ...playlist, description: descDraft })
    }
  }

  const removeTrack = async (tid: string) => {
    setOrder((o) => o.filter((t) => t.id !== tid))
    prevOrder.current = prevOrder.current.filter((x) => x !== tid)
    await pl.removeTracks(id, [tid])
    toast("Titre retiré de la playlist")
  }

  const doDelete = async () => {
    await pl.remove(id)
    navigate({ name: "home" })
    toast("Playlist supprimée")
  }

  if (loading) {
    return (
      <div className="p-8">
        <Skeleton className="mb-8 h-52 w-full rounded-3xl" />
        <RowsSkeleton count={8} />
      </div>
    )
  }

  if (!playlist) {
    return <div className="p-8 text-mid">Playlist introuvable.</div>
  }

  return (
    <div className="p-8">
      <motion.header
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8 flex flex-col items-center gap-6 sm:flex-row sm:items-end"
      >
        <CoverArt
          colors={playlist.colors}
          seed={playlist.id}
          size={200}
          usePhoto={false}
          icon
          className="h-48 w-48 shrink-0 shadow-2xl"
        />
        <div className="min-w-0 flex-1 text-center sm:text-left">
          <div className="flex items-center justify-center gap-2 sm:justify-start">
            <p className="text-xs font-bold uppercase tracking-widest text-mid">Playlist</p>
            {playlist.smart && (
              <span
                className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold text-white"
                style={{ background: "var(--accent)" }}
              >
                <Sparkles size={11} /> Intelligente
              </span>
            )}
          </div>

          {editingName ? (
            <input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => e.key === "Enter" && saveName()}
              className="mt-1 w-full rounded-lg bg-white/8 px-2 py-1 text-4xl font-bold tracking-tight text-hi outline-none"
            />
          ) : (
            <h1
              onClick={() => {
                setNameDraft(playlist.name)
                setEditingName(true)
              }}
              className="mt-1 cursor-text text-5xl font-bold tracking-tight text-hi hover:opacity-80"
            >
              {playlist.name}
            </h1>
          )}

          {editingDesc ? (
            <input
              autoFocus
              value={descDraft}
              onChange={(e) => setDescDraft(e.target.value)}
              onBlur={saveDesc}
              onKeyDown={(e) => e.key === "Enter" && saveDesc()}
              placeholder="Ajouter une description"
              className="mt-2 w-full rounded-lg bg-white/8 px-2 py-1 text-sm text-mid outline-none"
            />
          ) : (
            <p
              onClick={() => {
                setDescDraft(playlist.description)
                setEditingDesc(true)
              }}
              className="mt-2 cursor-text text-sm text-mid hover:opacity-80"
            >
              {playlist.description || "Ajouter une description"}
            </p>
          )}

          <p className="mt-3 text-sm font-medium text-mid tnum">
            {formatCount(order.length)} titres · {formatDuration(totalMs)}
          </p>

          <div className="mt-5 flex flex-wrap items-center justify-center gap-3 sm:justify-start">
            <button
              onClick={() => order.length && actions.playContext(trackIds, 0)}
              className="flex items-center gap-2 rounded-full px-6 py-2.5 text-sm font-bold text-white shadow-lg transition-transform active:scale-95"
              style={{ background: "var(--accent)" }}
            >
              <Play size={16} fill="currentColor" /> Lire
            </button>
            <button
              onClick={() => {
                if (!order.length) return
                toggleShuffle()
                actions.playContext(trackIds, 0)
              }}
              className="flex items-center gap-2 rounded-full bg-white/10 px-5 py-2.5 text-sm font-semibold text-hi transition-transform active:scale-95"
            >
              <Shuffle size={16} /> Aléatoire
            </button>
            <button
              onClick={(e) => openMenu(e, "playlist", id, trackIds)}
              aria-label="Plus d'options"
              className="grid h-10 w-10 place-items-center rounded-full text-mid transition-colors hover:bg-white/8 hover:text-hi"
            >
              <MoreHorizontal size={18} />
            </button>
            <button
              onClick={() => setConfirmDelete(true)}
              aria-label="Supprimer la playlist"
              className="grid h-10 w-10 place-items-center rounded-full text-mid transition-colors hover:bg-white/8 hover:text-red-400"
            >
              <Trash2 size={18} />
            </button>
          </div>
        </div>
      </motion.header>

      {order.length === 0 ? (
        <EmptyState
          icon={<ListMusic size={34} />}
          title="Playlist vide"
          description="Ajoutez des titres pour commencer à écouter."
          action={{ label: "Parcourir les titres", onClick: () => navigate({ name: "tracks" }) }}
        />
      ) : (
        <Reorder.Group axis="y" values={order} onReorder={setOrder} className="space-y-1">
          {order.map((track, i) => (
            <ReorderRow
              key={track.id}
              track={track}
              index={i}
              isCurrent={currentId === track.id}
              onPlay={() => actions.playContext(trackIds, i)}
              onRemove={() => removeTrack(track.id)}
              onContextMenu={(e) => openMenu(e, "track", track.id)}
              onCommit={commitReorder}
            />
          ))}
        </Reorder.Group>
      )}

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Supprimer la playlist ?">
        <p className="text-sm text-mid">
          « {playlist.name} » sera définitivement supprimée. Cette action est irréversible.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={() => setConfirmDelete(false)}
            className="rounded-full px-4 py-2 text-sm font-semibold text-mid transition-colors hover:bg-white/8 hover:text-hi"
          >
            Annuler
          </button>
          <button
            onClick={doDelete}
            className="rounded-full bg-red-500 px-4 py-2 text-sm font-semibold text-white transition-transform active:scale-95"
          >
            Supprimer
          </button>
        </div>
      </Modal>
    </div>
  )
}
