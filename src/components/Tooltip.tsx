import { useEffect, useRef, useState, type ReactNode } from "react"

interface Props {
  label: string
  children: ReactNode
  side?: "top" | "bottom"
}

export default function Tooltip({ label, children, side = "top" }: Props) {
  const [open, setOpen] = useState(false)
  const timer = useRef(0)
  const show = () => { timer.current = window.setTimeout(() => setOpen(true), 500) }
  const hide = () => { window.clearTimeout(timer.current); setOpen(false) }
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocusCapture={() => { window.clearTimeout(timer.current); setOpen(true) }}
      onBlurCapture={hide}
    >
      {children}
        {open && (
          <span
            role="tooltip"
            className="pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-md border border-[var(--glass-border)] bg-[var(--bg-1)] px-2 py-0.5 text-[10px] font-medium text-hi shadow-md"
            style={side === "top" ? { bottom: "calc(100% + 5px)" } : { top: "calc(100% + 5px)" }}
          >
            {label}
          </span>
        )}
    </span>
  )
}
