import { useEffect, useState } from "react"
import Modal from "./Modal"
import { useUI } from "../store/uiStore"
import { backend } from "../services"
import type { Track } from "../types"
import type { TagPatch } from "../types"
import { formatTime, formatBytes } from "../utils/format"
import CoverArt from "./CoverArt"
import { useLibrary } from "../store/libraryStore"

export default function PropertiesModal() {
  const id = useUI((s) => s.propertiesTrackId)
  const close = () => useUI.getState().setPropertiesTrackId(null)
  const [track, setTrack] = useState<Track | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<TagPatch | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const version = useLibrary((s) => s.version)

  useEffect(() => { setEditing(false); setError("") }, [id])

  useEffect(() => {
    if (id) backend.library.getTrack(id).then((t) => {
      setTrack(t)
      if (t) setDraft({ title: t.title, artist: t.artist, album: t.album, albumArtist: t.albumArtist, genre: t.genre, year: t.year, trackNumber: t.trackNumber, discNumber: t.discNumber })
    })
    else setTrack(null)
  }, [id, version])

  const save = async () => {
    if (!id || !draft) return
    setSaving(true)
    setError("")
    try {
      await backend.library.updateTags(id, draft)
      setEditing(false)
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  const rows: [string, string][] = track
    ? [
        ["Titre", track.title],
        ["Artiste", track.artist],
        ["Album", track.album],
        ["Année", String(track.year)],
        ["Genre", track.genre],
        ["Piste", `${track.trackNumber} (disque ${track.discNumber})`],
        ["Durée", formatTime(track.durationMs)],
        ["Écoutes", String(track.plays)],
        ["Codec", track.codec],
        ["Qualité", track.quality],
        ["Débit", `${track.bitrate} kbps`],
        ["Échantillonnage", `${(track.sampleRate / 1000).toFixed(1)} kHz`],
        ["Profondeur", `${track.bitDepth} bits`],
        ["Taille", formatBytes(track.fileSize)],
        ["Chemin", track.filePath],
      ]
    : []

  return (
    <Modal open={!!id} onClose={close} title="Propriétés" width={520}>
      {track && (
        <div>
          <div className="mb-5 flex items-center gap-4">
            <CoverArt colors={track.colors} seed={track.albumId} size={72} rounded="rounded-xl" className="h-18 w-18 shrink-0" />
            <div className="min-w-0">
              <div className="truncate text-lg font-semibold text-hi">{track.title}</div>
              <div className="truncate text-sm text-mid">{track.artist}</div>
            </div>
          </div>
          {editing && draft ? (
            <div className="space-y-3">
              {(["title", "artist", "album", "albumArtist", "genre"] as const).map((key) => (
                <label key={key} className="block text-xs font-medium text-mid">
                  {{ title: "Titre", artist: "Artiste", album: "Album", albumArtist: "Artiste de l'album", genre: "Genre" }[key]}
                  <input value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} className="focus-ring mt-1 block w-full rounded-xl border border-[var(--glass-border)] bg-white/5 px-3 py-2 text-sm text-hi outline-none" />
                </label>
              ))}
              <div className="grid grid-cols-3 gap-3">
                {(["year", "trackNumber", "discNumber"] as const).map((key) => (
                  <label key={key} className="text-xs font-medium text-mid">
                    {{ year: "Année", trackNumber: "Piste", discNumber: "Disque" }[key]}
                    <input type="number" min="0" value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: Math.max(0, Number(e.target.value) || 0) })} className="focus-ring mt-1 block w-full rounded-xl border border-[var(--glass-border)] bg-white/5 px-3 py-2 text-sm text-hi outline-none" />
                  </label>
                ))}
              </div>
              {error && <p className="text-sm text-red-400" role="alert">{error}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setEditing(false)} className="rounded-full px-4 py-2 text-sm text-mid hover:text-hi">Annuler</button>
                <button onClick={() => void save()} disabled={saving} className="focus-ring rounded-full bg-[var(--accent)] px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Enregistrement…" : "Enregistrer les tags"}</button>
              </div>
            </div>
          ) : <>
          <dl className="divide-y divide-[var(--glass-border)] text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="flex gap-4 py-2">
                <dt className="w-36 shrink-0 text-lo">{k}</dt>
                <dd className="min-w-0 flex-1 break-all text-hi">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-5 flex justify-end"><button onClick={() => { setError(""); setEditing(true) }} className="focus-ring rounded-full border border-[var(--glass-border)] px-4 py-2 text-sm font-semibold text-hi hover:bg-white/10">Modifier les tags</button></div>
          </>}
        </div>
      )}
    </Modal>
  )
}
