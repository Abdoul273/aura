import { motion } from "framer-motion"

// Slow animated aurora built from the dynamic-color CSS variables. Sits behind
// the whole app; never distracting.
export default function DynamicBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-[var(--bg-0)]">
      <motion.div
        className="aurora absolute -inset-[20%]"
        style={{
          background:
            "radial-gradient(40% 40% at 20% 25%, var(--dyn-accent) 0%, transparent 60%)," +
            "radial-gradient(45% 45% at 80% 20%, var(--dyn-dominant) 0%, transparent 60%)," +
            "radial-gradient(50% 50% at 70% 85%, var(--dyn-muted) 0%, transparent 60%)," +
            "radial-gradient(45% 45% at 25% 80%, var(--dyn-dominant) 0%, transparent 55%)",
          filter: "blur(55px)",
          opacity: 0.85,
          transition: "background 800ms ease",
        }}
      />
      <div className="noise absolute inset-0" />
      <div className="absolute inset-0" style={{ background: "linear-gradient(to bottom, transparent 60%, color-mix(in srgb, var(--bg-0) 70%, transparent))" }} />
    </div>
  )
}
