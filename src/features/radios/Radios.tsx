import { useEffect, useState } from "react"
import { motion } from "framer-motion"
import { Radio, Plus, MoreHorizontal, Trash2 } from "lucide-react"
import { backend } from "../../services"
import { useUI } from "../../store/uiStore"
import { usePlayer } from "../../store/playerStore"
import { RadioCard } from "../../components/cards"
import { CardGridSkeleton } from "../../components/Skeleton"
import EmptyState from "../../components/EmptyState"
import Modal from "../../components/Modal"
import { cn } from "../../utils/cn"
import type { RadioStation } from "../../types"

export default function Radios() {
  const [stations, setStations] = useState<RadioStation[] | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [name, setName] = useState("")
  const [url, setUrl] = useState("")
  const [genre, setGenre] = useState("")
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const toast = useUI((s) => s.toast)
  const currentRadioId = usePlayer((s) => s.radioId)

  const refresh = async () => setStations(await backend.radio.list())

  useEffect(() => {
    refresh()
  }, [])

  const play = async (s: RadioStation) => {
    await backend.radio.play(s.id)
    toast(`Lecture de ${s.name}`)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !url.trim()) return
    await backend.radio.add(name.trim(), url.trim(), genre.trim() || "Divers")
    setName("")
    setUrl("")
    setGenre("")
    setModalOpen(false)
    await refresh()
    toast("Flux ajouté")
  }

  const remove = async (s: RadioStation) => {
    setMenuFor(null)
    await backend.radio.remove(s.id)
    await refresh()
    toast(`${s.name} supprimé`, {
      label: "Annuler",
      onClick: async () => {
        await backend.radio.add(s.name, s.streamUrl, s.genre)
        await refresh()
      },
    })
  }

  return (
    <div className="p-8">
      <motion.header
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8 flex items-center justify-between"
      >
        <h1 className="text-3xl font-bold tracking-tight text-hi">Radios</h1>
        <button
          onClick={() => setModalOpen(true)}
          className="focus-ring flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold text-white transition-transform active:scale-95"
          style={{ background: "var(--accent)" }}
        >
          <Plus size={16} /> Ajouter un flux
        </button>
      </motion.header>

      {!stations ? (
        <CardGridSkeleton count={10} />
      ) : stations.length === 0 ? (
        <EmptyState
          icon={<Radio size={34} />}
          title="Aucune radio"
          description="Ajoutez un flux pour écouter vos stations préférées en direct."
          action={{ label: "Ajouter un flux", onClick: () => setModalOpen(true) }}
        />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-6">
          {stations.map((s, i) => {
            const active = currentRadioId === s.id
            return (
              <motion.div
                key={s.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.03, 0.4) }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setMenuFor(s.id)
                }}
                className="relative"
              >
                <div className={cn("rounded-2xl", active && "ring-2 ring-offset-2 ring-offset-transparent")} style={active ? { boxShadow: "0 0 0 2px var(--accent)" } : undefined}>
                  <RadioCard station={s} onPlay={() => play(s)} />
                </div>

                {active && (
                  <span
                    className="absolute right-3 top-3 z-10 rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-white"
                    style={{ background: "var(--accent)" }}
                  >
                    En cours
                  </span>
                )}

                <button
                  onClick={() => setMenuFor(menuFor === s.id ? null : s.id)}
                  aria-label="Options"
                  className="absolute right-2 top-2 z-10 grid h-7 w-7 place-items-center rounded-full bg-black/50 text-white opacity-0 backdrop-blur transition-opacity hover:bg-black/70 group-hover:opacity-100"
                  style={{ opacity: menuFor === s.id ? 1 : undefined }}
                >
                  <MoreHorizontal size={15} />
                </button>

                {s.nowPlaying && <div className="mt-1 truncate text-xs text-lo">{s.nowPlaying}</div>}

                {menuFor === s.id && (
                  <>
                    <div className="fixed inset-0 z-20" onClick={() => setMenuFor(null)} />
                    <motion.div
                      initial={{ opacity: 0, scale: 0.94 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="glass-panel absolute right-2 top-10 z-30 w-44 overflow-hidden rounded-xl p-1"
                    >
                      <button
                        onClick={() => remove(s)}
                        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-red-400 hover:bg-white/8"
                      >
                        <Trash2 size={15} /> Supprimer
                      </button>
                    </motion.div>
                  </>
                )}
              </motion.div>
            )
          })}
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Ajouter un flux radio">
        <form onSubmit={submit} className="space-y-4">
          <Field label="Nom">
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ma station" className={inputCls} />
          </Field>
          <Field label="URL du flux">
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className={inputCls} />
          </Field>
          <Field label="Genre">
            <input value={genre} onChange={(e) => setGenre(e.target.value)} placeholder="Jazz, Ambient…" className={inputCls} />
          </Field>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setModalOpen(false)} className="rounded-full px-4 py-2 text-sm font-semibold text-mid hover:text-hi">
              Annuler
            </button>
            <button
              type="submit"
              disabled={!name.trim() || !url.trim()}
              className="focus-ring rounded-full px-5 py-2 text-sm font-semibold text-white transition-transform active:scale-95 disabled:opacity-40"
              style={{ background: "var(--accent)" }}
            >
              Ajouter
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

const inputCls =
  "w-full rounded-xl bg-white/6 px-4 py-2.5 text-sm text-hi placeholder:text-lo focus:outline-none focus:ring-2 focus:ring-white/20"

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-mid">{label}</span>
      {children}
    </label>
  )
}
