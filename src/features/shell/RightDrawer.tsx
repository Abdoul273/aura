import { useEffect, useState } from "react"
import { AnimatePresence, motion, Reorder } from "framer-motion"
import { X, Trash2, GripVertical } from "lucide-react"
import { useSettings } from "../../store/settingsStore"
import { usePlayer } from "../../store/playerStore"
import { backend, getTrackSync } from "../../services"
import type { QueueItem, Track } from "../../types"
import CoverArt from "../../components/CoverArt"
import LyricsView from "../../components/LyricsView"
import { formatTime } from "../../utils/format"
import { cn } from "../../utils/cn"

function QueueRow({ item, index, isCurrent, onPlay, onRemove, onDragEnd }: { item: QueueItem; index: number; isCurrent: boolean; onPlay: () => void; onRemove: () => void; onDragEnd?: () => void }) {
  const t = getTrackSync(item.trackId) as Track | undefined
  if (!t) return null
  const body = (
    <>
      {!isCurrent && <GripVertical size={14} className="shrink-0 text-lo opacity-0 group-hover:opacity-100" />}
      <CoverArt colors={t.colors} seed={t.albumId} size={36} rounded="rounded-md" className="h-9 w-9 shrink-0" />
      <button onDoubleClick={onPlay} className="min-w-0 flex-1 text-left">
        <div className="truncate text-sm font-medium text-hi" style={isCurrent ? { color: "var(--accent)" } : undefined}>{t.title}</div>
        <div className="truncate text-xs text-mid">{t.artist}</div>
      </button>
      <span className="text-xs text-lo tnum">{formatTime(t.durationMs)}</span>
      <button onClick={onRemove} aria-label="Retirer" className="text-lo opacity-0 hover:text-hi group-hover:opacity-100">
        <X size={14} />
      </button>
      <span className="hidden">{index}</span>
    </>
  )
  // Le morceau en cours est hors du Reorder.Group : un Reorder.Item y ferait planter framer-motion.
  if (isCurrent) return <div className="group flex items-center gap-2 rounded-xl bg-white/10 px-2 py-1.5">{body}</div>
  return (
    <Reorder.Item
      value={item}
      onDragEnd={onDragEnd}
      className="group flex cursor-grab items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-white/6 active:cursor-grabbing"
    >
      {body}
    </Reorder.Item>
  )
}

export default function RightDrawer() {
  const open = useSettings((s) => s.settings?.drawerOpen ?? false)
  const tab = useSettings((s) => s.settings?.drawerTab ?? "queue")
  const update = useSettings((s) => s.update)
  const queue = usePlayer((s) => s.queue)
  const queueIndex = usePlayer((s) => s.queueIndex)
  const history = usePlayer((s) => s.history)
  const [localQueue, setLocalQueue] = useState<QueueItem[]>(queue)

  useEffect(() => setLocalQueue(queue), [queue])

  const upNext = localQueue.slice(queueIndex + 1)
  const current = queue[queueIndex]

  const commitReorder = (next: QueueItem[]) => {
    setLocalQueue(next)
  }
  const persistMove = (item: QueueItem) => {
    const from = queue.findIndex((q) => q.uid === item.uid)
    const to = localQueue.findIndex((q) => q.uid === item.uid)
    if (from !== -1 && to !== -1 && from !== to) backend.queue.move(from, to)
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          data-panel="drawer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          style={{ width: "var(--drawer-width)" }}
          transition={{ duration: 0.15 }}
          className="glass-panel z-20 flex h-full shrink-0 flex-col overflow-hidden rounded-3xl"
        >
          <div className="flex shrink-0 items-center gap-1 p-3">
            {(["queue", "lyrics"] as const).map((t) => (
              <button
                key={t}
                onClick={() => update({ drawerTab: t })}
                className={cn("rounded-full px-4 py-1.5 text-sm font-semibold transition-colors", tab === t ? "text-hi" : "text-mid hover:text-hi")}
                style={tab === t ? { background: "color-mix(in srgb, var(--accent) 20%, transparent)" } : undefined}
              >
                {t === "queue" ? "File d'attente" : "Paroles"}
              </button>
            ))}
            <div className="flex-1" />
            {tab === "queue" && upNext.length > 0 && (
              <button onClick={() => backend.queue.clear()} className="flex items-center gap-1 rounded-full px-2 py-1 text-xs text-lo hover:text-hi" aria-label="Vider la file">
                <Trash2 size={13} /> Vider
              </button>
            )}
          </div>

          <div className={cn("min-h-0 flex-1", tab === "lyrics" ? "overflow-hidden" : "overflow-y-auto px-3 pb-4")}>
            {tab === "lyrics" ? (
              <LyricsView />
            ) : (
              <>
                {current && (
                  <div className="mb-4">
                    <div className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-lo">En cours</div>
                    <QueueRow item={current} index={queueIndex} isCurrent onPlay={() => {}} onRemove={() => {}} />
                  </div>
                )}
                <div className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-lo">À suivre</div>
                {upNext.length === 0 ? (
                  <div className="px-2 py-6 text-center text-sm text-lo">La file est vide.</div>
                ) : (
                  <Reorder.Group axis="y" values={upNext} onReorder={(next) => commitReorder([...localQueue.slice(0, queueIndex + 1), ...next])} className="space-y-0.5">
                    {upNext.map((item) => {
                      const realIndex = queue.findIndex((q) => q.uid === item.uid)
                      return (
                        <QueueRow
                          key={item.uid}
                          item={item}
                          index={realIndex}
                          isCurrent={false}
                          onPlay={() => backend.player.play(queue.map((q) => q.trackId), realIndex)}
                          onRemove={() => backend.queue.remove(realIndex)}
                          onDragEnd={() => persistMove(item)}
                        />
                      )
                    })}
                  </Reorder.Group>
                )}

                {history.length > 0 && (
                  <>
                    <div className="mb-2 mt-5 px-2 text-xs font-semibold uppercase tracking-wider text-lo">Historique</div>
                    <div className="space-y-0.5 opacity-70">
                      {history.slice(-12).reverse().map((id, i) => {
                        const t = getTrackSync(id)
                        if (!t) return null
                        return (
                          <button key={i} onDoubleClick={() => backend.player.play([id], 0)} className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left hover:bg-white/6">
                            <CoverArt colors={t.colors} seed={t.albumId} size={32} rounded="rounded-md" className="h-8 w-8 shrink-0" />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm text-hi">{t.title}</div>
                              <div className="truncate text-xs text-mid">{t.artist}</div>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
