import { useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { AnimatePresence, motion } from "framer-motion"
import { Check, ChevronDown } from "lucide-react"
import { cn } from "../utils/cn"

export interface SelectOption<T extends string> {
  value: T
  label: string
}

interface Props<T extends string> {
  value: T
  onChange: (v: T) => void
  options: SelectOption<T>[]
  /** Option vide ("") affichée en tête, ex. « Tous les genres ». */
  placeholder?: string
  ariaLabel?: string
  size?: "sm" | "md"
  className?: string
}

// Liste déroulante maison : le <select> natif est dessiné par GTK sous WebKitGTK
// (fond blanc, hors thème). Menu en portail pour échapper aux overflow des panneaux.
export default function Select<T extends string>({ value, onChange, options, placeholder, ariaLabel, size = "md", className }: Props<T>) {
  const all: SelectOption<T>[] = placeholder ? [{ value: "" as T, label: placeholder }, ...options] : options
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [pos, setPos] = useState<{ left: number; top: number; width: number; maxH: number; up: boolean }>()
  const btnRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const typed = useRef({ text: "", at: 0 })
  const id = useId()

  const current = all.find((o) => o.value === value)
  const isPlaceholder = !current || (placeholder !== undefined && value === "")

  const place = () => {
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    const below = window.innerHeight - r.bottom - 12
    const above = r.top - 12
    const up = below < 220 && above > below
    setPos({ left: r.left, top: up ? r.top - 6 : r.bottom + 6, width: r.width, maxH: Math.min(320, up ? above : below), up })
  }

  const openMenu = () => {
    place()
    setActive(Math.max(0, all.findIndex((o) => o.value === value)))
    setOpen(true)
  }
  const close = (focus = true) => {
    setOpen(false)
    if (focus) btnRef.current?.focus()
  }
  const pick = (i: number) => {
    const o = all[i]
    if (o && o.value !== value) onChange(o.value)
    close()
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!btnRef.current?.contains(t) && !listRef.current?.contains(t)) close(false)
    }
    const onScroll = (e: Event) => { if (!listRef.current?.contains(e.target as Node)) close(false) }
    const onResize = () => close(false)
    window.addEventListener("mousedown", onDown)
    window.addEventListener("scroll", onScroll, true)
    window.addEventListener("resize", onResize)
    return () => {
      window.removeEventListener("mousedown", onDown)
      window.removeEventListener("scroll", onScroll, true)
      window.removeEventListener("resize", onResize)
    }
  }, [open])

  useLayoutEffect(() => {
    if (open) listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" })
  }, [open, active])

  const onKey = (e: React.KeyboardEvent) => {
    const last = all.length - 1
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) { e.preventDefault(); openMenu() }
      return
    }
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); setActive((i) => Math.min(last, i + 1)); return
      case "ArrowUp": e.preventDefault(); setActive((i) => Math.max(0, i - 1)); return
      case "Home": e.preventDefault(); setActive(0); return
      case "End": e.preventDefault(); setActive(last); return
      case "Enter": case " ": e.preventDefault(); pick(active); return
      case "Escape": e.preventDefault(); e.stopPropagation(); close(); return
      case "Tab": close(false); return
    }
    if (e.key.length === 1) {
      const now = Date.now()
      typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : "") + e.key.toLowerCase(), at: now }
      const i = all.findIndex((o) => o.label.toLowerCase().startsWith(typed.current.text))
      if (i >= 0) setActive(i)
    }
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onKey}
        className={cn(
          "focus-ring flex min-w-40 items-center justify-between gap-2 rounded-xl border bg-white/5 text-left transition-colors hover:bg-white/8",
          open ? "border-[var(--accent)]" : "border-[var(--glass-border)]",
          size === "sm" ? "px-3 py-2 text-xs" : "px-3 py-2 text-sm",
          className,
        )}
      >
        <span className={cn("truncate", isPlaceholder ? "text-mid" : "text-hi")}>{current?.label ?? placeholder ?? ""}</span>
        <ChevronDown size={size === "sm" ? 14 : 16} className={cn("shrink-0 text-lo transition-transform duration-200", open && "rotate-180")} />
      </button>
      {createPortal(
        <AnimatePresence>
          {open && pos && (
            <motion.div
              ref={listRef}
              id={id}
              role="listbox"
              aria-label={ariaLabel}
              initial={{ opacity: 0, y: pos.up ? 6 : -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: pos.up ? 6 : -6, scale: 0.98 }}
              transition={{ duration: 0.14, ease: "easeOut" }}
              style={{
                left: pos.left,
                top: pos.top,
                minWidth: pos.width,
                maxHeight: pos.maxH,
                translate: pos.up ? "0 -100%" : undefined,
                background: "color-mix(in srgb, var(--bg-1) 82%, transparent)",
              }}
              className={cn("glass fixed z-[200] max-w-80 overflow-y-auto rounded-2xl p-1.5", pos.up ? "origin-bottom" : "origin-top")}
            >
              {all.map((o, i) => {
                const selected = o.value === value
                return (
                  <div
                    key={o.value || "__all"}
                    id={`${id}-${i}`}
                    data-i={i}
                    role="option"
                    aria-selected={selected}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(i)}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors",
                      i === active ? "bg-white/8 text-hi" : "text-mid",
                      selected && "font-medium text-hi",
                    )}
                  >
                    <span className="flex-1 truncate">{o.label}</span>
                    {selected && <Check size={15} className="shrink-0" style={{ color: "var(--accent)" }} />}
                  </div>
                )
              })}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  )
}
