#!/usr/bin/env bash
# Installation complète d'Aura en une commande :
#   1. propose la mise à jour du système et installe les dépendances manquantes (Arch, Debian/Ubuntu, Fedora)
#   2. compile l'application en mode release
#   3. l'ajoute au lanceur d'applications (binaire, icônes, entrée .desktop)
#
#   ./install.sh               tout faire (ou mettre à jour Aura) ; demande avant de mettre à jour le système
#   ./install.sh --update      mettre à jour le système sans demander
#   ./install.sh --no-update   ne pas mettre à jour le système ni poser la question
#   ./install.sh --uninstall   retirer Aura (la bibliothèque et les réglages sont conservés)
set -euo pipefail
cd "$(dirname "$0")"

BIN="$HOME/.local/bin/aura"
APPS="$HOME/.local/share/applications"
ICONS="$HOME/.local/share/icons/hicolor"
UPDATE=ask

say() { printf '\n\033[1;35m==>\033[0m \033[1m%s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mErreur :\033[0m %s\n' "$*" >&2; exit 1; }
has() { command -v "$1" >/dev/null 2>&1; }

refresh_menus() {
  has update-desktop-database && update-desktop-database -q "$APPS" || true
  has gtk-update-icon-cache && gtk-update-icon-cache -q -t "$ICONS" 2>/dev/null || true
}

for arg in "$@"; do
  case "$arg" in
    --uninstall)
      rm -f "$BIN" "$APPS/aura.desktop" "$ICONS"/*/apps/aura.png "$ICONS/scalable/apps/aura.svg"
      refresh_menus
      echo "Aura est désinstallé (bibliothèque et réglages conservés)."
      exit 0
      ;;
    --update) UPDATE=1 ;;
    --no-update) UPDATE=0 ;;
    *) die "option inconnue : $arg" ;;
  esac
done

[[ $EUID -eq 0 ]] && die "lancez ce script en utilisateur normal (il demandera sudo quand il le faut)."

# ---------- 1. Système et dépendances ----------

# Demande (non par défaut) ; sans terminal interactif, on ne met pas à jour.
want_update() {
  [[ $UPDATE == 1 ]] && return 0
  [[ $UPDATE == 0 || ! -t 0 ]] && return 1
  local r
  read -rp $'\n\033[1;35m==>\033[0m \033[1mMettre à jour le système avant d\'installer Aura ? [o/N]\033[0m ' r
  [[ ${r,,} == o* || ${r,,} == y* ]]
}

version_ge() { [[ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -1)" == "$2" ]]; }

install_rustup() {
  say "Installation de Rust (rustup)"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
  # shellcheck disable=SC1091
  source "$HOME/.cargo/env"
}

if has pacman; then
  say "Arch Linux détecté"
  pkgs=(base-devel git curl wget file openssl webkit2gtk-4.1 gtk3 librsvg mpv pipewire nodejs npm)
  # rust et rustup sont en conflit : on garde celui qui est déjà là.
  if has rustup; then
    rustup toolchain list | grep -q . || rustup default stable
  else
    pkgs+=(rust)
  fi
  if want_update; then
    say "Mise à jour du système"
    sudo pacman -Syu || echo "Mise à jour annulée, on continue."
  fi
  mapfile -t missing < <(pacman -T "${pkgs[@]}" || true)
  if ((${#missing[@]})); then
    say "Installation des dépendances manquantes : ${missing[*]}"
    sudo pacman -S --needed "${missing[@]}" || die "installation impossible (si pacman signale des paquets introuvables, relancez avec --update)."
  else
    say "Toutes les dépendances sont déjà installées"
  fi

elif has apt-get; then
  say "Debian / Ubuntu détecté"
  pkgs=(build-essential git curl wget file pkg-config libssl-dev libdbus-1-dev
    libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev mpv pipewire-bin)
  missing=()
  for p in "${pkgs[@]}"; do dpkg -s "$p" >/dev/null 2>&1 || missing+=("$p"); done
  if want_update; then
    say "Mise à jour du système"
    sudo apt-get update && sudo apt-get upgrade -y || echo "Mise à jour annulée, on continue."
  fi
  if ((${#missing[@]})); then
    say "Installation des dépendances manquantes : ${missing[*]}"
    sudo apt-get update
    sudo apt-get install -y "${missing[@]}" || die "installation des dépendances impossible"
  else
    say "Toutes les dépendances sont déjà installées"
  fi
  if ! has node || ! version_ge "$(node -v | tr -d v)" "20.19.0"; then
    say "Installation de Node.js 22 (NodeSource)"
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs
  fi

elif has dnf; then
  say "Fedora détecté"
  pkgs=(gcc gcc-c++ make git curl wget file openssl-devel dbus-devel
    webkit2gtk4.1-devel gtk3-devel librsvg2-devel libappindicator-gtk3-devel pipewire-utils nodejs npm)
  missing=()
  for p in "${pkgs[@]}"; do rpm -q "$p" >/dev/null 2>&1 || missing+=("$p"); done
  if want_update; then
    say "Mise à jour du système"
    sudo dnf upgrade -y || echo "Mise à jour annulée, on continue."
  fi
  if ((${#missing[@]})); then
    say "Installation des dépendances manquantes : ${missing[*]}"
    sudo dnf install -y "${missing[@]}" || die "installation des dépendances impossible"
  else
    say "Toutes les dépendances sont déjà installées"
  fi
  has mpv || sudo dnf install -y mpv || die "mpv introuvable : activez RPM Fusion (https://rpmfusion.org) puis relancez."

else
  die "distribution non reconnue (pacman, apt ou dnf attendus). Installez à la main : mpv, pipewire, webkit2gtk-4.1, Rust, Node.js ≥ 20."
fi

# Rust récent (Tauri 2 demande au moins 1.77).
[[ -f "$HOME/.cargo/env" ]] && source "$HOME/.cargo/env"
if ! has cargo; then
  install_rustup
elif ! version_ge "$(rustc --version | awk '{print $2}')" "1.77.0"; then
  if has rustup; then rustup update stable; else install_rustup; fi
fi

for dep in mpv pw-record cargo node npm; do
  has "$dep" || die "dépendance toujours manquante : $dep"
done
version_ge "$(node -v | tr -d v)" "20.19.0" || die "Node.js $(node -v) est trop ancien (20.19 minimum)."

# ---------- 2. Compilation ----------

say "Installation des modules JavaScript"
npm ci --no-audit --no-fund

say "Compilation d'Aura (plusieurs minutes la première fois)"
npx tauri build --no-bundle

# ---------- 3. Installation ----------

say "Installation dans le lanceur d'applications"
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
refresh_menus

say "Aura est installé !"
echo "Cherchez « Aura » dans le lanceur d'applications. Votre musique est lue depuis votre dossier Musique (modifiable dans les réglages)."
