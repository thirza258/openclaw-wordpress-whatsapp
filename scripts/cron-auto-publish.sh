#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ -d "${HOME}/.nvm" ]; then
  NVM_NODE="$(find "${HOME}/.nvm/versions/node" -maxdepth 2 -name bin 2>/dev/null | sort -V | tail -n 1 || true)"
  if [ -n "$NVM_NODE" ]; then
    export PATH="$NVM_NODE:/usr/local/bin:/usr/bin:/bin:$PATH"
  fi
fi

cd "$REPO_DIR"

NODE_BIN="$(command -v node || echo "node")"

echo "==========================================" >> "$REPO_DIR/cron.log"
echo "[CRON] Batch Article Generation started at $(date -u '+%Y-%m-%dT%H:%M:%SZ')" >> "$REPO_DIR/cron.log"
echo "==========================================" >> "$REPO_DIR/cron.log"

if [ $# -eq 0 ]; then
  "$NODE_BIN" scripts/generate-articles.js --all >> "$REPO_DIR/cron.log" 2>&1
else
  "$NODE_BIN" scripts/generate-articles.js "$@" >> "$REPO_DIR/cron.log" 2>&1
fi

echo "[CRON] Starting Yoast SEO resave and re-index..." >> "$REPO_DIR/cron.log"
npm run resave-yoast >> "$REPO_DIR/cron.log" 2>&1 || echo "[CRON] Warning: Yoast SEO resave encountered an error" >> "$REPO_DIR/cron.log"
echo "[CRON] Yoast SEO resave completed." >> "$REPO_DIR/cron.log"

echo "[CRON] Batch Article Generation finished at $(date -u '+%Y-%m-%dT%H:%M:%SZ')" >> "$REPO_DIR/cron.log"
echo "" >> "$REPO_DIR/cron.log"
