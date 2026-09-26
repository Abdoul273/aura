import { useEffect, useRef, useState } from "react"
import { backend } from "../services"
import { usePlayer } from "../store/playerStore"
import type { Lyrics } from "../types"
import { motion } from "framer-motion"
import { cn } from "../utils/cn"

interface Props {
  large?: boolean
}

export default function LyricsView({ large }: Props) {
  const trackId = usePlayer((s) => s.currentTrackId)
  const positionMs = usePlayer((s) => s.positionMs)
  const seek = usePlayer((s) => s.seek)
  const [lyrics, setLyrics] = useState<Lyrics>(null)
  const [loading, setLoading] = useState(false)
  const activeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!trackId) {
      setLyrics(null)
      return
    }
    setLoading(true)
    backend.lyrics.get(trackId).then((l) => {
      setLyrics(l)
      setLoading(false)
    })
  }, [trackId])

  const activeIndex =
    lyrics?.kind === "synced" ? lyrics.lines.findIndex((l, i) => positionMs >= l.timeMs && (i === lyrics.lines.length - 1 || positionMs < lyrics.lines[i + 1].timeMs)) : -1

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })
  }, [activeIndex])

  if (loading) return <div className="p-6 text-sm text-lo">Chargement des paroles…</div>
  if (!lyrics) return <div className="grid place-items-center p-10 text-center text-sm text-lo">Aucune parole disponible pour ce titre.</div>

  if (lyrics.kind === "plain") {
    return <div className={cn("whitespace-pre-line p-6 leading-relaxed text-mid", large && "text-2xl leading-loose")}>{lyrics.text}</div>
  }

  return (
    <div className={cn("space-y-2 px-6 py-4", large && "space-y-5 px-0")}>
      {lyrics.lines.map((line, i) => {
        const active = i === activeIndex
        const past = i < activeIndex
        return (
          <motion.button
            key={i}
            ref={active ? activeRef : undefined}
            onClick={() => seek(line.timeMs)}
            animate={{ scale: active && large ? 1.05 : 1, opacity: active ? 1 : past ? 0.35 : 0.6 }}
            className={cn(
              "block w-full origin-left text-left font-semibold transition-colors",
              large ? "text-3xl leading-snug" : "text-base",
              active ? "text-hi" : "text-mid hover:text-hi",
            )}
            style={active ? { color: large ? "#fff" : "var(--accent)" } : undefined}
          >
            {line.text}
          </motion.button>
        )
      })}
    </div>
  )
}
