#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

OUT="sidewire.zip"
rm -f "$OUT"

zip -r "$OUT" . \
  -x ".git/*" ".claude/*" "store/*" \
     "CLAUDE.md" "PRIVACY.md" "README.md" \
     "icons/icon.svg" \
     "package.sh" ".gitignore" \
     "$OUT"

echo
echo "Built $OUT ($(du -h "$OUT" | cut -f1))"
unzip -l "$OUT"
