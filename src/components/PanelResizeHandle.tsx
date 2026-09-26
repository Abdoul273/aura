import { useRef } from "react"

type Side = "sidebar" | "drawer"
const limits = { sidebar: [190, 420], drawer: [280, 620] } as const

export function savedPanelWidth(side: Side): number {
  const fallback = side === "sidebar" ? 248 : 340
  const value = Number(localStorage.getItem(`aura:${side}-width`))
  return Number.isFinite(value) && value >= limits[side][0] && value <= limits[side][1] ? value : fallback
}

export default function PanelResizeHandle({ side }: { side: Side }) {
  const handle = useRef<HTMLDivElement>(null)
  const value = useRef(savedPanelWidth(side))
  const setWidth = (next: number) => {
    const [min, max] = limits[side]
    value.current = Math.max(min, Math.min(max, next))
    handle.current?.closest<HTMLElement>("[data-panel-layout]")?.style.setProperty(`--${side}-width`, `${value.current}px`)
    handle.current?.setAttribute("aria-valuenow", String(Math.round(value.current)))
  }
  return <div
    ref={handle}
    role="separator"
    aria-label={side === "sidebar" ? "Largeur de la barre latérale" : "Largeur du panneau droit"}
    aria-orientation="vertical"
    aria-valuemin={limits[side][0]}
    aria-valuemax={limits[side][1]}
    aria-valuenow={value.current}
    tabIndex={0}
    className="panel-resize-handle group relative z-30 w-2 shrink-0 cursor-col-resize touch-none focus-ring"
    onPointerDown={(event) => {
      event.currentTarget.setPointerCapture(event.pointerId)
      event.currentTarget.dataset.dragging = "true"
    }}
    onPointerMove={(event) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
      const layout = event.currentTarget.closest<HTMLElement>("[data-panel-layout]")
      if (!layout) return
      const rect = layout.getBoundingClientRect()
      const other = layout.querySelector<HTMLElement>(`[data-panel="${side === "sidebar" ? "drawer" : "sidebar"}"]`)
      const otherWidth = other?.getBoundingClientRect().width ?? 0
      const width = side === "sidebar" ? event.clientX - rect.left : rect.right - event.clientX
      setWidth(Math.min(width, rect.width - otherWidth - 320))
    }}
    onPointerUp={(event) => {
      event.currentTarget.releasePointerCapture(event.pointerId)
      delete event.currentTarget.dataset.dragging
      localStorage.setItem(`aura:${side}-width`, String(Math.round(value.current)))
    }}
    onPointerCancel={(event) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      delete event.currentTarget.dataset.dragging
    }}
    onKeyDown={(event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return
      event.preventDefault()
      const direction = side === "sidebar" ? 1 : -1
      setWidth(event.key === "Home" ? limits[side][0] : event.key === "End" ? limits[side][1] : value.current + (event.key === "ArrowRight" ? direction : -direction) * 10)
      localStorage.setItem(`aura:${side}-width`, String(Math.round(value.current)))
    }}
  />
}
