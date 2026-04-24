#!/usr/bin/env bash
set -euo pipefail

# Auto-deploy script for Veðurstöð Turbo.
# Polls the git remote, and if new commits are present on origin/main,
# resets the working tree, installs deps, rebuilds, and restarts the server.
# Short-circuits if HEAD is already at origin/main — safe to run every minute.

REPO_DIR="${REPO_DIR:-$HOME/vedurstod-turbo}"
BRANCH="${BRANCH:-main}"
SERVICE_NAME="${SERVICE_NAME:-vedurstod-turbo.service}"

cd "$REPO_DIR"

git fetch --quiet origin "$BRANCH"

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/$BRANCH")

if [[ "$LOCAL" == "$REMOTE" ]]; then
  exit 0
fi

echo "[deploy] $LOCAL -> $REMOTE"
git reset --hard "origin/$BRANCH"

# Install only when lockfile changed vs previous HEAD. Cheap `git diff --quiet` check.
if ! git diff --quiet "$LOCAL" "$REMOTE" -- package-lock.json package.json; then
  echo "[deploy] dependencies changed — running npm ci"
  npm ci --no-audit --no-fund
else
  echo "[deploy] dependencies unchanged — skipping npm ci"
fi

echo "[deploy] building"
npm run build

echo "[deploy] restarting $SERVICE_NAME"
systemctl --user restart "$SERVICE_NAME"

echo "[deploy] done"
