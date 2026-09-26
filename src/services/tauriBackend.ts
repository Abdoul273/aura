// Real MusicBackend implementation on top of the Rust side (src-tauri).
// The whole library is kept in memory (a few MB for 10,000 tracks): searches,
// sorts and album/artist aggregations happen here, instantly, while Rust
// stays the source of truth (SQLite, mpv, files).

import { convertFileSrc, invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { open as openDialog } from "@tauri-apps/plugin-dialog"
import { revealItemInDir } from "@tauri-apps/plugin-opener"
import type { MusicBackend, SearchResults, Unsubscribe } from "./backend"
import type {
  Album,
  AlbumColors,
  Artist,
  AudioDevice,
  AudioQuality,
  Codec,
  EqPreset,
  FolderNode,
  LibraryStats,
  Lyrics,
  OutputStatus,
  PlayerState,
  Playlist,
  RadioStation,
  ScanProgress,
  Settings,
  SortSpec,
  Track,
} from "../types"
import { paletteFromSeed } from "../utils/color"

// ---- Types renvoyés par Rust ----------------------------------------------------

interface TrackRow {
  id: string
  title: string
  artist: string
  albumArtist: string
  album: string
  albumId: string
  trackNumber: number
  discNumber: number
  year: number
  genre: string
  durationMs: number
  codec: string
  bitrate: number
  sampleRate: number
  bitDepth: number
  filePath: string
  fileSize: number
  addedAt: number
  plays: number
  favorite: boolean
}
interface AlbumMeta {
  id: string
  hasCover: boolean
  colors: AlbumColors
}
interface Snapshot {
  tracks: TrackRow[]
  albums: AlbumMeta[]
  coverDir: string
}
interface PlayStats {
  listenedMsToday: number
  listenedMsWeek: number
  listenedMsMonth: number
  listenedMsAll: number
  streakDays: number
  heatmap: number[]
  hourlyDistribution: number[]
  trackMs: [string, number][]
}
type RawPlaylist = Omit<Playlist, "colors">
type RawRadio = Omit<RadioStation, "colors">

// ---- Index en mémoire ------------------------------------------------------------

const LOSSLESS = new Set(["FLAC", "ALAC", "WAV", "AIFF", "WAVPACK", "APE"])
const UNKNOWN_ARTIST = "Artiste inconnu"

let coverDir = ""
let tracks: Track[] = []
let trackById = new Map<string, Track>()
let albums: Album[] = []
let albumById = new Map<string, Album>()
let artists: Artist[] = []
let artistById = new Map<string, Artist>()
const albumCover = new Map<string, boolean>()

function hashId(prefix: string, s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `${prefix}${(h >>> 0).toString(16)}`
}
const artistId = (name: string) => hashId("ar_", name.toLowerCase())

function qualityOf(codec: string, bitDepth: number, sampleRate: number): AudioQuality {
  if (!LOSSLESS.has(codec)) return "Lossy"
  return bitDepth > 16 || sampleRate > 48000 ? "Hi-Res" : "Lossless"
}

/** Minuscules sans accents, pour une recherche tolérante. */
function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
}

