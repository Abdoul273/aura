// Deterministic fake library. ~15 artists, ~30 albums, ~300 tracks, playlists,
// radios and a handful of synced lyrics. All seeded so it is stable per reload.

import type {
  Album,
  Artist,
  Codec,
  FolderNode,
  Lyrics,
  Playlist,
  RadioStation,
  Track,
} from "../types"
import { paletteFromSeed, seededRandom } from "../utils/color"

const ARTISTS: { name: string; genres: string[]; bio: string }[] = [
  { name: "Nova Lumière", genres: ["Électronique", "Ambient"], bio: "Duo parisien de musique électronique atmosphérique, mêlant synthés analogiques et textures granulaires." },
  { name: "Marée Basse", genres: ["Indie", "Rock"], bio: "Groupe de rock indépendant nantais, connu pour ses guitares réverbérées et ses refrains mélancoliques." },
  { name: "Kaïto Sur", genres: ["Jazz", "Nu-Jazz"], bio: "Pianiste et compositeur explorant les frontières du jazz contemporain." },
  { name: "Céleste V.", genres: ["Pop", "Électro-pop"], bio: "Autrice-compositrice-interprète à la voix cristalline et aux productions luxuriantes." },
  { name: "Beton Brut", genres: ["Techno", "Industriel"], bio: "Collectif berlinois de techno brute enregistrée dans d'anciennes usines." },
  { name: "Les Hirondelles", genres: ["Folk", "Chanson"], bio: "Trio acoustique aux harmonies vocales délicates et aux textes poétiques." },
  { name: "Orage Sec", genres: ["Post-Rock"], bio: "Quatuor instrumental construisant de vastes crescendos cinématographiques." },
  { name: "Mila Fontaine", genres: ["Soul", "R&B"], bio: "Voix soul puissante nourrie de gospel et de groove moderne." },
  { name: "Prisme", genres: ["Électronique", "House"], bio: "Producteur de house mélodique aux basses profondes et aux nappes lumineuses." },
  { name: "Vieux Continent", genres: ["Classique", "Néo-classique"], bio: "Ensemble néo-classique pour piano et cordes." },
  { name: "Ferro & Sable", genres: ["Hip-Hop", "Rap"], bio: "Duo rap au flow ciselé et aux prods poussiéreuses." },
  { name: "Aurora Bleue", genres: ["Dream Pop", "Shoegaze"], bio: "Murs de guitares vaporeux et voix éthérées." },
  { name: "Tambour Nord", genres: ["Afrobeat", "Funk"], bio: "Grand orchestre afrobeat aux cuivres flamboyants." },
  { name: "Silex", genres: ["Métal", "Prog"], bio: "Métal progressif technique aux structures labyrinthiques." },
  { name: "Douce Amère", genres: ["Bossa", "Jazz"], bio: "Reprises bossa-nova feutrées, idéales pour les fins de soirée." },
]

const ALBUM_WORDS_A = ["Constellation", "Marées", "Verre", "Cendres", "Écho", "Néon", "Racines", "Ivoire", "Orbite", "Sillage", "Prisme", "Aube", "Ambre", "Vertige", "Silence"]
const ALBUM_WORDS_B = ["intérieur", "lointain", "brisé", "nocturne", "solaire", "d'hiver", "en fuite", "second", "premier", "ultime", "sauvage", "fragile"]
const TRACK_WORDS = ["Lueur", "Dérive", "Apnée", "Horizon", "Fragment", "Mirage", "Tempête", "Pulse", "Cendre", "Reflet", "Latitude", "Sève", "Nuit blanche", "Onde", "Vertige", "Cascade", "Métronome", "Solstice", "Brume", "Éclipse", "Aphélie", "Rémanence", "Halogène", "Cyan", "Terminus"]
const GENRES = ["Électronique", "Rock", "Jazz", "Pop", "Techno", "Folk", "Post-Rock", "Soul", "House", "Classique", "Hip-Hop", "Dream Pop", "Afrobeat", "Métal", "Bossa"]
const CODECS: Codec[] = ["FLAC", "MP3", "OPUS", "AAC", "ALAC"]

function pick<T>(arr: T[], r: () => number): T {
  return arr[Math.floor(r() * arr.length)]
}

