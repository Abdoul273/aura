import { useState } from "react"
import type { AlbumColors } from "../types"
import { coverGradient } from "../utils/color"
import { cn } from "../utils/cn"
import { Music } from "lucide-react"

interface Props {
  colors: AlbumColors
  seed?: string
  size?: number
  rounded?: string
  className?: string
  usePhoto?: boolean
  icon?: boolean
}

// Album/playlist cover. Renders a deterministic gradient immediately and, when
// enabled, layers a picsum photo on top once it loads (never blocks layout).
export default function CoverArt({ colors, seed, size = 200, rounded = "rounded-2xl", className, usePhoto = true, icon }: Props) {
  const [loaded, setLoaded] = useState(false)
  const photo = usePhoto && seed ? `https://picsum.photos/seed/${seed}/${Math.min(size * 2, 600)}` : null
  return (
    <div
      className={cn("relative overflow-hidden select-none", rounded, className)}
      style={{ background: coverGradient(colors), aspectRatio: "1 / 1" }}
    >
      {icon && !loaded && (
        <div className="absolute inset-0 grid place-items-center">
          <Music className="opacity-40" size={size * 0.28} strokeWidth={1.2} />
        </div>
      )}
      {photo && (
        <img
          src={photo}
          alt=""
          loading="lazy"
          onLoad={() => setLoaded(true)}
          className={cn("absolute inset-0 h-full w-full object-cover transition-opacity duration-700", loaded ? "opacity-100" : "opacity-0")}
        />
      )}
      <div className="absolute inset-0" style={{ boxShadow: "inset 0 1px 0 0 rgba(255,255,255,.18), inset 0 0 40px -12px rgba(0,0,0,.5)" }} />
    </div>
  )
}
