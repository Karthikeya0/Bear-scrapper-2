#!/usr/bin/env bash
# Nightly backup of n8n (workflows, credentials, history). n8n is stopped for a few seconds so the
# SQLite database is copied in a consistent state. Keeps the newest 14 backups.
set -euo pipefail
cd "$(dirname "$0")"
DOCKER="docker"; docker info >/dev/null 2>&1 || DOCKER="sudo docker"
mkdir -p backups
ts=$(date +%F-%H%M)
$DOCKER compose stop n8n >/dev/null
trap '$DOCKER compose start n8n >/dev/null' EXIT
sudo -n true 2>/dev/null && TAR="sudo tar" || TAR="tar"
$TAR czf "backups/n8n-$ts.tgz" -C data n8n
echo "$(date -Is) backup written: backups/n8n-$ts.tgz"
ls -1t backups/n8n-*.tgz | tail -n +15 | xargs -r rm --