function qualityFor(codec: Codec, bitDepth: number, sampleRate: number) {
  if ((codec === "FLAC" || codec === "ALAC") && (bitDepth > 16 || sampleRate > 48000)) return "Hi-Res" as const
  if (codec === "FLAC" || codec === "ALAC") return "Lossless" as const
  return "Lossy" as const
}

export interface MockDb {
  artists: Artist[]
  albums: Album[]
  tracks: Track[]
  playlists: Playlist[]
  radios: RadioStation[]
  folders: FolderNode[]
  lyrics: Record<string, Lyrics>
}

export function buildMockDb(): MockDb {
  const artists: Artist[] = []
  const albums: Album[] = []
  const tracks: Track[] = []
  const r = seededRandom("aura-v1")

  ARTISTS.forEach((a, ai) => {
    const artistId = `ar_${ai}`
    const albumCount = 1 + Math.floor(r() * 3) // 1..3 albums each -> ~30
    const artistColors = paletteFromSeed(a.name)
    let artistTrackCount = 0

    for (let al = 0; al < albumCount; al++) {
      const albumId = `al_${ai}_${al}`
      const title = `${pick(ALBUM_WORDS_A, r)} ${pick(ALBUM_WORDS_B, r)}`
      const year = 2004 + Math.floor(r() * 22)
      const codec = pick(CODECS, r)
      const bitDepth = codec === "FLAC" || codec === "ALAC" ? (r() > 0.5 ? 24 : 16) : 16
      const sampleRate = bitDepth === 24 ? (r() > 0.5 ? 96000 : 48000) : 44100
      const quality = qualityFor(codec, bitDepth, sampleRate)
      const genre = a.genres[0]
      const colors = paletteFromSeed(albumId)
      const trackCount = 6 + Math.floor(r() * 7) // 6..12
      const addedAt = Date.now() - Math.floor(r() * 300) * 86400000
      let albumDuration = 0

      for (let t = 0; t < trackCount; t++) {
        const trackId = `tr_${ai}_${al}_${t}`
        const durationMs = (150 + Math.floor(r() * 210)) * 1000
        albumDuration += durationMs
        const bitrate = codec === "FLAC" || codec === "ALAC" ? 700 + Math.floor(r() * 500) : pick([128, 192, 256, 320], r)
        const fileSize = Math.floor((bitrate * 1000 * (durationMs / 1000)) / 8)
        const word = pick(TRACK_WORDS, r)
        tracks.push({
          id: trackId,
          title: t === 0 ? title : `${word}${r() > 0.7 ? " " + pick(ALBUM_WORDS_B, r) : ""}`,
          artist: a.name,
          artistId,
          album: title,
          albumId,
          trackNumber: t + 1,
          discNumber: trackCount > 10 && t >= Math.floor(trackCount / 2) ? 2 : 1,
          year,
          genre,
          durationMs,
          codec,
          bitrate,
          sampleRate,
          bitDepth,
          quality,
          filePath: `/home/user/Musique/${a.name}/${title}/${String(t + 1).padStart(2, "0")} - ${word}.${codec.toLowerCase()}`,
          fileSize,
          plays: Math.floor(r() * r() * 400),
          addedAt,
          favorite: r() > 0.82,
          colors,
        })
        artistTrackCount++
      }

      albums.push({
        id: albumId,
        title,
        artist: a.name,
        artistId,
        year,
        genre,
        trackCount,
        durationMs: albumDuration,
        codec,
        quality,
        colors,
        addedAt,
      })
    }

    artists.push({
      id: artistId,
      name: a.name,
      albumCount,
      trackCount: artistTrackCount,
      genres: a.genres,
      colors: artistColors,
      bio: a.bio,
      monthlyListeners: 20000 + Math.floor(r() * 4000000),
    })
  })

  // Playlists
  const playlistDefs = [
    { name: "Focus profond", description: "Nappes ambient pour la concentration.", smart: false },
    { name: "Réveil en douceur", description: "Commencer la journée sans brusquer.", smart: false },
    { name: "Route de nuit", description: "Basses et néons pour l'autoroute.", smart: false },
    { name: "Ajoutés récemment", description: "Vos derniers ajouts automatiquement.", smart: true },
    { name: "Coups de cœur", description: "Tout ce que vous adorez.", smart: true },
    { name: "Café du dimanche", description: "Jazz feutré et bossa.", smart: false },
    { name: "Énergie brute", description: "Techno, métal et adrénaline.", smart: false },
    { name: "Les classiques", description: "Piano, cordes et silence.", smart: false },
  ]
  const playlists: Playlist[] = playlistDefs.map((p, i) => {
    const count = 12 + Math.floor(r() * 30)
    const trackIds: string[] = []
    for (let k = 0; k < count; k++) trackIds.push(pick(tracks, r).id)
    return {
      id: `pl_${i}`,
      name: p.name,
      description: p.description,
      trackIds: Array.from(new Set(trackIds)),
      createdAt: Date.now() - Math.floor(r() * 500) * 86400000,
      updatedAt: Date.now() - Math.floor(r() * 30) * 86400000,
      smart: p.smart,
      colors: paletteFromSeed(p.name),
    }
  })

  const radioDefs = [
    { name: "FIP", genre: "Éclectique", np: "Nina Simone — Feeling Good" },
    { name: "Radio Nova", genre: "Groove", np: "Jungle — Busy Earnin'" },
    { name: "SomaFM Groove Salad", genre: "Ambient / Downtempo", np: "Bonobo — Kong" },
    { name: "NTS Radio 1", genre: "Underground", np: "Floating Points — LesAlpx" },
    { name: "KEXP", genre: "Indie / Alternatif", np: "Khruangbin — Time (You and I)" },
    { name: "Jazz24", genre: "Jazz", np: "Bill Evans — Peace Piece" },
  ]
  const radios: RadioStation[] = radioDefs.map((s, i) => ({
    id: `rd_${i}`,
    name: s.name,
    genre: s.genre,
    streamUrl: `https://stream.example.com/${s.name.toLowerCase().replace(/\s+/g, "-")}`,
    homepage: "https://example.com",
    bitrate: pick([128, 192, 256, 320], r),
    live: true,
    colors: paletteFromSeed(s.name),
    nowPlaying: s.np,
  }))

  const folders = buildFolders(tracks)
  const lyrics = buildLyrics(tracks)

  return { artists, albums, tracks, playlists, radios, folders, lyrics }
}