function buildIndex(snap: Snapshot) {
  coverDir = snap.coverDir
  albumCover.clear()
  const metaById = new Map(snap.albums.map((a) => [a.id, a]))
  snap.albums.forEach((a) => albumCover.set(a.id, a.hasCover))

  tracks = snap.tracks.map((r) => {
    const colors = metaById.get(r.albumId)?.colors ?? paletteFromSeed(r.albumId)
    return {
      id: r.id,
      title: r.title,
      artist: r.artist,
      artistId: artistId(r.artist),
      album: r.album,
      albumId: r.albumId,
      trackNumber: r.trackNumber,
      discNumber: r.discNumber,
      year: r.year,
      genre: r.genre,
      durationMs: r.durationMs,
      codec: r.codec as Codec,
      bitrate: r.bitrate,
      sampleRate: r.sampleRate,
      bitDepth: r.bitDepth,
      quality: qualityOf(r.codec, r.bitDepth, r.sampleRate),
      filePath: r.filePath,
      fileSize: r.fileSize,
      plays: r.plays,
      addedAt: r.addedAt,
      favorite: r.favorite,
      colors,
    }
  })
  trackById = new Map(tracks.map((t) => [t.id, t]))

  // Albums
  const albumArtistOf = new Map(snap.tracks.map((r) => [r.albumId, r.albumArtist]))
  const byAlbum = new Map<string, Track[]>()
  for (const t of tracks) {
    const list = byAlbum.get(t.albumId)
    if (list) list.push(t)
    else byAlbum.set(t.albumId, [t])
  }
  albums = [...byAlbum.entries()].map(([id, ts]) => {
    const first = ts[0]
    const artistName = albumArtistOf.get(id) ?? first.artist
    const best = ts.reduce((a, b) => (rankQuality(b.quality) > rankQuality(a.quality) ? b : a))
    const genres = mostCommon(ts.map((t) => t.genre).filter(Boolean))
    return {
      id,
      title: first.album,
      artist: artistName,
      artistId: artistId(artistName),
      year: Math.max(...ts.map((t) => t.year)),
      genre: genres ?? "",
      trackCount: ts.length,
      durationMs: ts.reduce((s, t) => s + t.durationMs, 0),
      codec: best.codec,
      quality: best.quality,
      colors: first.colors,
      addedAt: Math.max(...ts.map((t) => t.addedAt)),
    }
  })
  albumById = new Map(albums.map((a) => [a.id, a]))

  // Artistes : artistes d'album + artistes de titre
  const artistTracks = new Map<string, { name: string; tracks: Track[]; albums: Set<string> }>()
  const entry = (name: string) => {
    const id = artistId(name)
    let e = artistTracks.get(id)
    if (!e) {
      e = { name, tracks: [], albums: new Set() }
      artistTracks.set(id, e)
    }
    return e
  }
  for (const t of tracks) entry(t.artist).tracks.push(t)
  for (const a of albums) entry(a.artist).albums.add(a.id)
  artists = [...artistTracks.entries()].map(([id, e]) => {
    const genreCount = new Map<string, number>()
    e.tracks.forEach((t) => t.genre && genreCount.set(t.genre, (genreCount.get(t.genre) ?? 0) + 1))
    const genres = [...genreCount.entries()].sort((a, b) => b[1] - a[1]).map(([g]) => g).slice(0, 3)
    const plays = e.tracks.reduce((s, t) => s + t.plays, 0)
    const withCover = [...e.albums].find((a) => albumCover.get(a)) ?? e.tracks.find((t) => albumCover.get(t.albumId))?.albumId
    const colors = withCover ? (albumById.get(withCover)?.colors ?? paletteFromSeed(id)) : paletteFromSeed(id)
    const albumCount = e.albums.size
    const trackCount = e.tracks.length
    return {
      id,
      name: e.name,
      albumCount,
      trackCount,
      genres,
      colors,
      bio: artistBio(e.name, albumCount, trackCount, genres),
      monthlyListeners: plays,
    }
  })
  artistById = new Map(artists.map((a) => [a.id, a]))
}

function artistBio(name: string, albumCount: number, trackCount: number, genres: string[]): string {
  if (name === UNKNOWN_ARTIST) return "Titres sans artiste renseigné dans leurs tags."
  const parts = [`${trackCount} titre${trackCount > 1 ? "s" : ""}`]
  if (albumCount) parts.push(`${albumCount} album${albumCount > 1 ? "s" : ""}`)
  const g = genres.length ? ` — ${genres.join(", ")}` : ""
  return `${parts.join(" et ")} dans votre bibliothèque${g}.`
}

function rankQuality(q: AudioQuality) {
  return q === "Hi-Res" ? 2 : q === "Lossless" ? 1 : 0
}

function mostCommon(values: string[]): string | undefined {
  const m = new Map<string, number>()
  values.forEach((v) => m.set(v, (m.get(v) ?? 0) + 1))
  return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
}

function coverUrl(albumId: string): string {
  return albumCover.get(albumId) ? convertFileSrc(`${coverDir}/${albumId}.jpg`) : ""
}

function sortTracks(items: Track[], sort: SortSpec): Track[] {
  const dir = sort.dir === "asc" ? 1 : -1
  const key = sort.key as keyof Track
  const collator = new Intl.Collator("fr", { sensitivity: "base", numeric: true })
  return [...items].sort((a, b) => {
    const av = a[key]
    const bv = b[key]
    if (typeof av === "string" && typeof bv === "string") return collator.compare(av, bv) * dir
    return ((av as number) - (bv as number)) * dir
  })
}

function matches(q: string, ...fields: string[]): boolean {
  const hay = norm(fields.join(" "))
  return q.split(/\s+/).every((w) => hay.includes(w))
}

