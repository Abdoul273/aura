import { motion, AnimatePresence } from "framer-motion"
import {
  Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1, Heart,
  Mic2, ListMusic, Minimize2, Maximize2,
} from "lucide-react"
import { usePlayer } from "../../store/playerStore"
import { useUI } from "../../store/uiStore"
import { useLibrary } from "../../store/libraryStore"
import { useSettings } from "../../store/settingsStore"
import { backend } from "../../services"
import CoverArt from "../../components/CoverArt"
import IconButton from "../../components/IconButton"
import WaveformSeek from "../../components/WaveformSeek"
import VolumeControl from "../../components/VolumeControl"
import DevicePicker from "../../components/DevicePicker"
import QualityBadge from "../../components/QualityBadge"
import Tooltip from "../../components/Tooltip"
import { formatTime } from "../../utils/format"
import { useEffect, useState } from "react"
import type { RadioStation } from "../../types"

export default function PlayerBar() {
  const p = usePlayer()
  const ui = useUI()
  const favorites = useLibrary((s) => s.favorites)
  const toggleFav = useLibrary((s) => s.toggleFavorite)
  const drawerOpen = useSettings((s) => s.settings?.drawerOpen ?? false)
  const drawerTab = useSettings((s) => s.settings?.drawerTab ?? "queue")
  const updateSettings = useSettings((s) => s.update)
  const [showRemaining, setShowRemaining] = useState(false)
  const [radio, setRadio] = useState<RadioStation | null>(null)

  useEffect(() => {
    if (p.radioId) backend.radio.list().then((rs) => setRadio(rs.find((r) => r.id === p.radioId) ?? null))
    else setRadio(null)
  }, [p.radioId])

  const track = p.currentTrack
  const isFav = track ? favorites.has(track.id) || track.favorite : false
  const RepeatIcon = p.repeat === "one" ? Repeat1 : Repeat

  const openDrawer = (tab: "queue" | "lyrics") => {
    if (drawerOpen && drawerTab === tab) updateSettings({ drawerOpen: false })
    else updateSettings({ drawerOpen: true, drawerTab: tab })
  }

  return (
    <div className="glass-panel z-30 flex h-[92px] items-center gap-4 rounded-3xl px-4">
      {/* Left: track info */}
      <div className="flex w-[26%] min-w-0 items-center gap-3">
        {track || radio ? (
          <>
            <motion.button
              layoutId="np-cover"
              onClick={() => ui.setNowPlaying(true)}
              className="shrink-0"
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.97 }}
            >
              <CoverArt
                colors={track?.colors ?? radio!.colors}
                seed={track?.albumId ?? radio!.id}
                size={60}
                rounded="rounded-xl"
                usePhoto={!!track}
                icon={!track}
                className="h-15 w-15 shadow-lg"
              />
            </motion.button>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <button onClick={() => track && ui.navigate({ name: "album", id: track.albumId })} className="min-w-0 truncate text-left text-sm font-semibold text-hi hover:underline">
                  {track?.title ?? radio!.name}
                </button>
                {track && <QualityBadge track={track} />}
              </div>
              <button onClick={() => track && ui.navigate({ name: "artist", id: track.artistId })} className="block max-w-full truncate text-left text-xs text-mid hover:underline">
                {track?.artist ?? radio!.nowPlaying ?? radio!.genre}
              </button>
            </div>
            {track && (
              <IconButton label={isFav ? "Retirer des favoris" : "J'aime"} onClick={() => toggleFav(track.id)} size={34}>
                <Heart size={17} className={isFav ? "" : ""} style={isFav ? { color: "var(--accent)", fill: "var(--accent)" } : undefined} />
              </IconButton>
            )}
          </>
        ) : (
          <span className="text-sm text-lo">Aucune lecture en cours</span>
        )}
      </div>

      {/* Center: controls + seek */}
      <div className="flex flex-1 flex-col items-center gap-1.5">
        <div className="flex items-center gap-2">
          <IconButton label="Aléatoire" active={p.shuffle} onClick={p.toggleShuffle} size={34}>
            <Shuffle size={16} />
          </IconButton>
          <IconButton label="Précédent" onClick={p.previous} size={38}>
            <SkipBack size={19} fill="currentColor" />
          </IconButton>
          <Tooltip label={p.status === "playing" ? "Pause" : "Lecture"}>
            <motion.button
              onClick={p.toggle}
              whileTap={{ scale: 0.92 }}
              aria-label={p.status === "playing" ? "Pause" : "Lecture"}
              className="focus-ring grid h-11 w-11 place-items-center rounded-full bg-white text-black shadow-lg"
            >
              <AnimatePresence mode="wait" initial={false}>
                {p.status === "playing" ? (
                  <motion.span key="pause" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} transition={{ duration: 0.12 }}>
                    <Pause size={20} fill="currentColor" />
                  </motion.span>
                ) : (
                  <motion.span key="play" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} transition={{ duration: 0.12 }}>
                    <Play size={20} fill="currentColor" className="ml-0.5" />
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.button>
          </Tooltip>
          <IconButton label="Suivant" onClick={p.next} size={38}>
            <SkipForward size={19} fill="currentColor" />
          </IconButton>
          <IconButton label={p.repeat === "off" ? "Répéter" : p.repeat === "all" ? "Répéter tout" : "Répéter le titre"} active={p.repeat !== "off"} onClick={p.cycleRepeat} size={34}>
            <RepeatIcon size={16} />
          </IconButton>
        </div>
        <div className="flex w-full max-w-2xl items-center gap-3">
          {radio && !track ? (
            <div className="flex w-full items-center justify-center gap-2 py-2 text-xs font-semibold uppercase tracking-wider text-mid">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" /> Diffusion en direct
            </div>
          ) : (
            <>
              <WaveformSeek positionMs={p.positionMs} durationMs={p.durationMs} onSeek={p.seek} seed={track?.id ?? "none"} />
              <button onClick={() => setShowRemaining((s) => !s)} className="w-10 shrink-0 text-left text-xs text-lo tnum">
                {showRemaining ? `-${formatTime(Math.max(0, p.durationMs - p.positionMs))}` : formatTime(p.durationMs)}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Right: utilities */}
      <div className="flex w-[26%] items-center justify-end gap-1">
        <IconButton label="Paroles" active={drawerOpen && drawerTab === "lyrics"} onClick={() => openDrawer("lyrics")} size={34}>
          <Mic2 size={18} />
        </IconButton>
        <IconButton label="File d'attente" active={drawerOpen && drawerTab === "queue"} onClick={() => openDrawer("queue")} size={34}>
          <ListMusic size={18} />
        </IconButton>
        <DevicePicker />
        <VolumeControl />
        <IconButton label="Mini-lecteur" onClick={() => ui.setMiniPlayer(true)} size={34}>
          <Minimize2 size={17} />
        </IconButton>
        <IconButton label="Plein écran" onClick={() => ui.setNowPlaying(true)} size={34}>
          <Maximize2 size={17} />
        </IconButton>
      </div>
    </div>
  )
}
