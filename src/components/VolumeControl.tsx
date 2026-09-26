import { Volume2, Volume1, VolumeX } from "lucide-react"
import { usePlayer } from "../store/playerStore"
import Tooltip from "./Tooltip"

export default function VolumeControl() {
  const volume = usePlayer((s) => s.volume)
  const muted = usePlayer((s) => s.muted)
  const setVolume = usePlayer((s) => s.setVolume)
  const changeVolume = usePlayer((s) => s.changeVolume)
  const toggleMute = usePlayer((s) => s.toggleMute)
  const v = muted ? 0 : volume
  const Icon = v === 0 ? VolumeX : v < 0.5 ? Volume1 : Volume2

  return (
    <div
      className="flex items-center gap-2"
      onWheel={(e) => {
        changeVolume(e.deltaY < 0 ? 0.05 : -0.05)
      }}
    >
      <Tooltip label={muted ? "Réactiver le son" : "Couper le son"}>
        <button onClick={toggleMute} aria-label="Muet" className="focus-ring text-mid hover:text-hi">
          <Icon size={19} />
        </button>
      </Tooltip>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={v}
        onChange={(e) => setVolume(Number(e.target.value))}
        aria-label="Volume"
        className="h-1 w-24 cursor-pointer appearance-none rounded-full"
        style={{ background: `linear-gradient(to right, var(--accent) ${v * 100}%, rgba(255,255,255,0.16) ${v * 100}%)` }}
      />
    </div>
  )
}
