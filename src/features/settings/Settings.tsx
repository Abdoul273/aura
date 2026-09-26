import { useEffect, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import {
  Library,
  Play,
  Palette,
  Keyboard,
  Info,
  Plus,
  X,
  FolderSearch,
  Check,
} from "lucide-react"
import type { AudioDevice, ReplayGainMode, Settings as AppSettings } from "../../types"
import { backend } from "../../services"
import Modal from "../../components/Modal"
import { useSettings } from "../../store/settingsStore"
import { useLibrary } from "../../store/libraryStore"
import { cn } from "../../utils/cn"

/* ---------- Reusable controls ---------- */

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="focus-ring relative h-6 w-11 shrink-0 rounded-full transition-colors"
      style={{ background: checked ? "var(--accent)" : "rgba(255,255,255,0.14)" }}
    >
      <motion.span
        className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow"
        animate={{ left: checked ? 22 : 2 }}
        transition={{ type: "spring", stiffness: 500, damping: 32 }}
      />
    </button>
  )
}

function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
}) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div className="relative h-6 min-w-40 flex-1">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
      />
      <div className="pointer-events-none absolute left-0 top-1/2 h-1.5 w-full -translate-y-1/2 overflow-hidden rounded-full bg-white/10">
        <div className="absolute left-0 top-0 h-full rounded-full" style={{ width: `${pct}%`, background: "var(--accent)" }} />
      </div>
      <div
        className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border border-white/40 shadow"
        style={{ left: `calc(${pct}% - 8px)`, background: "var(--accent)" }}
      />
    </div>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-3.5">
      <div className="min-w-0">
        <div className="text-sm font-medium text-hi">{label}</div>
        {hint && <div className="text-xs text-mid">{hint}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-3">{children}</div>
    </div>
  )
}

const ACCENTS = ["#7c5cff", "#ff5c8a", "#5cc8ff", "#4ade80", "#fbbf24", "#f472b6", "#a78bfa"]

const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ["Espace"], label: "Lecture / Pause" },
  { keys: ["←"], label: "Reculer 5 s" },
  { keys: ["→"], label: "Avancer 5 s" },
  { keys: ["Ctrl", "←"], label: "Précédent" },
  { keys: ["Ctrl", "→"], label: "Suivant" },
  { keys: ["↑"], label: "Volume +" },
  { keys: ["↓"], label: "Volume −" },
  { keys: ["M"], label: "Muet" },
  { keys: ["L"], label: "J'aime" },
  { keys: ["S"], label: "Aléatoire" },
  { keys: ["R"], label: "Répéter" },
  { keys: ["F"], label: "Plein écran" },
  { keys: ["/"], label: "Recherche" },
  { keys: ["Ctrl", "K"], label: "Palette de commandes" },
]

type TabId = "library" | "playback" | "appearance" | "shortcuts" | "about"
const TABS: { id: TabId; label: string; icon: typeof Library }[] = [
  { id: "library", label: "Bibliothèque", icon: Library },
  { id: "playback", label: "Lecture", icon: Play },
  { id: "appearance", label: "Apparence", icon: Palette },
  { id: "shortcuts", label: "Raccourcis clavier", icon: Keyboard },
  { id: "about", label: "À propos", icon: Info },
]

/* ---------- Tabs ---------- */

