import { useState } from "react"
import type { AlbumColors } from "../types"
import { backend } from "../services"
import { useLibrary } from "../store/libraryStore"
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
  alt?: string
  priority?: boolean
}

// Album/playlist cover. Renders a deterministic gradient immediately and, when
// enabled, layers the real artwork (from the backend) on top once it loads.
export default function CoverArt({ colors, seed, size = 200, rounded = "rounded-2xl", className, usePhoto = true, icon, alt = "", priority = false }: Props) {
  const libraryVersion = useLibrary((s) => s.version)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const baseUrl = usePhoto && seed ? backend.artwork.getUrl(seed, size) : ""
  const url = baseUrl ? `${baseUrl}?v=${libraryVersion}` : ""
  const photo = url && url !== failedUrl ? url : null
  return (
    <div
      className={cn("relative overflow-hidden select-none", rounded, className)}
      style={{ background: coverGradient(colors), aspectRatio: "1 / 1" }}
    >
      {icon && !photo && (
        <div className="absolute inset-0 grid place-items-center">
          <Music className="opacity-40" size={size * 0.28} strokeWidth={1.2} />
        </div>
      )}
      {photo && (
        <img
          src={photo}
          alt={alt}
          loading="eager"
          decoding="async"
          fetchPriority={priority ? "high" : "auto"}
          onError={() => setFailedUrl(photo)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      <div className="absolute inset-0" style={{ boxShadow: "inset 0 1px 0 0 rgba(255,255,255,.18), inset 0 0 40px -12px rgba(0,0,0,.5)" }} />
    </div>
  )
}
