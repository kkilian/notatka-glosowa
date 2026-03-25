#!/bin/bash
set -e

APP_NAME="Notatka Głosowa"
REPO="https://github.com/kkilian/notatka-glosowa.git"
TMPDIR_BUILD=$(mktemp -d)

echo "==> Klonowanie repozytorium..."
git clone "$REPO" "$TMPDIR_BUILD/notatka-glosowa"
cd "$TMPDIR_BUILD/notatka-glosowa"

echo "==> Instalacja zależności..."
npm install

echo "==> Budowanie aplikacji..."
npx electron-builder --mac

# Find the built .app (arm64 or x64)
APP_PATH=""
for dir in dist/mac-arm64 dist/mac-x64 dist/mac; do
  if [ -d "$dir/$APP_NAME.app" ]; then
    APP_PATH="$dir/$APP_NAME.app"
    break
  fi
done

if [ -z "$APP_PATH" ]; then
  echo "Błąd: nie znaleziono zbudowanej aplikacji"
  exit 1
fi

echo "==> Instalacja do /Applications..."
rm -rf "/Applications/$APP_NAME.app"
cp -r "$APP_PATH" "/Applications/$APP_NAME.app"

# Add to Dock (only if not already there)
if ! defaults read com.apple.dock persistent-apps 2>/dev/null | grep -q "Notatka"; then
  echo "==> Dodawanie do Docka..."
  defaults write com.apple.dock persistent-apps -array-add \
    "<dict><key>tile-data</key><dict><key>file-data</key><dict><key>_CFURLString</key><string>/Applications/$APP_NAME.app</string><key>_CFURLStringType</key><integer>0</integer></dict></dict></dict>"
  killall Dock
fi

# Cleanup
rm -rf "$TMPDIR_BUILD"

echo "==> Uruchamianie..."
open "/Applications/$APP_NAME.app"

echo ""
echo "Gotowe! $APP_NAME zainstalowana."
echo "Wklej swój klucz API OpenAI przy pierwszym uruchomieniu."