function albumTracks(id: string): Track[] {
  return tracks.filter((t) => t.albumId === id).sort((a, b) => a.discNumber - b.discNumber || a.trackNumber - b.trackNumber || a.title.localeCompare(b.title))
}

function withPlaylistColors(p: RawPlaylist): Playlist {
  const first = p.trackIds.map((id) => trackById.get(id)).find(Boolean)
  return { ...p, colors: first?.colors ?? paletteFromSeed(p.id) }
}

const radioTitles = new Map<string, string>()
function withRadioColors(r: RawRadio): RadioStation {
  return { ...r, nowPlaying: r.nowPlaying ?? radioTitles.get(r.id), colors: paletteFromSeed(r.id) }
}

// ---- Événements ------------------------------------------------------------------

type Cb<T> = (v: T) => void
function channel<T>() {
  const subs = new Set<Cb<T>>()
  return {
    subs,
    add(cb: Cb<T>): Unsubscribe {
      subs.add(cb)
      return () => {
        subs.delete(cb)
      }
    },
    emit(v: T) {
      subs.forEach((cb) => cb(v))
    },
  }
}

const stateCh = channel<PlayerState>()
const posCh = channel<number>()
const analyserCh = channel<number[]>()
const scanCh = channel<ScanProgress>()
const outputCh = channel<OutputStatus>()
const changedCh = channel<void>()

let state: PlayerState = {
  status: "stopped",
  currentTrackId: null,
  positionMs: 0,
  durationMs: 0,
  volume: 0.8,
  muted: false,
  shuffle: false,
  repeat: "off",
  queue: [],
  queueIndex: -1,
  history: [],
  radioId: null,
}
let lastScan: ScanProgress = { scanning: false, current: 0, total: 0, currentPath: "" }
let lastOutput: OutputStatus | null = null

async function reloadLibrary() {
  buildIndex(await invoke<Snapshot>("library_snapshot"))
  changedCh.emit()
}

/** À attendre avant de monter l'application (les stores lisent l'état au chargement). */
export async function initTauriBackend() {
  const [snap, st] = await Promise.all([invoke<Snapshot>("library_snapshot"), invoke<PlayerState>("player_state")])
  buildIndex(snap)
  state = st

  await Promise.all([
    listen<PlayerState>("player:state", (e) => {
      state = e.payload
      stateCh.emit(state)
    }),
    listen<number>("player:position", (e) => {
      state.positionMs = e.payload
      posCh.emit(e.payload)
    }),
    listen<number[]>("player:analyser", (e) => analyserCh.emit(e.payload)),
    listen<ScanProgress>("library:scan", (e) => {
      lastScan = e.payload
      scanCh.emit(e.payload)
    }),
    listen("library:changed", () => void reloadLibrary()),
    listen<{ trackId: string }>("library:played", (e) => {
      const t = trackById.get(e.payload.trackId)
      if (t) t.plays += 1
    }),
    listen<OutputStatus>("audio:output", (e) => {
      lastOutput = e.payload
      outputCh.emit(e.payload)
    }),
    listen<{ id: string | null; title: string | null }>("radio:nowplaying", (e) => {
      if (e.payload.id) {
        if (e.payload.title) radioTitles.set(e.payload.id, e.payload.title)
        else radioTitles.delete(e.payload.id)
      }
      stateCh.emit({ ...state })
    }),
  ])
  if (await invoke<boolean>("library_is_scanning")) lastScan = { scanning: true, current: 0, total: 0, currentPath: "" }
}

export function getTrackSyncTauri(id: string): Track | undefined {
  return trackById.get(id)
}

let analyserRefs = 0

// ---- Backend ---------------------------------------------------------------------

