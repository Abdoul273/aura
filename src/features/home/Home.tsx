import { useEffect, useState } from "react"
import { motion } from "framer-motion"
import { Play, Shuffle } from "lucide-react"
import type { Album, Track, Playlist, RadioStation } from "../../types"
import { backend } from "../../services"
import CoverArt from "../../components/CoverArt"
import { AlbumCard, PlaylistCard, RadioCard, Carousel } from "../../components/cards"
import { CardGridSkeleton } from "../../components/Skeleton"
import IconButton from "../../components/IconButton"
import { usePlaybackActions } from "../../hooks/usePlaybackActions"
import { useUI } from "../../store/uiStore"
import { greeting, formatCount } from "../../utils/format"
import { coverGradient, paletteFromSeed } from "../../utils/color"
import type { AlbumColors } from "../../types"

const MIXES: { id: string; label: string; seed: string }[] = [
  { id: "mix-electro", label: "Mix Électronique", seed: "mix-electro" },
  { id: "mix-detente", label: "Mix Détente", seed: "mix-detente" },
  { id: "mix-focus", label: "Mix Concentration", seed: "mix-focus" },
  { id: "mix-nuit", label: "Mix Nuit", seed: "mix-nuit" },
]

function MixCard({ label, colors, onPlay }: { label: string; colors: AlbumColors; onPlay: () => void }) {
  return (
    <motion.div whileHover={{ y: -4 }} onClick={onPlay} className="group w-[172px] shrink-0 cursor-pointer">
      <div className="relative mb-3 grid aspect-square place-items-center overflow-hidden rounded-2xl shadow-lg" style={{ background: coverGradient(colors) }}>
        <span className="px-3 text-center text-lg font-bold leading-tight tracking-tight text-white drop-shadow">{label}</span>
        <span className="absolute inset-0" style={{ boxShadow: "inset 0 1px 0 0 rgba(255,255,255,.18)" }} />
      </div>
      <div className="truncate text-sm font-semibold text-hi">{label}</div>
      <div className="truncate text-xs text-mid">Sélection pour vous</div>
    </motion.div>
  )
}

export default function Home() {
  const [recent, setRecent] = useState<Album[]>([])
  const [most, setMost] = useState<Track[]>([])
  const [rediscover, setRediscover] = useState<Album[]>([])
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [radios, setRadios] = useState<RadioStation[]>([])
  const [loading, setLoading] = useState(true)
  const actions = usePlaybackActions()
  const navigate = useUI((s) => s.navigate)

  useEffect(() => {
    let alive = true
    Promise.all([
      backend.library.getRecentlyAdded(),
      backend.library.getMostPlayed(),
      backend.library.getRediscover(),
      backend.playlists.list(),
      backend.radio.list(),
    ]).then(([r, m, rd, pl, ra]) => {
      if (!alive) return
      setRecent(r)
      setMost(m)
      setRediscover(rd)
      setPlaylists(pl)
      setRadios(ra)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [])

  const hero = recent[0]
  const playHero = async () => {
    if (!hero) return
    const res = await backend.library.getAlbum(hero.id)
    if (res) actions.playContext(res.tracks.map((t) => t.id), 0)
  }
  const playMix = (seed: string) => {
    const ids = [...most].sort(() => Math.random() - 0.5).map((t) => t.id)
    if (ids.length) actions.playContext(ids, 0)
    else if (seed) navigate({ name: "tracks" })
  }

  return (
    <div className="p-8 pb-8">
      <motion.header initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-hi">{greeting()}</h1>
        <p className="mt-1 text-sm text-mid">Reprenez là où vous vous êtes arrêté ou explorez votre bibliothèque.</p>
      </motion.header>

      {loading ? (
        <CardGridSkeleton count={10} />
      ) : (
        <>
          {hero && (
            <motion.section
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
              className="glass-panel relative mb-10 overflow-hidden rounded-3xl p-6"
            >
              <div
                className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full opacity-40 blur-3xl"
                style={{ background: hero.colors.accent }}
              />
              <div className="relative flex items-center gap-6">
                <CoverArt colors={hero.colors} seed={hero.id} size={160} className="h-40 w-40 shrink-0 shadow-2xl" />
                <div className="min-w-0 flex-1">
                  <span className="text-xs font-semibold uppercase tracking-widest text-mid">Reprendre l'écoute</span>
                  <h2 className="mt-2 truncate text-3xl font-bold tracking-tight text-hi">{hero.title}</h2>
                  <button
                    onClick={() => navigate({ name: "artist", id: hero.artistId })}
                    className="mt-1 truncate text-sm text-mid hover:text-hi"
                  >
                    {hero.artist} · {hero.year}
                  </button>
                  <div className="mt-5 flex items-center gap-3">
                    <button
                      onClick={playHero}
                      className="focus-ring flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold text-white transition-transform active:scale-95"
                      style={{ background: "var(--accent)" }}
                    >
                      <Play size={18} fill="currentColor" /> Lire l'album
                    </button>
                    <IconButton label="Ouvrir l'album" onClick={() => navigate({ name: "album", id: hero.id })}>
                      <Shuffle size={18} />
                    </IconButton>
                  </div>
                </div>
              </div>
            </motion.section>
          )}

          {recent.length > 0 && (
            <Carousel title="Ajoutés récemment" onSeeAll={() => navigate({ name: "albums" })}>
              {recent.map((a, i) => (
                <motion.div key={a.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
                  <AlbumCard album={a} width={172} />
                </motion.div>
              ))}
            </Carousel>
          )}

          {most.length > 0 && (
            <Carousel title="Les plus écoutés" onSeeAll={() => navigate({ name: "tracks" })}>
              {most.map((t, i) => (
                <motion.div
                  key={t.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  onClick={() => actions.playContext([t.id], 0)}
                  className="group w-[150px] shrink-0 cursor-pointer"
                >
                  <div className="relative mb-3">
                    <CoverArt colors={t.colors} seed={t.albumId} size={150} className="shadow-lg" />
                    <div className="absolute bottom-2 left-2 rounded-full bg-black/50 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur">
                      {formatCount(t.plays)} lectures
                    </div>
                  </div>
                  <div className="truncate text-sm font-semibold text-hi">{t.title}</div>
                  <div className="truncate text-xs text-mid">{t.artist}</div>
                </motion.div>
              ))}
            </Carousel>
          )}

          <Carousel title="Vos mixes">
            {MIXES.map((m, i) => (
              <motion.div key={m.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
                <MixCard label={m.label} colors={paletteFromSeed(m.seed)} onPlay={() => playMix(m.seed)} />
              </motion.div>
            ))}
          </Carousel>

          {rediscover.length > 0 && (
            <Carousel title="Albums redécouverts">
              {rediscover.map((a, i) => (
                <motion.div key={a.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
                  <AlbumCard album={a} width={172} />
                </motion.div>
              ))}
            </Carousel>
          )}

          {playlists.length > 0 && (
            <Carousel title="Playlists">
              {playlists.map((p, i) => (
                <motion.div key={p.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }} className="w-[172px] shrink-0">
                  <PlaylistCard playlist={p} width={172} />
                </motion.div>
              ))}
            </Carousel>
          )}

          {radios.length > 0 && (
            <Carousel title="Radios" onSeeAll={() => navigate({ name: "radios" })}>
              {radios.map((r, i) => (
                <motion.div key={r.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }} className="w-[172px] shrink-0">
                  <RadioCard station={r} width={172} onPlay={() => backend.radio.play(r.id)} />
                </motion.div>
              ))}
            </Carousel>
          )}
        </>
      )}
    </div>
  )
}
