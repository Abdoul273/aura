# Aura — lecteur de musique haute-fidélité

Lecteur de musique de bureau « liquid glass » pour Linux (Tauri 2 + React),
pensé pour de grandes bibliothèques locales (FLAC / MP3 / M4A / OPUS…) et
les radios internet. Interface générée avec Figma Make, moteur écrit en Rust.

## Installation

Une seule commande (Arch / EndeavourOS, Debian / Ubuntu, Fedora) : le script
met le système à jour, installe les dépendances (mpv, PipeWire, WebKitGTK,
Rust, Node.js), compile Aura et l'ajoute au lanceur d'applications.

```sh
git clone https://github.com/Abdoul273/aura.git
cd aura
./install.sh
```

- `./install.sh --no-update` : sans mise à jour complète du système.
- `./install.sh --uninstall` : retire Aura (bibliothèque et réglages conservés).
- Relancer `./install.sh` après un `git pull` met Aura à jour.

Vos données (favoris, playlists, statistiques, réglages) sont dans
`~/.local/share/com.abdoul273.aura` et `~/.config/com.abdoul273.aura` :
copiez ces deux dossiers pour les retrouver sur un autre PC.

## Développement

```sh
npm install
npm run tauri dev      # fenêtre de l'application avec rechargement à chaud
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