export const tauriBackend: MusicBackend = {
  library: {
    async getTracks(query, sort, paging) {
      let items = tracks
      const q = norm(query.trim())
      if (q) items = items.filter((t) => matches(q, t.title, t.artist, t.album))
      items = sortTracks(items, sort)
      return { items: items.slice(paging.offset, paging.offset + paging.limit), total: items.length }
    },
    async getTrack(id) {
      return trackById.get(id) ?? null
    },
    async getAlbums() {
      return [...albums].sort((a, b) => a.title.localeCompare(b.title, "fr"))
    },
    async getAlbum(id) {
      const album = albumById.get(id)
      return album ? { album, tracks: albumTracks(id) } : null
    },
    async getArtists() {
      return [...artists].sort((a, b) => a.name.localeCompare(b.name, "fr"))
    },
    async getArtist(id) {
      const artist = artistById.get(id)
      if (!artist) return null
      const own = tracks.filter((t) => t.artistId === id)
      const albumIds = new Set([...albums.filter((a) => a.artistId === id).map((a) => a.id), ...own.map((t) => t.albumId)])
      const artistAlbums = [...albumIds].map((a) => albumById.get(a)!).filter(Boolean).sort((a, b) => b.year - a.year)
      const topTracks = [...own].sort((a, b) => b.plays - a.plays || b.addedAt - a.addedAt).slice(0, 10)
      const similar = artists
        .filter((a) => a.id !== id && a.genres.some((g) => artist.genres.includes(g)))
        .sort((a, b) => b.trackCount - a.trackCount)
        .slice(0, 8)
      return { artist, albums: artistAlbums, topTracks, similar }
    },
    async getFolders() {
      const settings = await invoke<Settings>("settings_get")
      return settings.musicFolders.map((root) => buildFolderTree(root))
    },
    async search(text): Promise<SearchResults> {
      const q = norm(text.trim())
      if (!q) return { tracks: [], albums: [], artists: [], playlists: [], best: null }
      const found = {
        tracks: tracks.filter((t) => matches(q, t.title, t.artist, t.album)).sort((a, b) => b.plays - a.plays).slice(0, 20),
        albums: albums.filter((a) => matches(q, a.title, a.artist)).slice(0, 12),
        artists: artists.filter((a) => matches(q, a.name)).sort((a, b) => b.trackCount - a.trackCount).slice(0, 12),
        playlists: (await tauriBackend.playlists.list()).filter((p) => matches(q, p.name)).slice(0, 8),
      }
      const exact = (s: string) => norm(s) === q
      let best: SearchResults["best"] = null
      const exactArtist = found.artists.find((a) => exact(a.name))
      const exactAlbum = found.albums.find((a) => exact(a.title))
      const exactTrack = found.tracks.find((t) => exact(t.title))
      if (exactArtist) best = { kind: "artist", id: exactArtist.id }
      else if (exactAlbum) best = { kind: "album", id: exactAlbum.id }
      else if (exactTrack) best = { kind: "track", id: exactTrack.id }
      else if (found.artists[0]) best = { kind: "artist", id: found.artists[0].id }
      else if (found.albums[0]) best = { kind: "album", id: found.albums[0].id }
      else if (found.tracks[0]) best = { kind: "track", id: found.tracks[0].id }
      else if (found.playlists[0]) best = { kind: "playlist", id: found.playlists[0].id }
      return { ...found, best }
    },
    async getStats(): Promise<LibraryStats> {
      const ps = await invoke<PlayStats>("stats_plays", { tzOffsetMin: -new Date().getTimezoneOffset() })
      const msByTrack = new Map(ps.trackMs)
      const byArtist = new Map<string, number>()
      const byAlbum = new Map<string, number>()
      for (const t of tracks) {
        const ms = msByTrack.get(t.id) ?? 0
        if (ms) byArtist.set(t.artistId, (byArtist.get(t.artistId) ?? 0) + ms)
        if (t.plays) byAlbum.set(t.albumId, (byAlbum.get(t.albumId) ?? 0) + t.plays)
      }
      const genres = new Map<string, number>()
      tracks.forEach((t) => genres.set(t.genre || "Sans genre", (genres.get(t.genre || "Sans genre") ?? 0) + 1))
      return {
        trackCount: tracks.length,
        albumCount: albums.length,
        artistCount: artists.length,
        totalDurationMs: tracks.reduce((s, t) => s + t.durationMs, 0),
        totalSizeBytes: tracks.reduce((s, t) => s + t.fileSize, 0),
        listenedMsToday: ps.listenedMsToday,
        listenedMsWeek: ps.listenedMsWeek,
        listenedMsMonth: ps.listenedMsMonth,
        listenedMsAll: ps.listenedMsAll,
        streakDays: ps.streakDays,
        topArtists: [...byArtist.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([id, ms]) => ({ artistId: id, name: artistById.get(id)?.name ?? "", ms })),
        topAlbums: [...byAlbum.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([id, plays]) => ({ albumId: id, title: albumById.get(id)?.title ?? "", plays })),
        topTracks: tracks
          .filter((t) => t.plays > 0)
          .sort((a, b) => b.plays - a.plays)
          .slice(0, 5)
          .map((t) => ({ trackId: t.id, title: t.title, plays: t.plays })),
        genreDistribution: [...genres.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([genre, count]) => ({ genre, count })),
        heatmap: ps.heatmap,
        hourlyDistribution: ps.hourlyDistribution,
      }
    },
    async getRecentlyAdded() {
      return [...albums].sort((a, b) => b.addedAt - a.addedAt).slice(0, 12)
    },
    async getMostPlayed() {
      const played = tracks.filter((t) => t.plays > 0).sort((a, b) => b.plays - a.plays)
      // Bibliothèque neuve : on complète avec les derniers ajouts.
      const filler = [...tracks].sort((a, b) => b.addedAt - a.addedAt)
      return [...new Set([...played, ...filler])].slice(0, 12)
    },
    async getRediscover() {
      const pool = albums.filter((a) => albumTracks(a.id).every((t) => t.plays < 3))
      const src = pool.length >= 6 ? pool : albums
      return [...src].sort(() => Math.random() - 0.5).slice(0, 12)
    },
    async rescan() {
      await invoke<void>("library_rescan")
      await reloadLibrary()
    },
    onScanProgress(cb) {
      cb(lastScan)
      return scanCh.add(cb)
    },
    onChanged(cb) {
      return changedCh.add(cb)
    },
  },

  player: {
    play: (trackIds, startIndex) => invoke<void>("player_play", { trackIds, startIndex }),
    pause: () => invoke<void>("player_pause"),
    resume: () => invoke<void>("player_resume"),
    next: () => invoke<void>("player_next"),
    previous: () => invoke<void>("player_previous"),
    seek: (ms) => invoke<void>("player_seek", { ms }),
    setVolume: (volume) => invoke<void>("player_set_volume", { volume }),
    setMuted: (muted) => invoke<void>("player_set_muted", { muted }),
    setShuffle: (shuffle) => invoke<void>("player_set_shuffle", { shuffle }),
    setRepeat: (mode) => invoke<void>("player_set_repeat", { mode }),
    getState() {
      return { ...state, queue: [...state.queue], history: [...state.history] }
    },
    onStateChange(cb) {
      const unsub = stateCh.add(cb)
      cb(this.getState())
      return unsub
    },
    onPosition(cb) {
      return posCh.add(cb)
    },
    onAnalyser(cb) {
      // La capture audio ne tourne que tant qu'un visualiseur est affiché.
      const unsub = analyserCh.add(cb)
      if (analyserRefs++ === 0) void invoke<void>("visualizer_start").catch(() => {})
      return () => {
        unsub()
        if (--analyserRefs === 0) void invoke<void>("visualizer_stop")
      }
    },
  },

  queue: {
    get: () => [...state.queue],
    add: (trackIds, where) => invoke<void>("queue_add", { trackIds, position: where }),
    remove: (index) => invoke<void>("queue_remove", { index }),
    move: (from, to) => invoke<void>("queue_move", { from, to }),
    clear: () => invoke<void>("queue_clear"),
  },

  playlists: {
    async list() {
      return (await invoke<RawPlaylist[]>("playlists_list")).map(withPlaylistColors)
    },
    async get(id) {
      const p = (await invoke<RawPlaylist[]>("playlists_list")).find((x) => x.id === id)
      return p ? withPlaylistColors(p) : null
    },
    async create(name) {
      return withPlaylistColors(await invoke<RawPlaylist>("playlist_create", { name }))
    },
    rename: (id, name) => invoke<void>("playlist_update", { id, name }),
    update: (id, patch) => invoke<void>("playlist_update", { id, name: patch.name ?? null, description: patch.description ?? null }),
    delete: (id) => invoke<void>("playlist_delete", { id }),
    addTracks: (id, trackIds) => invoke<void>("playlist_add_tracks", { id, trackIds }),
    removeTracks: (id, trackIds) => invoke<void>("playlist_remove_tracks", { id, trackIds }),
    reorder: (id, from, to) => invoke<void>("playlist_reorder", { id, from, to }),
    setCover: (id, url) => invoke<void>("playlist_update", { id, coverUrl: url }),
  },

  favorites: {
    async toggle(trackId) {
      const fav = await invoke<boolean>("favorites_toggle", { trackId })
      const t = trackById.get(trackId)
      if (t) t.favorite = fav
      return fav
    },
    list: () => invoke<string[]>("favorites_list"),
  },

  lyrics: {
    async get(trackId, force = false) {
      return (await invoke<Lyrics>("lyrics_get", { trackId, force })) ?? null
    },
  },

  artwork: {
    getUrl(id) {
      // Accepte un id d'album, d'artiste, de titre ou de playlist.
      if (albumById.has(id)) return coverUrl(id)
      const t = trackById.get(id)
      if (t) return coverUrl(t.albumId)
      if (artistById.has(id)) {
        const a = albums.find((al) => al.artistId === id && albumCover.get(al.id)) ?? albums.find((al) => albumTracks(al.id).some((tr) => tr.artistId === id && albumCover.get(al.id)))
        return a ? coverUrl(a.id) : ""
      }
      return ""
    },
  },

  audio: {
    getDevices: () => invoke<AudioDevice[]>("audio_devices"),
    setDevice: (id) => invoke<void>("audio_set_device", { id }),
    getOutputStatus: () => invoke<OutputStatus>("audio_output_status"),
    onOutputChange(cb) {
      if (lastOutput) cb(lastOutput)
      else void invoke<OutputStatus>("audio_output_status").then((s) => {
        lastOutput = s
        cb(s)
      })
      return outputCh.add(cb)
    },
    getEq: () => invoke<{ bands: number[]; preamp: number; enabled: boolean }>("eq_get"),
    setEq: (bands, preamp, enabled) => invoke<void>("eq_set", { bands, preamp, enabled }),
    getEqPresets: () => invoke<EqPreset[]>("eq_presets"),
    saveEqPreset: (name, bands, preamp) => invoke<EqPreset>("eq_preset_save", { name, bands, preamp }),
    setCrossfade: (ms) => invoke<void>("audio_set_crossfade", { ms }),
    setGapless: (on) => invoke<void>("audio_set_gapless", { on }),
    setReplayGain: (mode) => invoke<void>("audio_set_replay_gain", { mode }),
  },

  radio: {
    async list() {
      return (await invoke<RawRadio[]>("radio_list")).map(withRadioColors)
    },
    async add(name, url, genre) {
      return withRadioColors(await invoke<RawRadio>("radio_add", { name, url, genre }))
    },
    remove: (id) => invoke<void>("radio_remove", { id }),
    play: (id) => invoke<void>("radio_play", { id }),
  },

  settings: {
    get: () => invoke<Settings>("settings_get"),
    update: (patch) => invoke<Settings>("settings_update", { patch }),
    addMusicFolder: (path) => invoke<void>("settings_add_folder", { path }),
    removeMusicFolder: (path) => invoke<void>("settings_remove_folder", { path }),
  },

  system: {
    onMediaKey() {
      // Les touches multimédia arrivent par MPRIS et sont traitées côté Rust.
      return () => {}
    },
    setMiniPlayer: (on) => invoke<void>("window_set_mini", { mini: on }),
    async openInFileManager(path) {
      await revealItemInDir(path)
    },
    async pickFolder() {
      const res = await openDialog({ directory: true, multiple: false, title: "Choisir un dossier de musique" })
      return typeof res === "string" ? res : null
    },
  },
}

