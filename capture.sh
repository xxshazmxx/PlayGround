#!/usr/bin/env bash
# Capture desktop + mobile screenshots of the exact $CAPTURE_URL into $CAPTURE_DIR.
# Exit 75 = temporary navigation/browser infra failure; exit 1 = script/rendering defect.
# Leaves the app running; capture output goes outside the source tree.
set -euo pipefail
cd "$(dirname "$0")"
/usr/bin/time -p bash -c 'test -n "${CAPTURE_URL:-}" || { echo "Set CAPTURE_URL." >&2; exit 1; }'
/usr/bin/time -p bash -c 'test -n "${CAPTURE_DIR:-}" || { echo "Set CAPTURE_DIR." >&2; exit 1; }'
/usr/bin/time -p mkdir -p "${CAPTURE_DIR}"
/usr/bin/time -p node --version
/usr/bin/time -p node capture-runner.mjs
/usr/bin/time -p test -f "${CAPTURE_DIR}/final-desktop.png"
/usr/bin/time -p test -f "${CAPTURE_DIR}/final-mobile.png"
/usr/bin/time -p ls -la "${CAPTURE_DIR}"
