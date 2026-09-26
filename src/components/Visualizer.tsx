import { useEffect, useRef } from "react"
import { usePlayer } from "../store/playerStore"

export type VizMode = "bars" | "circular" | "waves"

interface Props {
  mode: VizMode
  color?: string
}

// Canvas visualizer driven by the analyser stream in the player store.
export default function Visualizer({ mode, color = "#ffffff" }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const dataRef = useRef<number[]>([])

  useEffect(() => {
    const unsub = usePlayer.subscribe((s) => {
      dataRef.current = s.analyser
    })
    dataRef.current = usePlayer.getState().analyser
    return unsub
  }, [])

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")!
    let raf = 0
    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      canvas.width = canvas.clientWidth * dpr
      canvas.height = canvas.clientHeight * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener("resize", resize)

    const draw = () => {
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      ctx.clearRect(0, 0, w, h)
      const bins = dataRef.current
      const n = bins.length || 64

      if (mode === "bars") {
        const bw = w / n
        for (let i = 0; i < n; i++) {
          const v = bins[i] ?? 0
          const bh = v * h * 0.9
          ctx.fillStyle = color
          ctx.globalAlpha = 0.35 + v * 0.65
          const x = i * bw
          const r = Math.min(bw * 0.35, 4)
          roundRect(ctx, x + bw * 0.15, h - bh, bw * 0.7, bh, r)
          ctx.fill()
        }
        ctx.globalAlpha = 1
      } else if (mode === "circular") {
        const cx = w / 2
        const cy = h / 2
        const radius = Math.min(w, h) * 0.22
        for (let i = 0; i < n; i++) {
          const v = bins[i] ?? 0
          const ang = (i / n) * Math.PI * 2 - Math.PI / 2
          const len = radius + v * radius * 1.6
          ctx.beginPath()
          ctx.strokeStyle = color
          ctx.globalAlpha = 0.4 + v * 0.6
          ctx.lineWidth = 3
          ctx.lineCap = "round"
          ctx.moveTo(cx + Math.cos(ang) * radius, cy + Math.sin(ang) * radius)
          ctx.lineTo(cx + Math.cos(ang) * len, cy + Math.sin(ang) * len)
          ctx.stroke()
        }
        ctx.globalAlpha = 1
      } else {
        // waves
        for (let layer = 0; layer < 3; layer++) {
          ctx.beginPath()
          ctx.globalAlpha = 0.15 + layer * 0.15
          ctx.strokeStyle = color
          ctx.lineWidth = 2
          for (let i = 0; i <= n; i++) {
            const v = bins[i % n] ?? 0
            const x = (i / n) * w
            const y = h / 2 + Math.sin(i * 0.3 + layer * 1.5) * v * h * 0.35 * (layer + 1) * 0.4
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
          }
          ctx.stroke()
        }
        ctx.globalAlpha = 1
      }
      raf = requestAnimationFrame(draw)
    }
    draw()
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("resize", resize)
    }
  }, [mode, color])

  return <canvas ref={ref} className="h-full w-full" />
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  if (h < r * 2) r = h / 2
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
