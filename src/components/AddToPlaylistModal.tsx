import { useEffect, useState } from "react"
import Modal from "./Modal"
import { useUI } from "../store/uiStore"
import { usePlaylists } from "../store/playlistStore"
import CoverArt from "./CoverArt"
import { Plus, Check } from "lucide-react"

export default function AddToPlaylistModal() {
  const ids = useUI((s) => s.addToPlaylistFor)
  const close = () => useUI.getState().setAddToPlaylistFor(null)
  const toast = useUI((s) => s.toast)
  const { playlists, load, create, addTracks } = usePlaylists()
  const [newName, setNewName] = useState("")

  useEffect(() => {
    if (ids && playlists.length === 0) load()
  }, [ids])

  const add = async (id: string, name: string) => {
    if (!ids) return
    await addTracks(id, ids)
    toast(`Ajouté à « ${name} »`)
    close()
  }
  const createAndAdd = async () => {
    if (!newName.trim() || !ids) return
    const p = await create(newName.trim())
    await addTracks(p.id, ids)
    toast(`Playlist « ${p.name} » créée`)
    setNewName("")
    close()
  }

  return (
    <Modal open={!!ids} onClose={close} title="Ajouter à une playlist">
      <div className="mb-4 flex gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && createAndAdd()}
          placeholder="Nouvelle playlist…"
          className="focus-ring flex-1 rounded-xl bg-white/6 px-3.5 py-2.5 text-sm text-hi placeholder:text-lo"
        />
        <button
          onClick={createAndAdd}
          className="focus-ring grid place-items-center rounded-xl px-3 text-white"
          style={{ background: "var(--accent)" }}
          aria-label="Créer et ajouter"
        >
          <Plus size={18} />
        </button>
      </div>
      <div className="max-h-72 space-y-1 overflow-auto">
        {playlists.map((p) => {
          const already = ids ? ids.every((id) => p.trackIds.includes(id)) : false
          return (
            <button
              key={p.id}
              onClick={() => add(p.id, p.name)}
              className="flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors hover:bg-white/8"
            >
              <CoverArt colors={p.colors} size={44} rounded="rounded-lg" usePhoto={false} className="h-11 w-11 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-hi">{p.name}</div>
                <div className="text-xs text-lo">{p.trackIds.length} titres</div>
              </div>
              {already && <Check size={16} style={{ color: "var(--accent)" }} />}
            </button>
          )
        })}
      </div>
    </Modal>
  )
}
