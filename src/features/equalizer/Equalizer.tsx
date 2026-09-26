import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { motion } from "framer-motion"
import { Power, Save, RotateCcw } from "lucide-react"
import type { EqPreset } from "../../types"
import { backend } from "../../services"
import Modal from "../../components/Modal"
import { useUI } from "../../store/uiStore"
import { cn } from "../../utils/cn"

const FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]
const MIN = -12
const MAX = 12

function freqLabel(hz: number): string {
  return hz >= 1000 ? `${hz / 1000}kHz` : `${hz}Hz`
}

/** Build a smooth cubic-bezier SVG path through the given points. */
function smoothPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return ""
  let d = `M ${points[0].x} ${points[0].y}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[Math.min(points.length - 1, i + 2)]
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p2.x} ${p2.y}`
  }
  return d
}

interface VSliderProps {
  value: number
  onChange: (v: number) => void
  label: string
  top: string
  disabled?: boolean
}

function VSlider({ value, onChange, label, top, disabled }: VSliderProps) {
  const pct = (value - MIN) / (MAX - MIN)
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-2">
      <span className="tnum text-xs font-medium tabular-nums text-hi">
        {value > 0 ? "+" : ""}
        {value.toFixed(1)}
      </span>
      <div className="relative h-48 w-8">
        <input
          type="range"
          min={MIN}
          max={MAX}
          step={0.5}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={`Gain ${label}`}
          className="eq-vertical absolute inset-0 h-full w-full cursor-pointer disabled:cursor-default"
          style={{ writingMode: "vertical-lr", direction: "rtl" }}
        />
        <div className="pointer-events-none absolute left-1/2 top-0 h-full w-1.5 -translate-x-1/2 overflow-hidden rounded-full bg-white/10">
          <div
            className="absolute bottom-0 left-0 w-full rounded-full transition-[height] duration-75"
            style={{ height: `${pct * 100}%`, background: "var(--accent)", opacity: disabled ? 0.3 : 1 }}
          />
        </div>
        <div
          className="pointer-events-none absolute left-1/2 h-4 w-4 -translate-x-1/2 rounded-full border border-white/40 shadow-lg transition-[bottom] duration-75"
          style={{ bottom: `calc(${pct * 100}% - 8px)`, background: disabled ? "#666" : "var(--accent)" }}
        />
      </div>
      <span className="text-[10px] font-medium text-mid">{top}</span>
    </div>
  )
}

function HSlider({
  value,
  onChange,
  disabled,
}: {
  value: number
  onChange: (v: number) => void
  disabled?: boolean
}) {
  const pct = (value - MIN) / (MAX - MIN)
  return (
    <div className="relative h-6 flex-1">
      <input
        type="range"
        min={MIN}
        max={MAX}
        step={0.5}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="Préamplification"
        className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 disabled:cursor-default"
      />
      <div className="pointer-events-none absolute left-0 top-1/2 h-1.5 w-full -translate-y-1/2 overflow-hidden rounded-full bg-white/10">
        <div
          className="absolute left-0 top-0 h-full rounded-full"
          style={{ width: `${pct * 100}%`, background: "var(--accent)", opacity: disabled ? 0.3 : 1 }}
        />
      </div>
      <div
        className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border border-white/40 shadow-lg"
        style={{ left: `calc(${pct * 100}% - 8px)`, background: disabled ? "#666" : "var(--accent)" }}
      />
    </div>
  )
}