function LibraryTab({ s, update }: { s: AppSettings; update: (p: Partial<AppSettings>) => void }) {
  const scan = useLibrary((x) => x.scan)
  const rescan = useLibrary((x) => x.rescan)
  const [addOpen, setAddOpen] = useState(false)
  const [path, setPath] = useState("")

  const addFolder = async () => {
    const p = path.trim()
    if (!p) return
    await backend.settings.addMusicFolder(p)
    update({ musicFolders: [...s.musicFolders, p] })
    setAddOpen(false)
    setPath("")
  }
  const removeFolder = async (p: string) => {
    await backend.settings.removeMusicFolder(p)
    update({ musicFolders: s.musicFolders.filter((f) => f !== p) })
  }

  const progress = scan.total > 0 ? (scan.current / scan.total) * 100 : 0

  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold text-hi">Dossiers de musique</h3>
      <div className="glass rounded-2xl">
        {s.musicFolders.length === 0 && <div className="px-4 py-6 text-sm text-mid">Aucun dossier configuré.</div>}
        {s.musicFolders.map((f) => (
          <div key={f} className="flex items-center justify-between gap-3 border-b border-[var(--glass-border)] px-4 py-3 last:border-0">
            <span className="truncate text-sm text-hi">{f}</span>
            <button
              onClick={() => void removeFolder(f)}
              aria-label={`Retirer ${f}`}
              className="focus-ring rounded-full p-1.5 text-lo transition-colors hover:bg-white/8 hover:text-hi"
            >
              <X size={16} />
            </button>
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={async () => {
            // Native picker in the desktop app, manual path otherwise.
            const picked = await backend.system.pickFolder()
            if (picked) {
              await backend.settings.addMusicFolder(picked)
              update({ musicFolders: [...s.musicFolders.filter((f) => f !== picked), picked] })
            } else if (picked === undefined) setAddOpen(true)
          }}
          className="focus-ring flex items-center gap-2 rounded-full border border-[var(--glass-border)] px-4 py-2 text-sm text-mid transition-colors hover:text-hi"
        >
          <Plus size={16} /> Ajouter un dossier…
        </button>
        <button
          onClick={() => void rescan()}
          disabled={scan.scanning}
          className="focus-ring flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
          style={{ background: "var(--accent)" }}
        >
          <FolderSearch size={16} /> Analyser la bibliothèque
        </button>
      </div>

      {scan.scanning && (
        <div className="mt-4">
          <div className="mb-1.5 flex justify-between text-xs text-mid">
            <span className="truncate">{scan.currentPath || "Analyse en cours…"}</span>
            <span className="tnum tabular-nums">
              {scan.current} / {scan.total}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <motion.div className="h-full rounded-full" style={{ background: "var(--accent)" }} animate={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Ajouter un dossier">
        <div className="flex flex-col gap-4">
          <input
            autoFocus
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void addFolder()}
            placeholder="/home/utilisateur/Musique"
            className="focus-ring w-full rounded-xl border border-[var(--glass-border)] bg-white/5 px-4 py-2.5 text-sm text-hi outline-none placeholder:text-lo"
          />
          <div className="flex justify-end gap-2">
            <button onClick={() => setAddOpen(false)} className="focus-ring rounded-full px-4 py-2 text-sm text-mid hover:text-hi">
              Annuler
            </button>
            <button
              onClick={() => void addFolder()}
              disabled={!path.trim()}
              className="focus-ring rounded-full px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
              style={{ background: "var(--accent)" }}
            >
              Ajouter
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function PlaybackTab({ s, update }: { s: AppSettings; update: (p: Partial<AppSettings>) => void }) {
  const [devices, setDevices] = useState<AudioDevice[]>([])
  useEffect(() => {
    void backend.audio.getDevices().then(setDevices)
  }, [])

  const gains: { id: ReplayGainMode; label: string }[] = [
    { id: "off", label: "Désactivé" },
    { id: "track", label: "Piste" },
    { id: "album", label: "Album" },
  ]

  const selectDevice = async (id: string) => {
    await backend.audio.setDevice(id)
    setDevices((prev) => prev.map((d) => ({ ...d, active: d.id === id })))
  }

  return (
    <div className="divide-y divide-[var(--glass-border)]">
      <Row label="Fondu enchaîné" hint="Transition entre les pistes">
        <Slider
          value={s.crossfadeMs}
          min={0}
          max={12000}
          step={500}
          onChange={(v) => {
            void backend.audio.setCrossfade(v)
            update({ crossfadeMs: v })
          }}
        />
        <span className="tnum w-14 text-right text-sm tabular-nums text-mid">{(s.crossfadeMs / 1000).toFixed(1)} s</span>
      </Row>

      <Row label="Sans blanc (gapless)" hint="Lecture continue sans silence">
        <Toggle
          checked={s.gapless}
          onChange={(v) => {
            void backend.audio.setGapless(v)
            update({ gapless: v })
          }}
        />
      </Row>

      <Row label="ReplayGain" hint="Normalisation du volume">
        <div className="flex rounded-full border border-[var(--glass-border)] p-0.5">
          {gains.map((g) => (
            <button
              key={g.id}
              onClick={() => {
                void backend.audio.setReplayGain(g.id)
                update({ replayGain: g.id })
              }}
              className={cn(
                "focus-ring rounded-full px-3 py-1 text-xs font-medium transition-colors",
                s.replayGain === g.id ? "text-black" : "text-mid hover:text-hi",
              )}
              style={s.replayGain === g.id ? { background: "var(--accent)" } : undefined}
            >
              {g.label}
            </button>
          ))}
        </div>
      </Row>

      <Row label="Périphérique de sortie">
        <select
          value={devices.find((d) => d.active)?.id ?? ""}
          onChange={(e) => void selectDevice(e.target.value)}
          className="focus-ring rounded-xl border border-[var(--glass-border)] bg-white/5 px-3 py-2 text-sm text-hi outline-none"
        >
          {devices.map((d) => (
            <option key={d.id} value={d.id} className="bg-neutral-900 text-hi">
              {d.name}
            </option>
          ))}
        </select>
      </Row>
    </div>
  )
}

function AppearanceTab({ s, update }: { s: AppSettings; update: (p: Partial<AppSettings>) => void }) {
  return (
    <div className="divide-y divide-[var(--glass-border)]">
      <Row label="Thème">
        <div className="flex rounded-full border border-[var(--glass-border)] p-0.5">
          {(["dark", "light"] as const).map((t) => (
            <button
              key={t}
              onClick={() => update({ theme: t })}
              className={cn(
                "focus-ring rounded-full px-3 py-1 text-xs font-medium transition-colors",
                s.theme === t ? "text-black" : "text-mid hover:text-hi",
              )}
              style={s.theme === t ? { background: "var(--accent)" } : undefined}
            >
              {t === "dark" ? "Sombre" : "Clair"}
            </button>
          ))}
        </div>
      </Row>

      <Row label="Couleur d'accentuation">
        <div className="flex items-center gap-2">
          {ACCENTS.map((c) => (
            <button
              key={c}
              onClick={() => update({ accent: c })}
              aria-label={`Accent ${c}`}
              className="focus-ring grid h-6 w-6 place-items-center rounded-full transition-transform hover:scale-110"
              style={{ background: c }}
            >
              {s.accent.toLowerCase() === c.toLowerCase() && <Check size={13} className="text-black" />}
            </button>
          ))}
          <label className="focus-ring relative h-6 w-6 cursor-pointer overflow-hidden rounded-full border border-[var(--glass-border)]">
            <span
              className="block h-full w-full"
              style={{ background: "conic-gradient(red,orange,yellow,lime,cyan,blue,magenta,red)" }}
            />
            <input
              type="color"
              value={s.accent}
              onChange={(e) => update({ accent: e.target.value })}
              className="absolute inset-0 cursor-pointer opacity-0"
              aria-label="Couleur personnalisée"
            />
          </label>
        </div>
      </Row>

      <Row label="Couleur dynamique" hint="Adapter l'accent à la pochette">
        <Toggle checked={s.dynamicColor} onChange={(v) => update({ dynamicColor: v })} />
      </Row>

      <Row label="Intensité du flou">
        <Slider value={s.blurIntensity} min={0} max={100} onChange={(v) => update({ blurIntensity: v })} />
        <span className="tnum w-10 text-right text-sm tabular-nums text-mid">{s.blurIntensity}</span>
      </Row>

      <Row label="Animations" hint="Transitions et mouvements">
        <Toggle checked={s.animations} onChange={(v) => update({ animations: v })} />
      </Row>
    </div>
  )
}

function ShortcutsTab() {
  const [rows, setRows] = useState(SHORTCUTS)
  const [editing, setEditing] = useState<number | null>(null)

  useEffect(() => {
    if (editing === null) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      const keys: string[] = []
      if (e.ctrlKey) keys.push("Ctrl")
      if (e.altKey) keys.push("Alt")
      if (e.shiftKey) keys.push("Maj")
      const k = e.key === " " ? "Espace" : e.key.length === 1 ? e.key.toUpperCase() : e.key
      if (!["Control", "Alt", "Shift"].includes(e.key)) keys.push(k)
      if (keys.length) {
        setRows((prev) => prev.map((r, i) => (i === editing ? { ...r, keys } : r)))
        setEditing(null)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [editing])

  return (
    <div className="glass divide-y divide-[var(--glass-border)] rounded-2xl">
      {rows.map((sc, i) => (
        <button
          key={sc.label}
          onClick={() => setEditing(i)}
          className={cn(
            "flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-white/5",
            editing === i && "bg-white/5",
          )}
        >
          <span className="text-sm text-hi">{sc.label}</span>
          <span className="flex items-center gap-1.5">
            {editing === i ? (
              <span className="text-xs italic text-mid">Appuyez sur une touche…</span>
            ) : (
              sc.keys.map((k) => (
                <kbd
                  key={k}
                  className="rounded-md border border-[var(--glass-border)] bg-white/5 px-2 py-0.5 text-xs font-medium text-mid"
                >
                  {k}
                </kbd>
              ))
            )}
          </span>
        </button>
      ))}
    </div>
  )
}

function AboutTab() {
  return (
    <div className="glass rounded-2xl p-8 text-center">
      <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl text-2xl font-bold text-black" style={{ background: "var(--accent)" }}>
        A
      </div>
      <h2 className="text-xl font-semibold text-hi">Aura</h2>
      <p className="text-sm text-mid">Version 1.0.0</p>
      <p className="mx-auto mt-4 max-w-md text-sm text-mid">
        Lecteur de musique local haute-fidélité pour Linux. Conçu pour votre collection, avec un rendu soigné et une
        lecture sans compromis.
      </p>
      <div className="mx-auto mt-6 max-w-md text-xs text-lo">
        React · TypeScript · Tailwind CSS · Framer Motion · Zustand
      </div>
      <p className="mx-auto mt-4 max-w-md text-xs text-lo">
        Le moteur audio est fourni séparément — le backend est entièrement interchangeable.
      </p>
    </div>
  )
}

/* ---------- Screen ---------- */

export default function Settings() {
  const s = useSettings((x) => x.settings)
  const update = useSettings((x) => x.update)
  const [tab, setTab] = useState<TabId>("library")

  if (!s) return null

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-hi">Paramètres</h1>
        <p className="text-sm text-mid">Personnalisez Aura selon vos préférences.</p>
      </div>

      <div className="flex gap-8">
        <nav className="w-52 shrink-0">
          {TABS.map((t) => {
            const Icon = t.icon
            const active = tab === t.id
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "focus-ring relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors",
                  active ? "text-hi" : "text-mid hover:text-hi",
                )}
              >
                {active && (
                  <motion.span
                    layoutId="settings-tab"
                    className="absolute inset-0 rounded-xl bg-white/8"
                    transition={{ type: "spring", stiffness: 500, damping: 34 }}
                  />
                )}
                <Icon size={17} className="relative z-10" style={active ? { color: "var(--accent)" } : undefined} />
                <span className="relative z-10">{t.label}</span>
              </button>
            )
          })}
        </nav>

        <div className="min-w-0 flex-1">
          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
            >
              {tab === "library" && <LibraryTab s={s} update={update} />}
              {tab === "playback" && <PlaybackTab s={s} update={update} />}
              {tab === "appearance" && <AppearanceTab s={s} update={update} />}
              {tab === "shortcuts" && <ShortcutsTab />}
              {tab === "about" && <AboutTab />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
