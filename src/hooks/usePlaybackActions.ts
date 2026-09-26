import { backend } from "../services"
import { usePlayer } from "../store/playerStore"
import { useUI } from "../store/uiStore"
import { useLibrary } from "../store/libraryStore"

// Centralised, imperative playback/navigation helpers shared by rows, cards,
// context menus and the command palette. Components call these instead of
// touching the backend directly.
export function usePlaybackActions() {
  const toast = useUI((s) => s.toast)
  const navigate = useUI((s) => s.navigate)

  return {
    playContext(trackIds: string[], startIndex = 0) {
      usePlayer.getState().playTracks(trackIds, startIndex)
    },
    async playNext(trackIds: string[]) {
      await backend.queue.add(trackIds, "next")
      toast(trackIds.length > 1 ? `${trackIds.length} titres lus ensuite` : "Lu ensuite")
    },
    async addToQueue(trackIds: string[]) {
      await backend.queue.add(trackIds, "end")
      toast(trackIds.length > 1 ? `${trackIds.length} titres ajoutés à la file` : "Ajouté à la file")
    },
    async toggleFavorite(trackId: string) {
      const fav = await useLibrary.getState().toggleFavorite(trackId)
      toast(fav ? "Ajouté aux favoris" : "Retiré des favoris")
      return fav
    },
    async goToAlbum(trackId: string) {
      const t = await backend.library.getTrack(trackId)
      if (t) navigate({ name: "album", id: t.albumId })
    },
    async goToArtist(trackId: string) {
      const t = await backend.library.getTrack(trackId)
      if (t) navigate({ name: "artist", id: t.artistId })
    },
    async openInFileManager(trackId: string) {
      const t = await backend.library.getTrack(trackId)
      if (t) {
        await backend.system.openInFileManager(t.filePath)
        toast("Ouvert dans le gestionnaire de fichiers")
      }
    },
  }
}
