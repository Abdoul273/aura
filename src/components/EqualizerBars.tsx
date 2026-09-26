// Tiny animated equalizer used as the "now playing" row indicator.
interface Props {
  playing: boolean
  color?: string
  size?: number
}
export default function EqualizerBars({ playing, color = "var(--accent)", size = 16 }: Props) {
  const bars = [0, 1, 2, 3]
  return (
    <div className="flex items-end gap-[2px]" style={{ height: size }} aria-hidden>
      {bars.map((i) => (
        <span
          key={i}
          className="w-[3px] rounded-full"
          style={{
            height: "100%",
            background: color,
            transformOrigin: "bottom",
            animation: playing ? `eq-bounce ${0.7 + i * 0.18}s ease-in-out ${i * 0.1}s infinite` : "none",
            transform: playing ? undefined : "scaleY(0.3)",
          }}
        />
      ))}
    </div>
  )
}
