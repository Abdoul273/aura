import { type ReactNode } from "react"
import { motion } from "framer-motion"

interface Props {
  icon: ReactNode
  title: string
  description: string
  action?: { label: string; onClick: () => void }
}

export default function EmptyState({ icon, title, description, action }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="grid place-items-center px-6 py-20 text-center"
    >
      <div className="glass mb-6 grid h-24 w-24 place-items-center rounded-3xl" style={{ color: "var(--accent)" }}>
        {icon}
      </div>
      <h3 className="text-xl font-semibold tracking-tight text-hi">{title}</h3>
      <p className="mt-2 max-w-sm text-sm text-mid">{description}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="focus-ring mt-6 rounded-full px-5 py-2.5 text-sm font-semibold text-white transition-transform active:scale-95"
          style={{ background: "var(--accent)" }}
        >
          {action.label}
        </button>
      )}
    </motion.div>
  )
}
