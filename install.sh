#!/usr/bin/env bash
# Compile Aura en mode release et l'installe pour l'utilisateur courant :
# binaire dans ~/.local/bin, icônes hicolor, entrée dans le lanceur d'applications.
#   ./install.sh            compile + installe (ou met à jour)
#   ./install.sh --uninstall
set -euo pipefail
cd "$(dirname "$0")"

BIN="$HOME/.local/bin/aura"
APPS="$HOME/.local/share/applications"
ICONS="$HOME/.local/share/icons/hicolor"

refresh() {
  command -v update-desktop-database >/dev/null && update-desktop-database -q "$APPS" || true
  command -v gtk-update-icon-cache >/dev/null && gtk-update-icon-cache -q -t "$ICONS" 2>/dev/null || true
}

if [[ "${1:-}" == "--uninstall" ]]; then
  rm -f "$BIN" "$APPS/aura.desktop" "$ICONS"/*/apps/aura.png "$ICONS/scalable/apps/aura.svg"
  refresh
  echo "Aura désinstallé (bibliothèque et réglages conservés dans ~/.local/share et ~/.config/com.abdoul273.aura)."
  exit 0
fi

for dep in mpv pw-record cargo npm; do
  command -v "$dep" >/dev/null || { echo "Dépendance manquante : $dep" >&2; exit 1; }
done

[[ -d node_modules ]] || npm install
npx tauri build --no-bundle

install -Dm755 src-tauri/target/release/aura "$BIN"
for s in 32 64 128 256 512; do
  install -Dm644 "src-tauri/icons/${s}x${s}.png" "$ICONS/${s}x${s}/apps/aura.png"
done
install -Dm644 src-tauri/icons/icon.svg "$ICONS/scalable/apps/aura.svg"

mkdir -p "$APPS"
cat > "$APPS/aura.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Aura
GenericName=Lecteur de musique
Comment=Écouter votre bibliothèque musicale et les radios en haute fidélité
Exec=$BIN
Icon=aura
Terminal=false
Categories=AudioVideo;Audio;Player;Music;
Keywords=musique;music;audio;lecteur;player;flac;mp3;radio;paroles;
StartupWMClass=aura
StartupNotify=true
DESKTOP

refresh
echo "Aura est installé : cherchez « Aura » dans le lanceur d'applications."