// ---- Dossiers --------------------------------------------------------------------

function buildFolderTree(root: string): FolderNode {
  const rootNode: FolderNode = { id: `f:${root}`, name: root.split("/").filter(Boolean).pop() ?? root, path: root, type: "folder", children: [] }
  const prefix = root.endsWith("/") ? root : `${root}/`
  const sorted = tracks.filter((t) => t.filePath.startsWith(prefix)).sort((a, b) => a.filePath.localeCompare(b.filePath, "fr", { numeric: true }))
  for (const t of sorted) {
    const parts = t.filePath.slice(prefix.length).split("/")
    let node = rootNode
    let path = root
    for (const dir of parts.slice(0, -1)) {
      path = `${path}/${dir}`
      let child = node.children!.find((c) => c.type === "folder" && c.name === dir)
      if (!child) {
        child = { id: `f:${path}`, name: dir, path, type: "folder", children: [] }
        node.children!.push(child)
      }
      node = child
    }
    node.children!.push({ id: `t:${t.id}`, name: parts[parts.length - 1], path: t.filePath, type: "file", trackId: t.id })
  }
  // Dossiers d'abord
  const sortNode = (n: FolderNode) => {
    n.children?.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, "fr", { numeric: true }) : a.type === "folder" ? -1 : 1))
    n.children?.forEach(sortNode)
  }
  sortNode(rootNode)
  return rootNode
}
