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

# Prevent concurrent executions using non-blocking flock
LOCK_FILE="/tmp/daily-social-cron.lock"
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
  echo "[CRON] Another instance of daily-social is already running. Exiting to prevent duplicate messages." >> "$REPO_DIR/cron-daily-social.log"
  exit 0
fi

echo "==========================================" >> "$REPO_DIR/cron-daily-social.log"
echo "[CRON] Daily Social Media Post Generator started at $(date -u '+%Y-%m-%dT%H:%M:%SZ')" >> "$REPO_DIR/cron-daily-social.log"
echo "==========================================" >> "$REPO_DIR/cron-daily-social.log"

if [ $# -eq 0 ]; then
  "$NODE_BIN" scripts/daily-social-post.js --send >> "$REPO_DIR/cron-daily-social.log" 2>&1
else
  "$NODE_BIN" scripts/daily-social-post.js "$@" >> "$REPO_DIR/cron-daily-social.log" 2>&1
fi

echo "[CRON] Daily Social Media Post Generator finished at $(date -u '+%Y-%m-%dT%H:%M:%SZ')" >> "$REPO_DIR/cron-daily-social.log"
echo "" >> "$REPO_DIR/cron-daily-social.log"
