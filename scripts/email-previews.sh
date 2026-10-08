#!/usr/bin/env bash
# Aperçus PNG des emails d'authentification dans chaque langue (après `node scripts/build-brand.mjs`).
# Nécessite Go (rendu html/template identique à Supabase) et Google Chrome / Chromium.
# Usage : scripts/email-previews.sh [dossier]   (défaut : ./email-previews, ignoré par git)
# Sortie : <langue>-<modèle>-desktop.png et -mobile.png (ex. fr-confirmation-desktop.png, en-recovery-mobile.png)
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="$(realpath -m "${1:-email-previews}")"
CHROME="${CHROME_PATH:-$(command -v google-chrome || command -v chromium || command -v chromium-browser)}"
mkdir -p "$OUT/html"
echo "Objets (langue, modèle, objet) :"
go run scripts/email-preview/main.go "$OUT/html" | sed 's/^/  /'
for f in "$OUT"/html/*.html; do
  n="$(basename "$f" .html)"
  for mode in desktop mobile; do
    if [ "$mode" = desktop ]; then size=720,1100; else size=390,1100; fi
    "$CHROME" --headless=new --disable-gpu --no-sandbox --hide-scrollbars --force-device-scale-factor=2 \
      --window-size="$size" --screenshot="$OUT/$n-$mode.png" "file://$f" >/dev/null 2>&1
  done
  echo "  $OUT/$n-desktop.png (+ mobile)"
done
