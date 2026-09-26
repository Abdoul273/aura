import { AnimatePresence, motion } from "framer-motion"
import { useUI } from "../store/uiStore"

export default function Toasts() {
  const toasts = useUI((s) => s.toasts)
  const dismiss = useUI((s) => s.dismissToast)
  return (
    <div className="pointer-events-none fixed bottom-28 right-6 z-[130] flex w-80 flex-col items-end gap-2">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, x: 40, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40, scale: 0.9 }}
            transition={{ type: "spring", stiffness: 400, damping: 32 }}
            className="glass pointer-events-auto flex w-full items-center gap-3 rounded-2xl px-4 py-3"
          >
            <span className="flex-1 text-sm text-hi">{t.message}</span>
            {t.action && (
              <button
                onClick={() => {
                  t.action!.onClick()
                  dismiss(t.id)
                }}
                className="text-sm font-semibold"
                style={{ color: "var(--accent)" }}
              >
                {t.action.label}
              </button>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
