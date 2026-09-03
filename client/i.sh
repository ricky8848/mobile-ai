#!/usr/bin/env bash
# mobile ai — 移动AI · one-click installer (macOS / Linux)
# MIT License — Copyright (c) 2026 ricky8848
#
# Usage:   curl -fsSL https://mai.newapi.email/i.sh | bash
# Local:   MOBILEAI_BASE=http://127.0.0.1:6420 bash i.sh   (dev/test，本地 mock 控制面)
#
# What it does — and nothing else:
#   1. checks Node.js >= 18 (prints install hint if missing)
#   2. downloads the three client files into ~/.mobileai/ (temp file + rename,
#      so a failed download never clobbers a working install)
#   3. runs the local console (opens your browser; re-running is idempotent)
# cloudflared itself is downloaded + SHA-256 verified by mobileai.mjs on first start.
set -euo pipefail

BASE="${1:-${MOBILEAI_BASE:-https://mai.newapi.email}}"
MAI_DIR="$HOME/.mobileai"

echo "[mobile ai] 移动AI · installer (base: $BASE)"

# ---- 1) Node >= 18 -----------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  echo "[mobile ai] Node.js not found. Install it first, then re-run this command:"
  echo "    macOS:   brew install node"
  echo "    Linux:   https://nodejs.org/ (v18 or newer)"
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "[mobile ai] Node.js >= 18 required (found $(node -v))."
  exit 1
fi

# ---- 2) download client files -------------------------------------------------
mkdir -p "$MAI_DIR"
for f in mobileai.mjs app.js guide.md; do
  echo "[mobile ai] downloading $f ..."
  curl -fsSL "$BASE/$f" -o "$MAI_DIR/.new-$f"
  mv "$MAI_DIR/.new-$f" "$MAI_DIR/$f"
done

# ---- 3) launch -----------------------------------------------------------------
echo "[mobile ai] starting local console (a browser window will open) ..."
exec node "$MAI_DIR/mobileai.mjs"
