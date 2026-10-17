#!/usr/bin/env bash
# Update n8n: change N8N_VERSION in .env first (or keep it to just re-pull), then run ./update.sh
# Takes a backup before restarting.
set -euo pipefail
cd "$(dirname "$0")"
DOCKER="docker"; docker info >/dev/null 2>&1 || DOCKER="sudo docker"
./backup.sh
$DOCKER compose pull -q || echo "Could not download images right now; using copies already on this server if there are any."
$DOCKER compose up -d
echo "Updated. Running: $($DOCKER compose exec -T n8n n8n --version 2>/dev/null || echo unknown)"
