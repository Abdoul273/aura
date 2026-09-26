// Full in-memory implementation of MusicBackend. Simulates playback with a
// 250ms position tick, auto-advance, shuffle/repeat, an animated analyser
// stream and small artificial latency so loading states are exercised.

import type { MusicBackend, SearchResults, Unsubscribe } from "./backend"
import type {
  AudioDevice,
  EqPreset,
  LibraryStats,
  Paging,
  PlayerState,
  Playlist,
  QueueItem,
  Settings,
  SortSpec,
  Track,
} from "../types"
import { buildMockDb, GENRES, type MockDb } from "./mockData"

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))
const lat = () => delay(120 + Math.random() * 260)
let uidSeq = 0
const uid = () => `q${uidSeq++}`

const db: MockDb = buildMockDb()
const trackById = new Map(db.tracks.map((t) => [t.id, t]))

// ---- Player state & emitters -------------------------------------------------
const state: PlayerState = {
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

type Cb<T> = (v: T) => void
const stateSubs = new Set<Cb<PlayerState>>()
const posSubs = new Set<Cb<number>>()
const analyserSubs = new Set<Cb<number[]>>()
const scanSubs = new Set<Cb<import("../types").ScanProgress>>()
const mediaKeySubs = new Set<Cb<"play" | "pause" | "next" | "prev">>()

function emitState() {
  const snap = { ...state, queue: [...state.queue], history: [...state.history] }
  stateSubs.forEach((cb) => cb(snap))
}
function emitPos() {
  posSubs.forEach((cb) => cb(state.positionMs))
}

// position ticker
setInterval(() => {
  if (state.status !== "playing") return
  state.positionMs += 250
  if (state.positionMs >= state.durationMs) {
    autoNext()
  } else {
    emitPos()
  }
}, 250)

// analyser (animated noise), only meaningful while playing
let analyserPhase = 0
setInterval(() => {
  if (analyserSubs.size === 0) return
  analyserPhase += 0.08
  const active = state.status === "playing"
  const bins: number[] = []
  for (let i = 0; i < 64; i++) {
    const base = active ? 0.35 + 0.65 * Math.abs(Math.sin(analyserPhase + i * 0.35)) : 0.02
    const env = active ? 1 - i / 90 : 1
    bins.push(Math.max(0, Math.min(1, base * env * (0.7 + Math.random() * 0.5))))
  }
  analyserSubs.forEach((cb) => cb(bins))
}, 60)

function loadTrack(id: string) {
  const t = trackById.get(id)
  if (!t) return
  state.currentTrackId = id
  state.durationMs = t.durationMs
  state.positionMs = 0
  state.radioId = null
  emitOutput()
}

function autoNext() {
  if (state.repeat === "one") {
    state.positionMs = 0
    emitState()
    return
  }
  const q = state.queue
  if (state.currentTrackId) state.history.push(state.currentTrackId)
  if (state.queueIndex < q.length - 1) {
    state.queueIndex++
    loadTrack(q[state.queueIndex].trackId)
    state.status = "playing"
  } else if (state.repeat === "all" && q.length > 0) {
    state.queueIndex = 0
    loadTrack(q[0].trackId)
    state.status = "playing"
  } else {
    state.status = "paused"
    state.positionMs = state.durationMs
  }
  emitState()
}

function buildQueue(trackIds: string[]): QueueItem[] {
  return trackIds.map((trackId) => ({ uid: uid(), trackId }))
}

// ---- persistence for settings/eq/etc ----------------------------------------
let settings: Settings = {
  theme: "dark",
  accent: "#7c5cff",
  dynamicColor: true,
  blurIntensity: 65,
  animations: true,
  sidebarCollapsed: false,
  drawerOpen: false,
  drawerTab: "queue",
  tracksSort: { key: "title", dir: "asc" },
  crossfadeMs: 0,
  gapless: true,
  replayGain: "off",
  musicFolders: ["/home/user/Musique", "/mnt/nas/FLAC"],
}
try {
  const raw = localStorage.getItem("aura-settings")
  if (raw) settings = { ...settings, ...JSON.parse(raw) }
} catch {}
function persistSettings() {
  try {
    localStorage.setItem("aura-settings", JSON.stringify(settings))
  } catch {}
}

let eq = { bands: new Array(10).fill(0) as number[], preamp: 0, enabled: false }
const eqPresets: EqPreset[] = [
  { id: "flat", name: "Plat", bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], preamp: 0 },
  { id: "rock", name: "Rock", bands: [4, 3, -1, -2, -1, 1, 3, 4, 4, 4], preamp: 1 },
  { id: "bass", name: "Bass Boost", bands: [7, 6, 5, 3, 1, 0, 0, 0, 0, 0], preamp: 2 },
  { id: "vocal", name: "Voix", bands: [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1], preamp: 0 },
  { id: "electro", name: "Électronique", bands: [5, 4, 1, 0, -1, 1, 0, 2, 4, 5], preamp: 1 },
  { id: "classical", name: "Classique", bands: [4, 3, 2, 1, -1, -1, 0, 2, 3, 4], preamp: 0 },
  { id: "jazz", name: "Jazz", bands: [3, 2, 1, 2, -1, -1, 0, 1, 2, 3], preamp: 0 },
]

