import { type ReactNode, useEffect } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { X } from "lucide-react"

interface Props {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  width?: number
}

export default function Modal({ open, onClose, title, children, width = 460 }: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[120] grid place-items-center p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            className="glass-panel relative z-10 max-h-[80vh] overflow-auto rounded-3xl"
            style={{ width }}
          >
            {title && (
              <div className="flex items-center justify-between border-b border-[var(--glass-border)] px-6 py-4">
                <h2 className="text-lg font-semibold tracking-tight text-hi">{title}</h2>
                <button onClick={onClose} className="focus-ring rounded-full p-1.5 text-mid hover:text-hi" aria-label="Fermer">
                  <X size={18} />
                </button>
              </div>
            )}
            <div className="p-6">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
