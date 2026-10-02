#!/usr/bin/env bash
set -euo pipefail
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_BIN="${PYTHON_BIN:-/var/www/api_sensores/venv/bin/python}"
BRANCH="${BRANCH:-main}"
cd "$PROJECT_DIR"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "ERROR: el clon publicador tiene cambios sin commit" >&2
  exit 1
fi

git pull --ff-only origin "$BRANCH"
"$PYTHON_BIN" scripts/publish_hiripro.py
"$PYTHON_BIN" scripts/validate_export.py
git add -- data/hiripro-232.csv
if git diff --cached --quiet -- data/hiripro-232.csv; then
  echo "HiriPro 232: sin cambios de datos"
else
  git commit -m "datos: actualización HiriPro 232 $(date '+%Y-%m-%d %H:%M')" -- data/hiripro-232.csv
fi
# Reintenta también un commit local que haya quedado tras una falla de red.
git push origin "$BRANCH"
