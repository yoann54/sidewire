#!/usr/bin/env bash
# Resize a screenshot to exactly 1280x800 for the Chrome Web Store.
#
# Usage:
#   ./resize-screenshot.sh INPUT.png                  # → INPUT-1280x800.png (cover + center-crop)
#   ./resize-screenshot.sh INPUT.png OUT.png          # → OUT.png
#   ./resize-screenshot.sh --fit INPUT.png OUT.png    # fit + white padding (no crop)
#
# Default mode (cover) fills 1280x800 by resizing then center-cropping. Use
# --fit if you can't afford to lose any pixel on the edges.

set -euo pipefail

MODE="cover"
if [[ "${1:-}" == "--fit" ]]; then MODE="fit"; shift; fi
if [[ "${1:-}" == "--cover" ]]; then MODE="cover"; shift; fi

IN="${1:?Usage: $0 [--fit|--cover] INPUT.png [OUTPUT.png]}"
OUT="${2:-${IN%.*}-1280x800.png}"

case "$MODE" in
  cover)
    convert "$IN" -resize 1280x800^ -gravity center -extent 1280x800 "$OUT"
    ;;
  fit)
    convert "$IN" -resize 1280x800 -background white -gravity center -extent 1280x800 "$OUT"
    ;;
esac

echo "Saved: $OUT"
identify -format "  %wx%h  %b\n" "$OUT"
