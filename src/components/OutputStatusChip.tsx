import { useEffect, useState } from "react"
import { Activity, Zap } from "lucide-react"
import { backend } from "../services"
import type { OutputStatus } from "../types"
import Tooltip from "./Tooltip"
import { cn } from "../utils/cn"

// Small audio-output status chip fed by the backend audio state
// (e.g. "ALSA · BIT-PERFECT"). Updates when the device or track changes.
export default function OutputStatusChip({ collapsed }: { collapsed?: boolean }) {
  const [status, setStatus] = useState<OutputStatus | null>(null)

  useEffect(() => backend.audio.onOutputChange(setStatus), [])
  if (!status) return null

  const mode = status.bitPerfect ? "BIT-PERFECT" : "MIXÉ"
  const detail = `${status.driver} · ${mode}`
  const full = `${status.deviceName} — ${status.bitDepth}/${Math.round(status.sampleRate / 1000)} kHz`

  const chip = (
    <div
      className={cn(
        "flex items-center gap-2 rounded-xl border px-2.5 py-2",
        collapsed && "justify-center px-0",
      )}
      style={{ borderColor: "var(--glass-border)", background: "color-mix(in srgb, var(--glass-hi) 40%, transparent)" }}
    >
      <span
        className="grid h-6 w-6 shrink-0 place-items-center rounded-lg"
        style={{ background: status.bitPerfect ? "color-mix(in srgb, var(--accent) 25%, transparent)" : "rgba(255,255,255,0.08)" }}
      >
        {status.bitPerfect ? <Zap size={13} style={{ color: "var(--accent)" }} /> : <Activity size={13} className="text-mid" />}
      </span>
      {!collapsed && (
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-[11px] font-bold uppercase tracking-wide text-hi">{detail}</div>
          <div className="truncate text-[10px] text-lo tnum">{status.bitDepth}/{Math.round(status.sampleRate / 1000)} kHz</div>
        </div>
      )}
    </div>
  )

  return collapsed ? <Tooltip label={`${detail} · ${full}`} side="top">{chip}</Tooltip> : <Tooltip label={full} side="top">{chip}</Tooltip>
}