function buildFolders(tracks: Track[]): FolderNode[] {
  const root: FolderNode = { id: "root", name: "Musique", path: "/home/user/Musique", type: "folder", children: [] }
  const map = new Map<string, FolderNode>()
  map.set(root.path, root)

  for (const t of tracks) {
    const parts = t.filePath.replace("/home/user/Musique/", "").split("/")
    let curPath = "/home/user/Musique"
    let parent = root
    for (let i = 0; i < parts.length - 1; i++) {
      curPath += "/" + parts[i]
      let node = map.get(curPath)
      if (!node) {
        node = { id: curPath, name: parts[i], path: curPath, type: "folder", children: [] }
        map.set(curPath, node)
        parent.children!.push(node)
      }
      parent = node
    }
    parent.children!.push({
      id: t.id,
      name: parts[parts.length - 1],
      path: t.filePath,
      type: "file",
      trackId: t.id,
    })
  }
  return [root]
}

// Synced lyrics for the first 6 tracks.
function buildLyrics(tracks: Track[]): Record<string, Lyrics> {
  const out: Record<string, Lyrics> = {}
  const verses = [
    "Les néons pleuvent sur le bitume",
    "Je marche seul dans la brume",
    "Une lueur au bout de la nuit",
    "Elle s'efface, puis elle luit",
    "Reste encore, ne pars pas",
    "Le silence parle tout bas",
    "On dérive vers l'aurore",
    "Nos ombres dansent encore",
    "Le temps suspend son vertige",
    "Et le monde entier se fige",
    "Reprends mon souffle, prends ma main",
    "On verra bien demain",
  ]
  tracks.slice(0, 6).forEach((t, idx) => {
    const lines = []
    const step = Math.floor(t.durationMs / (verses.length + 2))
    for (let i = 0; i < verses.length; i++) {
      lines.push({ timeMs: (i + 1) * step, text: verses[(i + idx) % verses.length] })
    }
    out[t.id] = { kind: "synced", lines }
  })
  // one plain-text example
  if (tracks[7]) out[tracks[7].id] = { kind: "plain", text: verses.join("\n") }
  return out
}

export { GENRES }
