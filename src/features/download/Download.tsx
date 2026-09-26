import { useState } from "react"
import { motion } from "framer-motion"
import { Download as DownloadIcon, Search, Loader2, X, Play, Check, BadgeCheck, Pencil, Mic2, AlertCircle, RotateCw, Trash2, MonitorPlay } from "lucide-react"
import { backend } from "../../services"
import { useDownloads, lyricsFor } from "../../store/downloadStore"
import { useLibrary } from "../../store/libraryStore"
import { usePlayer } from "../../store/playerStore"
import { useUI } from "../../store/uiStore"
import { cn } from "../../utils/cn"
import type { DlJob, DlResult, LyricsAvailability } from "../../types"

const fmtDuration = (s: number) => (s > 0 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : "—")
const fmtViews = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(1)} Md` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} M` : n >= 1e3 ? `${Math.round(n / 1e3)} k` : n > 0 ? String(n) : ""

const STATUS_LABEL: Record<DlJob["status"], string> = {
  queued: "En attente",
  downloading: "Téléchargement",
  retrying: "Nouvelle tentative",
  converting: "Extraction audio",
  tagging: "Tags et pochette",
  lyrics: "Recherche des paroles",
  done: "Dans la bibliothèque",
  error: "Échec",
  canceled: "Annulé",
}

const LYRICS_LABEL: Record<LyricsAvailability, string> = {
  synced: "Paroles synchronisées",
  approx: "Paroles synchro (autre version)",
  plain: "Paroles (texte)",
  instrumental: "Instrumental",
  none: "Sans paroles",
}

