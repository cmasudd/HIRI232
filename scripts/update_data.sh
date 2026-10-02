#!/usr/bin/env bash
set -euo pipefail
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"
git pull --ff-only
python3 scripts/publish_hiripro.py
git add -- data/hiripro-232.csv
if git diff --cached --quiet -- data/hiripro-232.csv; then
  echo "HiriPro 232: sin cambios de datos"
  exit 0
fi
git commit -m "datos: actualización HiriPro 232 $(date '+%Y-%m-%d %H:%M')" -- data/hiripro-232.csv
git push origin HEAD
