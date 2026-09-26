import { useEffect, useState } from "react"
import Modal from "./Modal"
import { useUI } from "../store/uiStore"
import { backend } from "../services"
import type { Track } from "../types"
import { formatTime, formatBytes } from "../utils/format"
import CoverArt from "./CoverArt"

export default function PropertiesModal() {
  const id = useUI((s) => s.propertiesTrackId)
  const close = () => useUI.getState().setPropertiesTrackId(null)
  const [track, setTrack] = useState<Track | null>(null)

  useEffect(() => {
    if (id) backend.library.getTrack(id).then(setTrack)
    else setTrack(null)
  }, [id])

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
          <dl className="divide-y divide-[var(--glass-border)] text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="flex gap-4 py-2">
                <dt className="w-36 shrink-0 text-lo">{k}</dt>
                <dd className="min-w-0 flex-1 break-all text-hi">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </Modal>
  )
}
