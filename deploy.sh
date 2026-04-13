#!/bin/bash
set -e
echo "Pulling latest changes..."
cd /opt/vedurstod-turbo
git pull
echo "Rebuilding and restarting..."
cd /opt/traefik
docker compose build vedur
docker compose up -d vedur
echo "Done!"
