import { useMemo, useRef, useState } from "react"
import { seededRandom } from "../utils/color"
import { formatTime } from "../utils/format"

interface Props {
  positionMs: number
  durationMs: number
  onSeek: (ms: number) => void
  seed: string
  bars?: number
}

// A static waveform whose bars fill up to the playhead. Hovering shows a time
// preview; clicking/dragging seeks.
export default function WaveformSeek({ positionMs, durationMs, onSeek, seed, bars = 96 }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)

  const heights = useMemo(() => {
    const r = seededRandom(seed || "wave")
    return Array.from({ length: bars }, (_, i) => {
      const env = Math.sin((i / bars) * Math.PI) // taller in the middle
      return 0.18 + (0.35 + r() * 0.65) * (0.5 + env * 0.5)
    })
  }, [seed, bars])

  const progress = durationMs > 0 ? positionMs / durationMs : 0

  const posFromEvent = (clientX: number) => {
    const el = ref.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
  }

  const commit = (clientX: number) => onSeek(posFromEvent(clientX) * durationMs)

  return (
    <div className="flex items-center gap-3">
      <span className="w-10 shrink-0 text-right text-xs text-lo tnum">{formatTime(positionMs)}</span>
      <div
        ref={ref}
        role="slider"
        aria-label="Progression"
        aria-valuenow={Math.round(positionMs / 1000)}
        aria-valuemax={Math.round(durationMs / 1000)}
        tabIndex={0}
        className="group relative flex h-8 flex-1 cursor-pointer items-center gap-[2px]"
        onMouseMove={(e) => setHover(posFromEvent(e.clientX))}
        onMouseLeave={() => setHover(null)}
        onMouseDown={(e) => {
          setDragging(true)
          commit(e.clientX)
          const move = (ev: MouseEvent) => commit(ev.clientX)
          const up = () => {
            setDragging(false)
            window.removeEventListener("mousemove", move)
            window.removeEventListener("mouseup", up)
          }
          window.addEventListener("mousemove", move)
          window.addEventListener("mouseup", up)
        }}
      >
        {heights.map((h, i) => {
          const filled = i / bars <= progress
          const hovered = hover !== null && i / bars <= hover
          return (
            <span
              key={i}
              className="flex-1 rounded-full transition-colors"
              style={{
                height: `${h * 100}%`,
                background: filled ? "var(--accent)" : hovered ? "var(--text-mid)" : "rgba(255,255,255,0.16)",
                minWidth: 2,
              }}
            />
          )
        })}
        {hover !== null && durationMs > 0 && (
          <span
            className="glass pointer-events-none absolute -top-8 -translate-x-1/2 rounded-lg px-2 py-0.5 text-xs text-hi tnum"
            style={{ left: `${hover * 100}%` }}
          >
            {formatTime(hover * durationMs)}
          </span>
        )}
        {dragging && <span className="sr-only">seeking</span>}
      </div>
    </div>
  )
}
