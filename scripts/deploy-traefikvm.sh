#!/usr/bin/env bash
set -euo pipefail

# Deploy script for traeficvm (192.168.11.10).
# Triggered by GitHub Actions on push to main via sudo.
# Pulls latest code, then force-rebuilds and recreates the Docker container.
#
# --build:           rebuild image before starting
# --force-recreate:  always recreate the container even if image hash is unchanged
#                    (avoids stale container when Docker layer cache produces same hash)

REPO_DIR="${REPO_DIR:-/opt/vedurstod-turbo}"
TRAEFIK_DIR="${TRAEFIK_DIR:-/opt/traefik}"

echo "[deploy] pulling latest"
cd "$REPO_DIR"
git pull

echo "[deploy] rebuilding and restarting container"
cd "$TRAEFIK_DIR"
docker compose up -d --build --force-recreate vedur

echo "[deploy] done"
