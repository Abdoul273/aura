# Aura — lecteur de musique haute-fidélité

Aura est l'interface (frontend uniquement) d'un lecteur de musique de bureau
« liquid glass » sombre, pensé pour de grandes bibliothèques locales
(FLAC / MP3 / OPUS) et les radios internet. L'application tourne sur des
**données factices réalistes** ; un vrai moteur audio (Tauri) se branche plus
tard en remplaçant **un seul fichier**.

```bash
npm install   # ou pnpm install
npm run dev
```

## Pile technique

React 18 · TypeScript (strict) · Vite · Tailwind CSS v4 · Framer Motion ·
Zustand · lucide-react · @tanstack/react-virtual. Aucune requête réseau réelle,
aucun élément `<audio>` dans les composants.

## Le contrat `MusicBackend`

Tout l'accès aux données passe par l'interface `MusicBackend`
(`src/services/backend.ts`), regroupée par domaine : `library`, `player`,
`queue`, `playlists`, `favorites`, `lyrics`, `artwork`, `audio`, `radio`,
`settings`, `system`. Chaque méthode `on*` renvoie une fonction de
désabonnement.

- `src/services/mockBackend.ts` — implémentation en mémoire complète :
  ~300 titres, 30 albums, 15 artistes, 8 playlists, 6 radios, paroles
  synchronisées, simulation de lecture (tick de position toutes les 250 ms,
  enchaînement automatique, respect de `shuffle`/`repeat`), flux d'analyseur
  animé et latence artificielle pour exercer les états de chargement.
- `src/services/index.ts` — **seul endroit** où le backend concret est
  référencé :

  ```ts
  export const backend: MusicBackend = mockBackend
  ```

  Pour brancher le vrai moteur : implémenter `MusicBackend` et changer cette
  ligne.

Les **composants ne touchent jamais** au backend directement ni ne stockent de
données en dur : ils lisent les stores Zustand et appellent leurs actions. Les
stores (`src/store/`) appellent `backend` et s'abonnent à ses événements.

## Structure des dossiers

```
src/
  types.ts              Types du domaine (Track, Album, PlayerState, Settings…)
  services/             Contrat backend + mock + point d'injection unique
  store/                Stores Zustand (player, library, ui, settings, playlists)
  hooks/                useKeyboardShortcuts, useDynamicColor, usePlaybackActions
  components/           Composants réutilisables (CoverArt, TrackRow, cartes,
                        WaveformSeek, Visualizer, Modal, menus, toasts…)
  features/             Un dossier par écran
    shell/              Sidebar, TopBar, PlayerBar, RightDrawer
    home/ tracks/ albums/ artists/ folders/ favorites/ playlists/
    search/ radios/ stats/ equalizer/ settings/ nowplaying/
  utils/                format, color, cn
  index.css             Tailwind v4, tokens CSS, verre, aurore, polices
  App.tsx               Coquille + routeur d'écrans + surcouches
```

## Fonctionnalités

Barre latérale repliable, barre de lecture en verre (progression waveform,
molette sur le volume, sélecteur de sortie), tiroir File d'attente / Paroles,
lecture plein écran (pochette 3D, paroles synchronisées, visualiseur), mini-
lecteur, table virtualisée 60 fps, palette de commandes (Ctrl K), menus
contextuels, glisser-déposer vers les playlists, égaliseur 10 bandes,
statistiques en SVG, thème clair/sombre, couleur dynamique extraite de la
pochette, raccourcis clavier et `prefers-reduced-motion`.

### Raccourcis

`Espace` lecture/pause · `←/→` ±5 s · `Ctrl+←/→` précédent/suivant ·
`↑/↓` volume · `M` muet · `L` j'aime · `S` aléatoire · `R` répéter ·
`F` plein écran · `/` recherche · `Ctrl+K` palette de commandes.
