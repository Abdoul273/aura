// Domain types for Aura. The single source of truth shared across the
// backend contract, the Tauri implementation and the Zustand stores.

export type Codec = "FLAC" | "MP3" | "OPUS" | "AAC" | "ALAC" | "VORBIS" | "WAV" | "AIFF" | "WAVPACK" | "APE" | "MPC" | "AUDIO"
export type AudioQuality = "Hi-Res" | "Lossless" | "Lossy"

export interface Track {
  id: string
  title: string
  artist: string
  artistId: string
  album: string
  albumId: string
  trackNumber: number
  discNumber: number
  year: number
  genre: string
  durationMs: number
  codec: Codec
  bitrate: number // kbps
  sampleRate: number // Hz
  bitDepth: number // bits
  quality: AudioQuality
  filePath: string
  fileSize: number // bytes
  plays: number
  addedAt: number // epoch ms
  favorite: boolean
  colors: AlbumColors
}

export interface AlbumColors {
  dominant: string
  accent: string
  muted: string
}

export interface Album {
  id: string
  title: string
  artist: string
  artistId: string
  year: number
  genre: string
  trackCount: number
  durationMs: number
  codec: Codec
  quality: AudioQuality
  colors: AlbumColors
  addedAt: number
}

export interface Artist {
  id: string
  name: string
  albumCount: number
  trackCount: number
  genres: string[]
  colors: AlbumColors
  bio: string
  monthlyListeners: number
}

export interface Playlist {
  id: string
  name: string
  description: string
  trackIds: string[]
  createdAt: number
  updatedAt: number
  smart: boolean
  colors: AlbumColors
  coverUrl?: string
}

export interface FolderNode {
  id: string
  name: string
  path: string
  type: "folder" | "file"
  children?: FolderNode[]
  trackId?: string
}

export interface RadioStation {
  id: string
  name: string
  genre: string
  streamUrl: string
  homepage: string
  bitrate: number
  live: boolean
  colors: AlbumColors
  nowPlaying?: string
}

export interface QueueItem {
  uid: string // unique per queue entry
  trackId: string
}

export interface LyricsLine {
  timeMs: number
  text: string
  /** Horodatage mot à mot, quand la source le fournit (LRC enrichi, NetEase yrc). */
  words?: { timeMs: number; text: string }[]
  endMs?: number
}

export type Lyrics =
  | { kind: "synced"; lines: LyricsLine[]; source: string; approximate?: boolean }
  | { kind: "plain"; text: string; source: string }
  | { kind: "instrumental"; source: string }
  | null

/** Résultat de recherche du téléchargeur (YouTube). */
export interface DlResult {
  id: string
  url: string
  title: string
  channel: string
  durationS: number
  views: number
  thumbnail: string
  verified: boolean
  /** Artiste et titre qui seront écrits dans les tags (modifiables). */
  artist: string
  track: string
  kind: "audio" | "clip" | "live" | "other"
}

export type LyricsAvailability = "synced" | "approx" | "plain" | "instrumental" | "none"

export type DlStatus = "queued" | "downloading" | "retrying" | "converting" | "tagging" | "lyrics" | "done" | "error" | "canceled"

export interface DlJob {
  id: string
  title: string
  artist: string
  thumbnail: string
  status: DlStatus
  progress: number
  speed: string
  eta: string
  error: string | null
  lyrics: LyricsAvailability | null
  path: string | null
}

/** Résultat de la recherche manuelle de paroles. */
export interface LyricsResult {
  title: string
  artist: string
  album: string
  durationS: number
  source: string
  synced: boolean
  text: string
}

export interface LyricsSearch {
  query: string
  results: LyricsResult[]
}

export interface EqBand {
  freq: number // Hz
  gain: number // dB, -12..12
}

export interface EqPreset {
  id: string
  name: string
  bands: number[] // 10 gains
  preamp: number
}

export interface AudioDevice {
  id: string
  name: string
  type: "speakers" | "headphones" | "hdmi" | "bluetooth"
  active: boolean
  driver: string // e.g. "ALSA", "PipeWire", "Bluetooth"
}

export interface OutputStatus {
  driver: string // e.g. "ALSA"
  deviceName: string
  bitPerfect: boolean
  exclusive: boolean
  sampleRate: number // Hz of the active stream
  bitDepth: number // bits
}

export type RepeatMode = "off" | "all" | "one"
export type PlaybackStatus = "playing" | "paused" | "stopped" | "loading"

export interface PlayerState {
  status: PlaybackStatus
  currentTrackId: string | null
  positionMs: number
  durationMs: number
  volume: number // 0..1
  muted: boolean
  shuffle: boolean
  repeat: RepeatMode
  queue: QueueItem[]
  queueIndex: number
  history: string[] // track ids, most recent last
  radioId: string | null
  radioTitle?: string | null // live ICY title of the current radio
}

export interface LibraryStats {
  trackCount: number
  albumCount: number
  artistCount: number
  totalDurationMs: number
  totalSizeBytes: number
  listenedMsToday: number
  listenedMsWeek: number
  listenedMsMonth: number
  listenedMsAll: number
  streakDays: number
  topArtists: { artistId: string; name: string; ms: number }[]
  topAlbums: { albumId: string; title: string; plays: number }[]
  topTracks: { trackId: string; title: string; plays: number }[]
  genreDistribution: { genre: string; count: number }[]
  heatmap: number[] // 7*53 weeks of intensity 0..1 (=371)
  hourlyDistribution: number[] // 24
}

export type ThemeMode = "dark" | "light"
export type ReplayGainMode = "off" | "track" | "album"

export interface Settings {
  theme: ThemeMode
  accent: string
  dynamicColor: boolean
  blurIntensity: number // 0..100
  animations: boolean
  sidebarCollapsed: boolean
  drawerOpen: boolean
  drawerTab: "queue" | "lyrics"
  tracksSort: SortSpec
  crossfadeMs: number
  gapless: boolean
  replayGain: ReplayGainMode
  musicFolders: string[]
}

export interface SortSpec {
  key: string
  dir: "asc" | "desc"
}

export interface Paging {
  offset: number
  limit: number
}

export interface AnalyserData {
  bins: number[] // 0..1 magnitudes
}

export interface ScanProgress {
  scanning: boolean
  current: number
  total: number
  currentPath: string
}
