# Aura — lecteur de musique haute-fidélité

Lecteur de musique de bureau « liquid glass » pour Linux (Tauri 2 + React),
pensé pour de grandes bibliothèques locales (FLAC / MP3 / M4A / OPUS…) et
les radios internet. Interface générée avec Figma Make, moteur écrit en Rust.

## Lancer

Dépendances système (Arch) : `mpv`, `pipewire` (pour `pw-record`), `webkit2gtk-4.1`, Rust, Node.

```fish
npm install
npm run tauri dev      # application de bureau, vrai moteur audio
# (npm run dev seul ne sert à rien : le moteur tourne dans la fenêtre Tauri)
npm run tauri build    # paquets .deb / .rpm / AppImage
```

## Moteur (src-tauri)

- **Audio** : un processus `mpv` piloté par IPC JSON. Le titre suivant est
  pré-chargé pour l'enchaînement sans blanc ; égaliseur 10 bandes (filtres
  lavfi), ReplayGain, choix de la sortie (PipeWire ou ALSA direct), état
  bit-perfect calculé à partir des formats d'entrée/sortie réels.
- **Bibliothèque** : scan incrémental (mtime) des dossiers configurés, tags
  lus par `lofty`, pochettes extraites (image intégrée ou `cover.jpg`) et
  palettes de couleurs calculées en Rust ; stockage SQLite
  (`~/.local/share/com.abdoul273.aura/aura.db`).
- **Système** : MPRIS via `souvlaki` (barre Caelestia, `playerctl`, touches
  multimédia), mini-lecteur flottant et épinglé sous Hyprland.
- **Paroles** : `.lrc` à côté du fichier → tag intégré → lrclib.net (cache).
- **Visualiseur** : capture du moniteur de sortie avec `pw-record` + FFT,
  uniquement quand un visualiseur est affiché.
- La file d'attente et la position sont restaurées au démarrage.

Limite connue : le fondu enchaîné (crossfade) est enregistré dans les
paramètres mais pas encore appliqué par le moteur.

## Pile technique

React 19 · TypeScript (strict) · Vite · Tailwind CSS v4 · Framer Motion ·
Zustand · lucide-react · @tanstack/react-virtual. Aucun élément `<audio>` dans les
composants : tout le son passe par mpv.

## Le contrat `MusicBackend`

Tout l'accès aux données passe par l'interface `MusicBackend`
(`src/services/backend.ts`), regroupée par domaine : `library`, `player`,
`queue`, `playlists`, `favorites`, `lyrics`, `artwork`, `audio`, `radio`,
`settings`, `system`. Chaque méthode `on*` renvoie une fonction de
désabonnement.

- `src/services/index.ts` — **seul endroit** où le backend concret est
  référencé :

  il branche `tauriBackend` (le moteur Rust).
- `src/services/tauriBackend.ts` — implémentation réelle : appels `invoke`
  vers Rust et index de la bibliothèque en mémoire (recherche, tris et
  agrégations albums/artistes instantanés).

Les **composants ne touchent jamais** au backend directement ni ne stockent de
données en dur : ils lisent les stores Zustand et appellent leurs actions. Les
stores (`src/store/`) appellent `backend` et s'abonnent à ses événements.

## Structure des dossiers

```
src/
  types.ts              Types du domaine (Track, Album, PlayerState, Settings…)
  services/             Contrat backend + implémentation Tauri + point d'injection
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
