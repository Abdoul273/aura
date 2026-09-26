// The MusicBackend contract. Swapping the real audio engine in later means
// implementing this interface and changing the single export in ./index.ts.
// Components never touch this directly — only the Zustand stores do.

import type {
  Album,
  Artist,
  AudioDevice,
  EqPreset,
  FolderNode,
  LibraryStats,
  Lyrics,
  OutputStatus,
  Paging,
  PlayerState,
  Playlist,
  QueueItem,
  RadioStation,
  ScanProgress,
  Settings,
  SortSpec,
  Track,
} from "../types"

export type Unsubscribe = () => void

export interface SearchResults {
  tracks: Track[]
  albums: Album[]
  artists: Artist[]
  playlists: Playlist[]
  best: { kind: "track" | "album" | "artist" | "playlist"; id: string } | null
}

export interface MusicBackend {
  library: {
    getTracks(query: string, sort: SortSpec, paging: Paging): Promise<{ items: Track[]; total: number }>
    getTrack(id: string): Promise<Track | null>
    getAlbums(): Promise<Album[]>
    getAlbum(id: string): Promise<{ album: Album; tracks: Track[] } | null>
    getArtists(): Promise<Artist[]>
    getArtist(id: string): Promise<{ artist: Artist; albums: Album[]; topTracks: Track[]; similar: Artist[] } | null>
    getFolders(): Promise<FolderNode[]>
    search(text: string): Promise<SearchResults>
    getStats(): Promise<LibraryStats>
    getRecentlyAdded(): Promise<Album[]>
    getMostPlayed(): Promise<Track[]>
    getRediscover(): Promise<Album[]>
    rescan(): Promise<void>
    onScanProgress(cb: (p: ScanProgress) => void): Unsubscribe
    /** Fired when the library content changed (scan finished, folder added…). */
    onChanged(cb: () => void): Unsubscribe
  }
  player: {
    play(trackIds: string[], startIndex: number): Promise<void>
    pause(): Promise<void>
    resume(): Promise<void>
    next(): Promise<void>
    previous(): Promise<void>
    seek(ms: number): Promise<void>
    setVolume(v: number): Promise<void>
    setMuted(m: boolean): Promise<void>
    setShuffle(s: boolean): Promise<void>
    setRepeat(mode: PlayerState["repeat"]): Promise<void>
    getState(): PlayerState
    onStateChange(cb: (s: PlayerState) => void): Unsubscribe
    onPosition(cb: (ms: number) => void): Unsubscribe
    onAnalyser(cb: (bins: number[]) => void): Unsubscribe
  }
  queue: {
    get(): QueueItem[]
    add(trackIds: string[], where: "next" | "end"): Promise<void>
    remove(index: number): Promise<void>
    move(from: number, to: number): Promise<void>
    clear(): Promise<void>
  }
  playlists: {
    list(): Promise<Playlist[]>
    get(id: string): Promise<Playlist | null>
    create(name: string): Promise<Playlist>
    rename(id: string, name: string): Promise<void>
    update(id: string, patch: Partial<Pick<Playlist, "name" | "description">>): Promise<void>
    delete(id: string): Promise<void>
    addTracks(id: string, trackIds: string[]): Promise<void>
    removeTracks(id: string, trackIds: string[]): Promise<void>
    reorder(id: string, from: number, to: number): Promise<void>
    setCover(id: string, url: string): Promise<void>
  }
  favorites: {
    toggle(trackId: string): Promise<boolean>
    list(): Promise<string[]>
  }
  lyrics: {
    /** `force` ignore le cache et relance la recherche en ligne. */
    get(trackId: string, force?: boolean): Promise<Lyrics>
  }
  artwork: {
    getUrl(albumId: string, size: number): string
  }
  audio: {
    getDevices(): Promise<AudioDevice[]>
    setDevice(id: string): Promise<void>
    getOutputStatus(): Promise<OutputStatus>
    onOutputChange(cb: (s: OutputStatus) => void): Unsubscribe
    getEq(): Promise<{ bands: number[]; preamp: number; enabled: boolean }>
    setEq(bands: number[], preamp: number, enabled: boolean): Promise<void>
    getEqPresets(): Promise<EqPreset[]>
    saveEqPreset(name: string, bands: number[], preamp: number): Promise<EqPreset>
    setCrossfade(ms: number): Promise<void>
    setGapless(on: boolean): Promise<void>
    setReplayGain(mode: Settings["replayGain"]): Promise<void>
  }
  radio: {
    list(): Promise<RadioStation[]>
    add(name: string, url: string, genre: string): Promise<RadioStation>
    remove(id: string): Promise<void>
    play(id: string): Promise<void>
  }
  settings: {
    get(): Promise<Settings>
    update(patch: Partial<Settings>): Promise<Settings>
    addMusicFolder(path: string): Promise<void>
    removeMusicFolder(path: string): Promise<void>
  }
  system: {
    onMediaKey(cb: (key: "play" | "pause" | "next" | "prev") => void): Unsubscribe
    setMiniPlayer(on: boolean): Promise<void>
    openInFileManager(path: string): Promise<void>
    /** Native folder picker: path, null if cancelled, undefined if no native picker exists. */
    pickFolder(): Promise<string | null | undefined>
  }
}
