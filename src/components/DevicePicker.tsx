import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Speaker, Headphones, MonitorSpeaker, Bluetooth, Check } from "lucide-react"
import { backend } from "../services"
import type { AudioDevice } from "../types"
import Tooltip from "./Tooltip"

const iconFor = (t: AudioDevice["type"]) => (t === "headphones" ? Headphones : t === "hdmi" ? MonitorSpeaker : t === "bluetooth" ? Bluetooth : Speaker)

export default function DevicePicker() {
  const [open, setOpen] = useState(false)
  const [devices, setDevices] = useState<AudioDevice[]>([])
  const ref = useRef<HTMLDivElement>(null)

  const refresh = () => backend.audio.getDevices().then(setDevices)
  useEffect(() => {
    refresh()
  }, [])
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    window.addEventListener("mousedown", onDown)
    return () => window.removeEventListener("mousedown", onDown)
  }, [open])

  const active = devices.find((d) => d.active)
  const ActiveIcon = active ? iconFor(active.type) : Speaker

  return (
    <div ref={ref} className="relative">
      <Tooltip label="Sortie audio">
        <button onClick={() => setOpen((o) => !o)} aria-label="Périphérique de sortie" className="focus-ring text-mid hover:text-hi">
          <ActiveIcon size={19} />
        </button>
      </Tooltip>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            className="glass absolute bottom-full right-0 mb-3 w-64 rounded-2xl p-1.5"
          >
            <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-lo">Sortie audio</div>
            {devices.map((d) => {
              const I = iconFor(d.type)
              return (
                <button
                  key={d.id}
                  onClick={async () => {
                    await backend.audio.setDevice(d.id)
                    refresh()
                    setOpen(false)
                  }}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-mid transition-colors hover:bg-white/8 hover:text-hi"
                >
                  <I size={16} />
                  <span className="flex-1 truncate">{d.name}</span>
                  {d.active && <Check size={15} style={{ color: "var(--accent)" }} />}
                </button>
              )
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
