# Aura — lecteur de musique (Tauri 2 + React)

- Frontend : React 19 + TS + Vite + Tailwind v4 (`src/`), généré par Figma Make puis branché sur le vrai backend.
- Backend : Rust dans `src-tauri/` — mpv (processus piloté en IPC JSON) pour l'audio, SQLite pour la bibliothèque,
  lofty pour les tags, souvlaki pour MPRIS, pw-record + FFT pour le visualiseur.
- Point d'injection unique : `src/services/index.ts` (mock si hors Tauri, `tauriBackend` sinon).
- Vérifs rapides autorisées : `npx tsc --noEmit`, `cargo check` (dans `src-tauri`). Pas de `tauri build` ni `tauri dev` : l'utilisateur lance lui-même.
