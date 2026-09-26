import type { Track } from "../types"
import { cn } from "../utils/cn"

// Derives a compact audio-quality badge from raw track fields, e.g.
// "HI-RES 24/96", "FLAC 16/44", "MP3 320".
export function qualityLabel(t: Track): string {
  const khz = Math.round(t.sampleRate / 1000)
  if (t.quality === "Hi-Res") return `HI-RES ${t.bitDepth}/${khz}`
  if (t.quality === "Lossless") return `${t.codec} ${t.bitDepth}/${khz}`
  return `${t.codec} ${t.bitrate}`
}

export default function QualityBadge({ track, className }: { track: Track; className?: string }) {
  const hiRes = track.quality === "Hi-Res"
  const lossless = track.quality === "Lossless"
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide leading-none",
        className,
      )}
      style={{
        color: hiRes ? "#0a0a0a" : lossless ? "var(--accent)" : "var(--text-mid)",
        background: hiRes ? "linear-gradient(120deg,#f5d16b,#e8b23a)" : "color-mix(in srgb, var(--glass-hi) 60%, transparent)",
        border: hiRes ? "none" : "1px solid var(--glass-border)",
      }}
      title={`${track.codec} · ${track.bitDepth} bits · ${(track.sampleRate / 1000).toFixed(1)} kHz · ${track.bitrate} kbps`}
    >
      {qualityLabel(track)}
    </span>
  )
}