const devices: AudioDevice[] = [
  { id: "d1", name: "Focusrite Scarlett 2i2", type: "speakers", active: true, driver: "ALSA" },
  { id: "d2", name: "Sennheiser HD 600", type: "headphones", active: false, driver: "ALSA" },
  { id: "d3", name: "Écran HDMI — LG UltraFine", type: "hdmi", active: false, driver: "PipeWire" },
  { id: "d4", name: "AirPods Pro", type: "bluetooth", active: false, driver: "Bluetooth" },
]

const outputSubs = new Set<Cb<import("../types").OutputStatus>>()
function computeOutputStatus(): import("../types").OutputStatus {
  const active = devices.find((d) => d.active) ?? devices[0]
  const track = state.currentTrackId ? trackById.get(state.currentTrackId) : undefined
  // Bit-perfect + exclusive on wired ALSA outputs; Bluetooth is resampled/lossy.
  const bitPerfect = active.driver === "ALSA"
  return {
    driver: active.driver,
    deviceName: active.name,
    bitPerfect,
    exclusive: bitPerfect,
    sampleRate: track?.sampleRate ?? 44100,
    bitDepth: track?.bitDepth ?? 16,
  }
}
function emitOutput() {
  const s = computeOutputStatus()
  outputSubs.forEach((cb) => cb(s))
}

// ---- sorting/search helpers --------------------------------------------------
function sortTracks(items: Track[], sort: SortSpec): Track[] {
  const dir = sort.dir === "asc" ? 1 : -1
  const key = sort.key as keyof Track
  return [...items].sort((a, b) => {
    const av = a[key] as unknown as string | number
    const bv = b[key] as unknown as string | number
    if (av < bv) return -1 * dir
    if (av > bv) return 1 * dir
    return 0
  })
}

