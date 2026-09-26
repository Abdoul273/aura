import { useState, type ReactNode } from "react"
import { AnimatePresence, motion } from "framer-motion"

interface Props {
  label: string
  children: ReactNode
  side?: "top" | "bottom"
}

export default function Tooltip({ label, children, side = "top" }: Props) {
  const [open, setOpen] = useState(false)
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={() => setOpen(false)}
    >
      {children}
      <AnimatePresence>
        {open && (
          <motion.span
            role="tooltip"
            initial={{ opacity: 0, y: side === "top" ? 4 : -4, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.14 }}
            className="glass pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-medium text-hi"
            style={side === "top" ? { bottom: "calc(100% + 8px)" } : { top: "calc(100% + 8px)" }}
          >
            {label}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  )
}
