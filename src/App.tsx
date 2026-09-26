import { useEffect } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { useUI } from "./store/uiStore"
import { useSettings } from "./store/settingsStore"
import { useLibrary } from "./store/libraryStore"
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts"
import { useDynamicColor } from "./hooks/useDynamicColor"

import DynamicBackground from "./components/DynamicBackground"
import Sidebar from "./features/shell/Sidebar"
import TopBar from "./features/shell/TopBar"
import PlayerBar from "./features/shell/PlayerBar"
import RightDrawer from "./features/shell/RightDrawer"
import TrackContextMenu from "./components/TrackContextMenu"
import CommandPalette from "./components/CommandPalette"
import Toasts from "./components/Toasts"
import AddToPlaylistModal from "./components/AddToPlaylistModal"
import PropertiesModal from "./components/PropertiesModal"

import Home from "./features/home/Home"
import Tracks from "./features/tracks/Tracks"
import Albums from "./features/albums/Albums"
import AlbumDetail from "./features/albums/AlbumDetail"
import Artists from "./features/artists/Artists"
import ArtistDetail from "./features/artists/ArtistDetail"
import Folders from "./features/folders/Folders"
import Favorites from "./features/favorites/Favorites"
import PlaylistDetail from "./features/playlists/PlaylistDetail"
import SearchScreen from "./features/search/Search"
import Radios from "./features/radios/Radios"
import Stats from "./features/stats/Stats"
import Equalizer from "./features/equalizer/Equalizer"
import SettingsScreen from "./features/settings/Settings"
import NowPlaying from "./features/nowplaying/NowPlaying"
import MiniPlayer from "./features/nowplaying/MiniPlayer"

function CurrentScreen() {
  const route = useUI((s) => s.route)
  switch (route.name) {
    case "home": return <Home />
    case "tracks": return <Tracks />
    case "albums": return <Albums />
    case "album": return <AlbumDetail id={route.id} />
    case "artists": return <Artists />
    case "artist": return <ArtistDetail id={route.id} />
    case "folders": return <Folders />
    case "favorites": return <Favorites />
    case "playlist": return <PlaylistDetail id={route.id} />
    case "search": return <SearchScreen />
    case "radios": return <Radios />
    case "stats": return <Stats />
    case "equalizer": return <Equalizer />
    case "settings": return <SettingsScreen />
    default: return <Home />
  }
}

export default function App() {
  const route = useUI((s) => s.route)
  const miniPlayer = useUI((s) => s.miniPlayer)
  const loadSettings = useSettings((s) => s.load)
  const settingsReady = useSettings((s) => !!s.settings)
  const loadFavorites = useLibrary((s) => s.loadFavorites)

  useKeyboardShortcuts()
  useDynamicColor()

  useEffect(() => {
    loadSettings()
    loadFavorites()
  }, [])

  if (!settingsReady) {
    return <div className="grid h-screen place-items-center bg-[var(--bg-0)] text-lo">Chargement…</div>
  }

  if (miniPlayer) return <MiniPlayer />

  const key = route.name === "album" || route.name === "artist" || route.name === "playlist" ? `${route.name}:${(route as any).id}` : route.name

  return (
    <div className="flex h-screen flex-col overflow-hidden p-3">
      <DynamicBackground />
      <div className="flex min-h-0 flex-1 gap-3">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <main className="glass-panel relative min-h-0 flex-1 overflow-hidden rounded-3xl">
            <div className="absolute inset-0 overflow-y-auto">
              <AnimatePresence mode="wait">
                <motion.div
                  key={key}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                  className="min-h-full"
                >
                  <CurrentScreen />
                </motion.div>
              </AnimatePresence>
            </div>
          </main>
        </div>
        <RightDrawer />
      </div>
      <div className="mt-3">
        <PlayerBar />
      </div>

      <NowPlaying />
      <CommandPalette />
      <TrackContextMenu />
      <AddToPlaylistModal />
      <PropertiesModal />
      <Toasts />
    </div>
  )
}