// ---- backend -----------------------------------------------------------------
export const mockBackend: MusicBackend = {
  library: {
    async getTracks(query, sort, paging: Paging) {
      await lat()
      let items = db.tracks
      if (query) {
        const q = query.toLowerCase()
        items = items.filter(
          (t) => t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q) || t.album.toLowerCase().includes(q),
        )
      }
      items = sortTracks(items, sort)
      return { items: items.slice(paging.offset, paging.offset + paging.limit), total: items.length }
    },
    async getTrack(id) {
      await lat()
      return trackById.get(id) ?? null
    },
    async getAlbums() {
      await lat()
      return [...db.albums]
    },
    async getAlbum(id) {
      await lat()
      const album = db.albums.find((a) => a.id === id)
      if (!album) return null
      const tracks = db.tracks.filter((t) => t.albumId === id).sort((a, b) => a.discNumber - b.discNumber || a.trackNumber - b.trackNumber)
      return { album, tracks }
    },
    async getArtists() {
      await lat()
      return [...db.artists]
    },
    async getArtist(id) {
      await lat()
      const artist = db.artists.find((a) => a.id === id)
      if (!artist) return null
      const albums = db.albums.filter((a) => a.artistId === id)
      const topTracks = db.tracks
        .filter((t) => t.artistId === id)
        .sort((a, b) => b.plays - a.plays)
        .slice(0, 5)
      const similar = db.artists.filter((a) => a.id !== id && a.genres.some((g) => artist.genres.includes(g))).slice(0, 6)
      return { artist, albums, topTracks, similar }
    },
    async getFolders() {
      await lat()
      return db.folders
    },
    async search(text): Promise<SearchResults> {
      await delay(90)
      const q = text.toLowerCase().trim()
      if (!q) return { tracks: [], albums: [], artists: [], playlists: [], best: null }
      const tracks = db.tracks.filter((t) => t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q)).slice(0, 8)
      const albums = db.albums.filter((a) => a.title.toLowerCase().includes(q) || a.artist.toLowerCase().includes(q)).slice(0, 8)
      const artists = db.artists.filter((a) => a.name.toLowerCase().includes(q)).slice(0, 8)
      const playlists = db.playlists.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 8)
      let best: SearchResults["best"] = null
      if (artists[0]) best = { kind: "artist", id: artists[0].id }
      else if (albums[0]) best = { kind: "album", id: albums[0].id }
      else if (tracks[0]) best = { kind: "track", id: tracks[0].id }
      else if (playlists[0]) best = { kind: "playlist", id: playlists[0].id }
      return { tracks, albums, artists, playlists, best }
    },
    async getStats(): Promise<LibraryStats> {
      await lat()
      const totalDurationMs = db.tracks.reduce((s, t) => s + t.durationMs, 0)
      const totalSizeBytes = db.tracks.reduce((s, t) => s + t.fileSize, 0)
      const byArtist = new Map<string, number>()
      db.tracks.forEach((t) => byArtist.set(t.artistId, (byArtist.get(t.artistId) ?? 0) + t.plays * t.durationMs))
      const topArtists = [...byArtist.entries()]
        .map(([artistId, ms]) => ({ artistId, name: db.artists.find((a) => a.id === artistId)?.name ?? "", ms }))
        .sort((a, b) => b.ms - a.ms)
        .slice(0, 5)
      const topAlbums = [...db.albums]
        .map((a) => ({ albumId: a.id, title: a.title, plays: db.tracks.filter((t) => t.albumId === a.id).reduce((s, t) => s + t.plays, 0) }))
        .sort((a, b) => b.plays - a.plays)
        .slice(0, 5)
      const topTracks = [...db.tracks].sort((a, b) => b.plays - a.plays).slice(0, 5).map((t) => ({ trackId: t.id, title: t.title, plays: t.plays }))
      const genreDistribution = GENRES.map((genre) => ({ genre, count: db.tracks.filter((t) => t.genre === genre).length })).filter((g) => g.count > 0)
      const heatmap = Array.from({ length: 371 }, (_, i) => {
        const s = Math.sin(i * 0.7) * Math.cos(i * 0.13)
        return Math.max(0, Math.min(1, 0.5 + s * 0.5)) * (Math.random() > 0.25 ? 1 : 0.05)
      })
      const hourlyDistribution = Array.from({ length: 24 }, (_, h) => Math.max(0.05, Math.sin(((h - 6) / 24) * Math.PI) * 0.8 + Math.random() * 0.2))
      return {
        trackCount: db.tracks.length,
        albumCount: db.albums.length,
        artistCount: db.artists.length,
        totalDurationMs,
        totalSizeBytes,
        listenedMsToday: 3 * 3600000 + 1200000,
        listenedMsWeek: 19 * 3600000,
        listenedMsMonth: 74 * 3600000,
        listenedMsAll: 1284 * 3600000,
        streakDays: 12,
        topArtists,
        topAlbums,
        topTracks,
        genreDistribution,
        heatmap,
        hourlyDistribution,
      }
    },
    async getRecentlyAdded() {
      await lat()
      return [...db.albums].sort((a, b) => b.addedAt - a.addedAt).slice(0, 12)
    },
    async getMostPlayed() {
      await lat()
      return [...db.tracks].sort((a, b) => b.plays - a.plays).slice(0, 12)
    },
    async getRediscover() {
      await lat()
      return [...db.albums].sort(() => Math.random() - 0.5).slice(0, 12)
    },
    async rescan() {
      const total = 240
      let current = 0
      scanSubs.forEach((cb) => cb({ scanning: true, current, total, currentPath: "" }))
      await new Promise<void>((resolve) => {
        const iv = setInterval(() => {
          current += 6 + Math.floor(Math.random() * 10)
          if (current >= total) {
            clearInterval(iv)
            scanSubs.forEach((cb) => cb({ scanning: false, current: total, total, currentPath: "" }))
            resolve()
          } else {
            const t = db.tracks[current % db.tracks.length]
            scanSubs.forEach((cb) => cb({ scanning: true, current, total, currentPath: t.filePath }))
          }
        }, 120)
      })
    },
    onScanProgress(cb) {
      scanSubs.add(cb)
      return () => scanSubs.delete(cb)
    },
    onChanged() {
      return () => {}
    },
  },

  player: {
    async play(trackIds, startIndex) {
      await delay(80)
      state.queue = buildQueue(trackIds)
      state.queueIndex = Math.max(0, Math.min(startIndex, state.queue.length - 1))
      if (state.shuffle) shuffleQueueKeepingCurrent()
      loadTrack(state.queue[state.queueIndex].trackId)
      state.status = "playing"
      emitState()
    },
    async pause() {
      state.status = "paused"
      emitState()
    },
    async resume() {
      if (state.currentTrackId) {
        state.status = "playing"
        emitState()
      }
    },
    async next() {
      if (state.queueIndex < state.queue.length - 1) {
        if (state.currentTrackId) state.history.push(state.currentTrackId)
        state.queueIndex++
        loadTrack(state.queue[state.queueIndex].trackId)
        state.status = "playing"
      } else if (state.repeat === "all" && state.queue.length) {
        state.queueIndex = 0
        loadTrack(state.queue[0].trackId)
        state.status = "playing"
      }
      emitState()
    },
    async previous() {
      if (state.positionMs > 4000) {
        state.positionMs = 0
        emitState()
        return
      }
      if (state.queueIndex > 0) {
        state.queueIndex--
        loadTrack(state.queue[state.queueIndex].trackId)
        state.status = "playing"
      } else {
        state.positionMs = 0
      }
      emitState()
    },
    async seek(ms) {
      state.positionMs = Math.max(0, Math.min(ms, state.durationMs))
      emitPos()
      emitState()
    },
    async setVolume(v) {
      state.volume = Math.max(0, Math.min(1, v))
      if (state.volume > 0) state.muted = false
      emitState()
    },
    async setMuted(m) {
      state.muted = m
      emitState()
    },
    async setShuffle(s) {
      state.shuffle = s
      if (s) shuffleQueueKeepingCurrent()
      emitState()
    },
    async setRepeat(mode) {
      state.repeat = mode
      emitState()
    },
    getState() {
      return { ...state, queue: [...state.queue], history: [...state.history] }
    },
    onStateChange(cb) {
      stateSubs.add(cb)
      cb(this.getState())
      return () => stateSubs.delete(cb)
    },
    onPosition(cb) {
      posSubs.add(cb)
      return () => posSubs.delete(cb)
    },
    onAnalyser(cb) {
      analyserSubs.add(cb)
      return () => analyserSubs.delete(cb)
    },
  },

  queue: {
    get() {
      return [...state.queue]
    },
    async add(trackIds, where) {
      const items = buildQueue(trackIds)
      if (where === "next") {
        state.queue.splice(state.queueIndex + 1, 0, ...items)
      } else {
        state.queue.push(...items)
      }
      if (state.currentTrackId === null && state.queue.length) {
        state.queueIndex = 0
        loadTrack(state.queue[0].trackId)
        state.status = "paused"
      }
      emitState()
    },
    async remove(index) {
      if (index < 0 || index >= state.queue.length) return
      state.queue.splice(index, 1)
      if (index < state.queueIndex) state.queueIndex--
      emitState()
    },
    async move(from, to) {
      if (from === to) return
      const [item] = state.queue.splice(from, 1)
      state.queue.splice(to, 0, item)
      const cur = state.queueIndex
      if (from === cur) state.queueIndex = to
      else if (from < cur && to >= cur) state.queueIndex--
      else if (from > cur && to <= cur) state.queueIndex++
      emitState()
    },
    async clear() {
      const cur = state.queue[state.queueIndex]
      state.queue = cur ? [cur] : []
      state.queueIndex = cur ? 0 : -1
      emitState()
    },
  },

  playlists: {
    async list() {
      await lat()
      return db.playlists.map((p) => ({ ...p }))
    },
    async get(id) {
      await lat()
      const p = db.playlists.find((x) => x.id === id)
      return p ? { ...p } : null
    },
    async create(name) {
      await delay(120)
      const p: Playlist = {
        id: `pl_${Date.now()}`,
        name,
        description: "",
        trackIds: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        smart: false,
        colors: { dominant: "hsl(260 60% 50%)", accent: "hsl(300 70% 60%)", muted: "hsl(260 30% 22%)" },
      }
      db.playlists.push(p)
      return { ...p }
    },
    async rename(id, name) {
      const p = db.playlists.find((x) => x.id === id)
      if (p) {
        p.name = name
        p.updatedAt = Date.now()
      }
    },
    async update(id, patch) {
      const p = db.playlists.find((x) => x.id === id)
      if (p) Object.assign(p, patch, { updatedAt: Date.now() })
    },
    async delete(id) {
      const i = db.playlists.findIndex((x) => x.id === id)
      if (i >= 0) db.playlists.splice(i, 1)
    },
    async addTracks(id, trackIds) {
      const p = db.playlists.find((x) => x.id === id)
      if (p) {
        p.trackIds = Array.from(new Set([...p.trackIds, ...trackIds]))
        p.updatedAt = Date.now()
      }
    },
    async removeTracks(id, trackIds) {
      const p = db.playlists.find((x) => x.id === id)
      if (p) {
        const set = new Set(trackIds)
        p.trackIds = p.trackIds.filter((t) => !set.has(t))
        p.updatedAt = Date.now()
      }
    },
    async reorder(id, from, to) {
      const p = db.playlists.find((x) => x.id === id)
      if (p) {
        const [t] = p.trackIds.splice(from, 1)
        p.trackIds.splice(to, 0, t)
        p.updatedAt = Date.now()
      }
    },
    async setCover(id, url) {
      const p = db.playlists.find((x) => x.id === id)
      if (p) p.coverUrl = url
    },
  },

  favorites: {
    async toggle(trackId) {
      const t = trackById.get(trackId)
      if (!t) return false
      t.favorite = !t.favorite
      return t.favorite
    },
    async list() {
      return db.tracks.filter((t) => t.favorite).map((t) => t.id)
    },
  },

  lyrics: {
    async get(trackId) {
      await lat()
      return db.lyrics[trackId] ?? null
    },
  },

  artwork: {
    getUrl(albumId, size) {
      return albumId ? `https://picsum.photos/seed/${albumId}/${Math.min(size * 2, 600)}` : ""
    },
  },

  audio: {
    async getDevices() {
      await lat()
      return devices.map((d) => ({ ...d }))
    },
    async setDevice(id) {
      devices.forEach((d) => (d.active = d.id === id))
      emitOutput()
    },
    async getOutputStatus() {
      await lat()
      return computeOutputStatus()
    },
    onOutputChange(cb) {
      outputSubs.add(cb)
      cb(computeOutputStatus())
      return () => outputSubs.delete(cb)
    },
    async getEq() {
      await lat()
      return { ...eq, bands: [...eq.bands] }
    },
    async setEq(bands, preamp, enabled) {
      eq = { bands: [...bands], preamp, enabled }
    },
    async getEqPresets() {
      return eqPresets.map((p) => ({ ...p }))
    },
    async saveEqPreset(name, bands, preamp) {
      const p: EqPreset = { id: `eq_${Date.now()}`, name, bands: [...bands], preamp }
      eqPresets.push(p)
      return { ...p }
    },
    async setCrossfade(ms) {
      settings.crossfadeMs = ms
      persistSettings()
    },
    async setGapless(on) {
      settings.gapless = on
      persistSettings()
    },
    async setReplayGain(mode) {
      settings.replayGain = mode
      persistSettings()
    },
  },

  radio: {
    async list() {
      await lat()
      return db.radios.map((r) => ({ ...r }))
    },
    async add(name, url, genre) {
      await delay(120)
      const r = {
        id: `rd_${Date.now()}`,
        name,
        genre,
        streamUrl: url,
        homepage: url,
        bitrate: 128,
        live: true,
        colors: { dominant: "hsl(200 60% 50%)", accent: "hsl(180 70% 60%)", muted: "hsl(200 30% 22%)" },
      }
      db.radios.push(r)
      return { ...r }
    },
    async remove(id) {
      const i = db.radios.findIndex((r) => r.id === id)
      if (i >= 0) db.radios.splice(i, 1)
    },
    async play(id) {
      const r = db.radios.find((x) => x.id === id)
      if (!r) return
      state.radioId = id
      state.currentTrackId = null
      state.status = "playing"
      state.durationMs = 0
      state.positionMs = 0
      emitState()
    },
  },

  settings: {
    async get() {
      return { ...settings }
    },
    async update(patch) {
      settings = { ...settings, ...patch }
      persistSettings()
      return { ...settings }
    },
    async addMusicFolder(path) {
      if (!settings.musicFolders.includes(path)) settings.musicFolders.push(path)
      persistSettings()
    },
    async removeMusicFolder(path) {
      settings.musicFolders = settings.musicFolders.filter((p) => p !== path)
      persistSettings()
    },
  },

  system: {
    onMediaKey(cb) {
      mediaKeySubs.add(cb)
      return () => mediaKeySubs.delete(cb)
    },
    async setMiniPlayer() {},
    async openInFileManager() {},
    async pickFolder() {
      return undefined
    },
  },
}

function shuffleQueueKeepingCurrent() {
  if (state.queue.length < 2) return
  const current = state.queue[state.queueIndex]
  const rest = state.queue.filter((_, i) => i !== state.queueIndex)
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[rest[i], rest[j]] = [rest[j], rest[i]]
  }
  state.queue = current ? [current, ...rest] : rest
  state.queueIndex = current ? 0 : -1
}

// expose for stores that want a quick synchronous track lookup
export function getTrackSync(id: string): Track | undefined {
  return trackById.get(id)
}

// unused emitter kept for parity with the contract's media-key hook
void mediaKeySubs