export default function DownloadScreen() {
  const { query, results, searching, error, jobs, search, clearFinished } = useDownloads()
  const [text, setText] = useState(query)
  const jobList = Object.values(jobs)
  const active = jobList.filter((j) => !["done", "error", "canceled"].includes(j.status))
  const finished = jobList.length - active.length

  return (
    <div className="p-8">
      <motion.header initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight text-hi">Télécharger</h1>
        <p className="mt-1 text-sm text-mid">YouTube vers votre bibliothèque : audio sans perte de qualité, tags propres, pochette et paroles synchronisées prêtes à l'écoute.</p>
      </motion.header>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void search(text)
        }}
        className="mb-6 flex gap-2"
      >
        <div className="glass-panel flex min-w-0 flex-1 items-center gap-2 rounded-full px-4">
          <Search size={17} className="shrink-0 text-mid" />
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Artiste, titre… ou collez un lien YouTube"
            className="min-w-0 flex-1 bg-transparent py-3 text-sm text-hi outline-none placeholder:text-lo"
          />
          {text && (
            <button type="button" onClick={() => setText("")} className="rounded-full p-1 text-mid hover:text-hi" aria-label="Effacer">
              <X size={15} />
            </button>
          )}
        </div>
        <button
          type="submit"
          disabled={searching || !text.trim()}
          className="focus-ring flex items-center gap-2 rounded-full px-5 text-sm font-semibold text-white transition-transform active:scale-95 disabled:opacity-60"
          style={{ background: "var(--accent)" }}
        >
          {searching ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />} Rechercher
        </button>
      </form>

      {jobList.length > 0 && (
        <section className="mb-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-bold text-hi">
              Téléchargements {active.length > 0 && <span className="text-sm font-medium text-mid">· {active.length} en cours</span>}
            </h2>
            {finished > 0 && (
              <button onClick={clearFinished} className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-mid hover:bg-white/6 hover:text-hi">
                <Trash2 size={13} /> Effacer les terminés
              </button>
            )}
          </div>
          <div className="flex flex-col gap-2">
            {jobList.map((j) => (
              <JobRow key={j.id} job={j} />
            ))}
          </div>
        </section>
      )}

      {searching && !results?.length && <ResultsSkeleton />}
      {error && (
        <div className="flex items-center gap-2 rounded-2xl bg-red-500/10 p-4 text-sm text-red-300">
          <AlertCircle size={16} /> {error}
        </div>
      )}
      {!searching && results?.length === 0 && !error && <div className="py-10 text-center text-sm text-mid">Aucun résultat pour « {query} ».</div>}
      {!results && !searching && jobList.length === 0 && (
        <div className="flex flex-col items-center py-16 text-center text-mid">
          <div className="mb-3 grid h-16 w-16 place-items-center rounded-full bg-white/6">
            <MonitorPlay size={30} />
          </div>
          <div className="font-semibold text-hi">Cherchez un morceau</div>
          <div className="mt-1 max-w-sm text-sm">Privilégiez les versions « Audio » : leur durée correspond à l'album, les paroles tombent alors pile en rythme.</div>
        </div>
      )}
      {results && results.length > 0 && (
        <section className={cn(searching && "opacity-60")}>
          <h2 className="mb-3 text-lg font-bold text-hi">Résultats</h2>
          <div className="flex flex-col gap-2">
            {results.map((r, i) => (
              <motion.div key={r.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.02, 0.3) }}>
                <ResultRow r={r} />
              </motion.div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function ResultRow({ r }: { r: DlResult }) {
  const job = useDownloads((s) => s.jobs[r.id])
  const lyrics = useDownloads((s) => lyricsFor(s, r))
  const { start, cancel, editResult, probe } = useDownloads()
  const [editing, setEditing] = useState(false)
  const [artist, setArtist] = useState(r.artist)
  const [track, setTrack] = useState(r.track)

  const saveEdit = () => {
    setEditing(false)
    if (artist.trim() === r.artist && track.trim() === r.track) return
    const next = { ...r, artist: artist.trim(), track: track.trim() }
    editResult(r.id, { artist: next.artist, track: next.track })
    probe(next)
  }

  return (
    <div className="group flex items-center gap-4 rounded-2xl p-2 pr-4 transition-colors hover:bg-white/5">
      <div className="relative w-36 shrink-0 overflow-hidden rounded-xl bg-white/5" style={{ aspectRatio: "16 / 9" }}>
        <img src={r.thumbnail} alt="" loading="lazy" className="h-full w-full object-cover" />
        <span className="absolute bottom-1 right-1 rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-semibold text-white">{fmtDuration(r.durationS)}</span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold text-hi" title={r.title}>
          {r.title}
        </div>
        <div className="flex items-center gap-1 truncate text-xs text-mid">
          {r.channel}
          {r.verified && <BadgeCheck size={13} className="shrink-0" />}
          {r.views > 0 && <span className="text-lo">· {fmtViews(r.views)} vues</span>}
        </div>
        {editing ? (
          <form
            className="mt-1.5 flex flex-wrap gap-1.5"
            onSubmit={(e) => {
              e.preventDefault()
              saveEdit()
            }}
          >
            <input value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="Artiste" className="w-40 rounded-lg border border-[var(--glass-border)] bg-transparent px-2 py-1 text-xs text-hi outline-none" />
            <input value={track} onChange={(e) => setTrack(e.target.value)} placeholder="Titre" className="w-52 rounded-lg border border-[var(--glass-border)] bg-transparent px-2 py-1 text-xs text-hi outline-none" />
            <button type="submit" className="rounded-lg px-2 py-1 text-xs font-semibold text-white" style={{ background: "var(--accent)" }}>
              OK
            </button>
          </form>
        ) : (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
            <button onClick={() => setEditing(true)} className="flex items-center gap-1 rounded-full bg-white/6 px-2 py-0.5 text-mid hover:text-hi" title="Artiste et titre écrits dans les tags">
              {r.artist || "Artiste ?"} — {r.track} <Pencil size={10} />
            </button>
            <KindBadge kind={r.kind} />
            <LyricsBadge value={lyrics} />
          </div>
        )}
      </div>

      <JobAction job={job} onStart={() => start(r)} onCancel={() => cancel(r.id)} />
    </div>
  )
}

function KindBadge({ kind }: { kind: DlResult["kind"] }) {
  if (kind === "audio") return <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-300">Audio</span>
  if (kind === "clip") return <span className="rounded-full bg-white/6 px-2 py-0.5 text-mid">Clip</span>
  if (kind === "live") return <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-300">Live</span>
  return null
}

function LyricsBadge({ value }: { value: LyricsAvailability | "loading" | undefined }) {
  if (!value) return null
  if (value === "loading")
    return (
      <span className="flex items-center gap-1 rounded-full bg-white/6 px-2 py-0.5 text-lo">
        <Loader2 size={10} className="animate-spin" /> Paroles…
      </span>
    )
  const style =
    value === "synced" ? "bg-[color-mix(in_srgb,var(--accent)_22%,transparent)] text-hi" : value === "none" ? "bg-white/6 text-lo" : "bg-white/6 text-mid"
  return (
    <span className={cn("flex items-center gap-1 rounded-full px-2 py-0.5", style)}>
      <Mic2 size={10} /> {LYRICS_LABEL[value]}
    </span>
  )
}

function JobAction({ job, onStart, onCancel }: { job?: DlJob; onStart: () => void; onCancel: () => void }) {
  if (!job || job.status === "canceled")
    return (
      <button
        onClick={onStart}
        className="focus-ring flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold text-white transition-transform active:scale-95"
        style={{ background: "var(--accent)" }}
      >
        <DownloadIcon size={15} /> Télécharger
      </button>
    )
  if (job.status === "done") return <PlayButton job={job} />
  if (job.status === "error")
    return (
      <button onClick={onStart} className="flex shrink-0 items-center gap-1.5 rounded-full bg-white/8 px-4 py-2 text-sm font-semibold text-hi hover:bg-white/12" title={job.error ?? ""}>
        <RotateCw size={14} /> Réessayer
      </button>
    )
  return (
    <div className="flex w-44 shrink-0 items-center gap-2">
      <div className="min-w-0 flex-1">
        <div className="mb-1 truncate text-[11px] text-mid">
          {STATUS_LABEL[job.status]}
          {job.status === "downloading" && job.progress > 0 ? ` · ${Math.round(job.progress)} %` : ""}
        </div>
        <Progress job={job} />
      </div>
      <button onClick={onCancel} className="rounded-full p-1.5 text-mid hover:bg-white/8 hover:text-hi" aria-label="Annuler">
        <X size={15} />
      </button>
    </div>
  )
}

function Progress({ job }: { job: DlJob }) {
  const indeterminate = job.status !== "downloading" || job.progress <= 0
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
      <div
        className={cn("h-full rounded-full transition-[width] duration-300", indeterminate && "animate-pulse")}
        style={{ width: indeterminate ? "100%" : `${job.progress}%`, background: "var(--accent)", opacity: indeterminate ? 0.55 : 1 }}
      />
    </div>
  )
}

function PlayButton({ job }: { job: DlJob }) {
  // Le titre apparaît après le scan incrémental ; `version` change à ce moment-là.
  useLibrary((s) => s.version)
  const playTracks = usePlayer((s) => s.playTracks)
  const toast = useUI((s) => s.toast)
  const trackId = job.path ? backend.downloads.trackIdForPath(job.path) : null
  if (!trackId)
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-xs text-mid">
        <Loader2 size={13} className="animate-spin" /> Ajout à la bibliothèque…
      </span>
    )
  return (
    <button
      onClick={() => {
        playTracks([trackId], 0)
        toast(`Lecture de ${job.title}`)
      }}
      className="flex shrink-0 items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-hi hover:bg-white/15"
    >
      <Play size={14} className="fill-current" /> Écouter
    </button>
  )
}

function JobRow({ job }: { job: DlJob }) {
  const cancel = useDownloads((s) => s.cancel)
  const done = job.status === "done"
  return (
    <div className="glass-panel flex items-center gap-3 rounded-2xl p-2.5 pr-4">
      <img src={job.thumbnail} alt="" className="h-11 w-11 shrink-0 rounded-lg object-cover" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-hi">{job.title}</div>
        <div className="truncate text-xs text-mid">{job.artist}</div>
        {!done && job.status !== "error" && job.status !== "canceled" && (
          <div className="mt-1.5 flex items-center gap-2">
            <div className="flex-1">
              <Progress job={job} />
            </div>
            <span className="shrink-0 text-[11px] text-mid">
              {STATUS_LABEL[job.status]}
              {job.status === "downloading" && job.progress > 0 && ` ${Math.round(job.progress)} %`}
              {job.speed && ` · ${job.speed}`}
              {job.eta && ` · ${job.eta}`}
            </span>
          </div>
        )}
        {job.error && <div className={cn("mt-1 truncate text-xs", job.status === "retrying" ? "text-amber-300" : "text-red-300")}>{job.error}</div>}
      </div>
      {done && (
        <span className="flex shrink-0 items-center gap-1.5 text-xs text-mid">
          <Check size={14} className="text-emerald-400" /> {job.lyrics ? LYRICS_LABEL[job.lyrics] : "Terminé"}
        </span>
      )}
      {job.status === "canceled" && <span className="shrink-0 text-xs text-lo">Annulé</span>}
      {done ? (
        <PlayButton job={job} />
      ) : (
        !["error", "canceled"].includes(job.status) && (
          <button onClick={() => cancel(job.id)} className="rounded-full p-1.5 text-mid hover:bg-white/8 hover:text-hi" aria-label="Annuler">
            <X size={15} />
          </button>
        )
      )}
    </div>
  )
}

function ResultsSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 p-2">
          <div className="w-36 animate-pulse rounded-xl bg-white/6" style={{ aspectRatio: "16 / 9" }} />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-2/3 animate-pulse rounded bg-white/6" />
            <div className="h-3 w-1/3 animate-pulse rounded bg-white/6" />
          </div>
        </div>
      ))}
    </div>
  )
}
