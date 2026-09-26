import { useEffect } from "react"
import { motion } from "framer-motion"
import { useLibrary } from "../../store/libraryStore"
import { ArtistCard } from "../../components/cards"
import { CardGridSkeleton } from "../../components/Skeleton"
import { formatCount } from "../../utils/format"

export default function Artists() {
  const artists = useLibrary((s) => s.artists)
  const loaded = useLibrary((s) => s.artistsLoaded)
  const loadArtists = useLibrary((s) => s.loadArtists)

  useEffect(() => {
    if (!loaded) loadArtists()
  }, [loaded, loadArtists])

  return (
    <div className="p-8">
      <motion.header
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8 flex items-baseline gap-3"
      >
        <h1 className="text-3xl font-bold tracking-tight text-hi">Artistes</h1>
        {loaded && <span className="text-sm text-mid tnum">{formatCount(artists.length)}</span>}
      </motion.header>

      {!loaded ? (
        <CardGridSkeleton count={18} />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-6">
          {artists.map((artist, i) => (
            <motion.div
              key={artist.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.015, 0.4) }}
            >
              <ArtistCard artist={artist} />
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}