export default function Equalizer() {
  const [bands, setBands] = useState<number[]>(() => Array(10).fill(0))
  const [preamp, setPreamp] = useState(0)
  const [enabled, setEnabled] = useState(true)
  const [presets, setPresets] = useState<EqPreset[]>([])
  const [activePreset, setActivePreset] = useState<string | null>(null)
  const [saveOpen, setSaveOpen] = useState(false)
  const [name, setName] = useState("")
  const toast = useUI((s) => s.toast)

  useEffect(() => {
    let alive = true
    void (async () => {
      const [eq, ps] = await Promise.all([backend.audio.getEq(), backend.audio.getEqPresets()])
      if (!alive) return
      setBands(eq.bands.slice(0, 10))
      setPreamp(eq.preamp)
      setEnabled(eq.enabled)
      setPresets(ps)
    })()
    return () => {
      alive = false
    }
  }, [])

  const push = useCallback((b: number[], pre: number, en: boolean) => {
    void backend.audio.setEq(b, pre, en)
  }, [])

  const setBand = (i: number, v: number) => {
    setBands((prev) => {
      const next = prev.slice()
      next[i] = v
      push(next, preamp, enabled)
      return next
    })
    setActivePreset(null)
  }

  const applyPreset = (p: EqPreset) => {
    setBands(p.bands.slice(0, 10))
    setPreamp(p.preamp)
    setActivePreset(p.id)
    push(p.bands, p.preamp, enabled)
  }

  const reset = () => {
    const zero = Array(10).fill(0)
    setBands(zero)
    setPreamp(0)
    setActivePreset(null)
    push(zero, 0, enabled)
  }

  const toggleEnabled = () => {
    const next = !enabled
    setEnabled(next)
    push(bands, preamp, next)
  }

  const savePreset = async () => {
    const n = name.trim()
    if (!n) return
    const p = await backend.audio.saveEqPreset(n, bands, preamp)
    setPresets((prev) => [...prev, p])
    setActivePreset(p.id)
    setSaveOpen(false)
    setName("")
    toast(`Préréglage « ${n} » enregistré`)
  }

  // SVG curve geometry
  const W = 640
  const H = 200
  const curve = useMemo(() => {
    const pts = bands.map((g, i) => ({
      x: (i / (bands.length - 1)) * W,
      y: H / 2 - (g / MAX) * (H / 2 - 12),
    }))
    return smoothPath(pts)
  }, [bands])

  const areaPath = curve ? `${curve} L ${W} ${H} L 0 ${H} Z` : ""

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-hi">Égaliseur</h1>
          <p className="text-sm text-mid">Ajustez le son sur 10 bandes.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={reset}
            className="focus-ring flex items-center gap-2 rounded-full px-3 py-2 text-sm text-mid transition-colors hover:bg-white/8 hover:text-hi"
          >
            <RotateCcw size={16} /> Réinitialiser
          </button>
          <button
            onClick={toggleEnabled}
            aria-pressed={enabled}
            className={cn(
              "focus-ring flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors",
              enabled ? "text-black" : "text-mid hover:text-hi",
            )}
            style={enabled ? { background: "var(--accent)" } : { background: "rgba(255,255,255,0.06)" }}
          >
            <Power size={16} /> {enabled ? "Activé" : "Désactivé"}
          </button>
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn("glass-panel rounded-3xl p-6 transition-opacity", !enabled && "opacity-50")}
      >
        {/* Curve + sliders overlay */}
        <div className="relative">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full"
            aria-hidden
          >
            <defs>
              <linearGradient id="eqfill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.35" />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <line x1="0" y1={H / 2} x2={W} y2={H / 2} stroke="rgba(255,255,255,0.08)" strokeDasharray="4 6" />
            <motion.path d={areaPath} fill="url(#eqfill)" animate={{ d: areaPath }} transition={{ duration: 0.25 }} />
            <motion.path
              d={curve}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={2.5}
              strokeLinecap="round"
              animate={{ d: curve }}
              transition={{ duration: 0.25 }}
            />
          </svg>

          <div className="relative flex items-end gap-2 py-2">
            {bands.map((g, i) => (
              <VSlider
                key={FREQS[i]}
                value={g}
                onChange={(v) => setBand(i, v)}
                label={freqLabel(FREQS[i])}
                top={freqLabel(FREQS[i])}
                disabled={!enabled}
              />
            ))}
          </div>
        </div>

        {/* Preamp */}
        <div className="mt-6 flex items-center gap-4 border-t border-[var(--glass-border)] pt-5">
          <span className="w-28 text-sm font-medium text-hi">Préamplification</span>
          <HSlider value={preamp} onChange={(v) => setPreamp(v)} disabled={!enabled} />
          <span className="tnum w-14 text-right text-sm tabular-nums text-mid">
            {preamp > 0 ? "+" : ""}
            {preamp.toFixed(1)} dB
          </span>
        </div>
      </motion.div>

      {/* Presets */}
      <div className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-hi">Préréglages</h2>
          <button
            onClick={() => setSaveOpen(true)}
            className="focus-ring flex items-center gap-2 rounded-full px-3 py-1.5 text-sm text-mid transition-colors hover:bg-white/8 hover:text-hi"
          >
            <Save size={15} /> Enregistrer un préréglage
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {presets.map((p) => (
            <button
              key={p.id}
              onClick={() => applyPreset(p)}
              className={cn(
                "focus-ring rounded-full border px-4 py-1.5 text-sm transition-colors",
                activePreset === p.id
                  ? "border-transparent text-black"
                  : "border-[var(--glass-border)] text-mid hover:text-hi",
              )}
              style={activePreset === p.id ? { background: "var(--accent)" } : undefined}
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>

      <Modal open={saveOpen} onClose={() => setSaveOpen(false)} title="Enregistrer un préréglage">
        <div className="flex flex-col gap-4">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void savePreset()}
            placeholder="Nom du préréglage"
            className="focus-ring w-full rounded-xl border border-[var(--glass-border)] bg-white/5 px-4 py-2.5 text-sm text-hi outline-none placeholder:text-lo"
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setSaveOpen(false)}
              className="focus-ring rounded-full px-4 py-2 text-sm text-mid hover:text-hi"
            >
              Annuler
            </button>
            <button
              onClick={() => void savePreset()}
              disabled={!name.trim()}
              className="focus-ring rounded-full px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
              style={{ background: "var(--accent)" }}
            >
              Enregistrer
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
