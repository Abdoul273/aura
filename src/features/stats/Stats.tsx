import { useEffect, useState } from "react"
import { motion } from "framer-motion"
import { Flame, Clock, CalendarDays, CalendarRange, Infinity as InfinityIcon } from "lucide-react"
import { backend } from "../../services"
import { useUI } from "../../store/uiStore"
import CoverArt from "../../components/CoverArt"
import { Skeleton } from "../../components/Skeleton"
import { formatDuration, formatCount } from "../../utils/format"
import { paletteFromSeed, hsl } from "../../utils/color"
import type { LibraryStats } from "../../types"

export default function Stats() {
  const [stats, setStats] = useState<LibraryStats | null>(null)
  const navigate = useUI((s) => s.navigate)

  useEffect(() => {
    backend.library.getStats().then(setStats)
  }, [])

  if (!stats) {
    return (
      <div className="p-8">
        <Skeleton className="mb-8 h-9 w-48" />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="p-8">
      <motion.h1 initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-8 text-3xl font-bold tracking-tight text-hi">
        Statistiques
      </motion.h1>

      <div className="mb-10 grid grid-cols-2 gap-4 md:grid-cols-5">
        <StatCard icon={<Clock size={18} />} label="Aujourd'hui" value={formatDuration(stats.listenedMsToday)} delay={0} />
        <StatCard icon={<CalendarDays size={18} />} label="Cette semaine" value={formatDuration(stats.listenedMsWeek)} delay={0.05} />
        <StatCard icon={<CalendarRange size={18} />} label="Ce mois" value={formatDuration(stats.listenedMsMonth)} delay={0.1} />
        <StatCard icon={<InfinityIcon size={18} />} label="Total" value={formatDuration(stats.listenedMsAll)} delay={0.15} />
        <StatCard icon={<Flame size={18} />} label="Série" value={`${stats.streakDays} jours`} delay={0.2} accent />
      </div>

      <div className="mb-10 grid gap-6 lg:grid-cols-3">
        <RankList
          title="Top artistes"
          rows={stats.topArtists.slice(0, 5).map((a) => ({ id: a.artistId, name: a.name, value: a.ms }))}
          suffix={(v) => formatDuration(v)}
          onClick={(id) => navigate({ name: "artist", id })}
          round
        />
        <RankList
          title="Top albums"
          rows={stats.topAlbums.slice(0, 5).map((a) => ({ id: a.albumId, name: a.title, value: a.plays }))}
          suffix={(v) => `${formatCount(v)} lectures`}
          onClick={(id) => navigate({ name: "album", id })}
        />
        <RankList
          title="Top titres"
          rows={stats.topTracks.slice(0, 5).map((t) => ({ id: t.trackId, name: t.title, value: t.plays }))}
          suffix={(v) => `${formatCount(v)} lectures`}
        />
      </div>

      <div className="mb-10 glass-panel rounded-2xl p-6">
        <h2 className="mb-4 text-lg font-semibold text-hi">Activité d'écoute</h2>
        <Heatmap data={stats.heatmap} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="glass-panel rounded-2xl p-6">
          <h2 className="mb-4 text-lg font-semibold text-hi">Genres</h2>
          <Donut data={stats.genreDistribution} />
        </div>
        <div className="glass-panel rounded-2xl p-6">
          <h2 className="mb-4 text-lg font-semibold text-hi">Écoute par heure</h2>
          <Hourly data={stats.hourlyDistribution} />
        </div>
      </div>
    </div>
  )
}

function StatCard({ icon, label, value, delay, accent }: { icon: React.ReactNode; label: string; value: string; delay: number; accent?: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="glass-panel rounded-2xl p-4"
    >
      <div className="mb-3 grid h-9 w-9 place-items-center rounded-xl" style={{ color: "var(--accent)", background: accent ? "color-mix(in srgb, var(--accent) 18%, transparent)" : "rgba(255,255,255,.06)" }}>
        {icon}
      </div>
      <div className="text-xl font-bold text-hi tnum">{value}</div>
      <div className="text-xs text-mid">{label}</div>
    </motion.div>
  )
}

interface Row {
  id: string
  name: string
  value: number
}
function RankList({ title, rows, suffix, onClick, round }: { title: string; rows: Row[]; suffix: (v: number) => string; onClick?: (id: string) => void; round?: boolean }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <div className="glass-panel rounded-2xl p-6">
      <h2 className="mb-4 text-lg font-semibold text-hi">{title}</h2>
      <div className="space-y-3">
        {rows.map((r, i) => (
          <div
            key={r.id}
            onClick={onClick ? () => onClick(r.id) : undefined}
            className={onClick ? "group flex items-center gap-3 cursor-pointer" : "flex items-center gap-3"}
          >
            <span className="w-4 shrink-0 text-sm font-bold text-lo tnum">{i + 1}</span>
            <CoverArt colors={paletteFromSeed(r.id)} seed={r.id} size={40} rounded={round ? "rounded-full" : "rounded-lg"} className="h-10 w-10 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-hi group-hover:text-white">{r.name}</div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/8">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${(r.value / max) * 100}%` }}
                  transition={{ duration: 0.8, delay: i * 0.06 }}
                  className="h-full rounded-full"
                  style={{ background: "var(--accent)" }}
                />
              </div>
            </div>
            <span className="shrink-0 text-xs text-mid tnum">{suffix(r.value)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Heatmap({ data }: { data: number[] }) {
  const weeks = 53
  const cell = 12
  const gap = 3
  return (
    <div className="overflow-x-auto">
      <svg width={weeks * (cell + gap)} height={7 * (cell + gap)} className="min-w-full">
        {data.map((v, i) => {
          const col = Math.floor(i / 7)
          const row = i % 7
          return (
            <motion.rect
              key={i}
              x={col * (cell + gap)}
              y={row * (cell + gap)}
              width={cell}
              height={cell}
              rx={3}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: Math.min(col * 0.006, 0.5) }}
              fill={v < 0.04 ? "rgba(255,255,255,.06)" : "var(--accent)"}
              fillOpacity={v < 0.04 ? 1 : 0.25 + v * 0.75}
            />
          )
        })}
      </svg>
      <div className="mt-3 flex items-center gap-2 text-xs text-lo">
        <span>Moins</span>
        {[0.1, 0.35, 0.6, 0.85, 1].map((o) => (
          <span key={o} className="h-3 w-3 rounded-[3px]" style={{ background: "var(--accent)", opacity: 0.25 + o * 0.75 }} />
        ))}
        <span>Plus</span>
      </div>
    </div>
  )
}

function Donut({ data }: { data: { genre: string; count: number }[] }) {
  const total = Math.max(1, data.reduce((s, d) => s + d.count, 0))
  const r = 60
  const c = 2 * Math.PI * r
  let acc = 0
  const segs = data.map((d, i) => {
    const frac = d.count / total
    const seg = { ...d, frac, offset: acc, color: hsl((i * 57) % 360, 65, 60) }
    acc += frac
    return seg
  })
  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg width={160} height={160} viewBox="0 0 160 160">
        <g transform="rotate(-90 80 80)">
          {segs.map((s) => (
            <motion.circle
              key={s.genre}
              cx={80}
              cy={80}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={22}
              strokeDasharray={c}
              initial={{ strokeDashoffset: c }}
              animate={{ strokeDashoffset: c - c * s.frac }}
              transition={{ duration: 0.9, ease: "easeOut" }}
              style={{ transform: `rotate(${s.offset * 360}deg)`, transformOrigin: "80px 80px" }}
            />
          ))}
        </g>
        <text x={80} y={76} textAnchor="middle" className="fill-hi" style={{ fontSize: 22, fontWeight: 700 }}>
          {data.length}
        </text>
        <text x={80} y={94} textAnchor="middle" className="fill-current text-mid" style={{ fontSize: 10 }}>
          genres
        </text>
      </svg>
      <div className="flex-1 space-y-1.5">
        {segs.map((s) => (
          <div key={s.genre} className="flex items-center gap-2 text-sm">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
            <span className="flex-1 truncate text-hi">{s.genre}</span>
            <span className="text-mid tnum">{Math.round(s.frac * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Hourly({ data }: { data: number[] }) {
  const max = Math.max(1, ...data)
  const H = 120
  return (
    <div>
      <div className="flex h-32 items-end gap-1">
        {data.map((v, h) => (
          <div key={h} className="flex flex-1 items-end" style={{ height: H }}>
            <motion.div
              initial={{ height: 0 }}
              animate={{ height: `${(v / max) * 100}%` }}
              transition={{ duration: 0.7, delay: h * 0.015 }}
              className="w-full rounded-t"
              style={{ background: "var(--accent)", opacity: 0.4 + (v / max) * 0.6 }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-xs text-lo tnum">
        <span>0h</span>
        <span>6h</span>
        <span>12h</span>
        <span>18h</span>
        <span>23h</span>
      </div>
    </div>
  )
}
