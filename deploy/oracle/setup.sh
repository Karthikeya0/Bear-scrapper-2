#!/usr/bin/env bash
# One-time (and safe to re-run) setup of Bear Radar's n8n on an Ubuntu server, e.g. Oracle Cloud Always Free (Ampere/ARM).
#   cd ~/bear-radar && ./setup.sh
# Installs Docker, opens ports 80/443, writes .env, restores your Mac's n8n data if n8n-data.tgz is here,
# starts n8n + Caddy (HTTPS) and schedules a nightly backup.
set -euo pipefail
cd "$(dirname "$0")"
DIR="$(pwd)"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
SUDO=""; [ "$(id -u)" -eq 0 ] || SUDO="sudo"

# ---------- Docker ----------
if ! command -v docker >/dev/null 2>&1; then
  say "Installing Docker…"
  curl -fsSL https://get.docker.com | $SUDO sh
  $SUDO usermod -aG docker "$(id -un)" || true
fi
DOCKER="docker"; docker info >/dev/null 2>&1 || DOCKER="$SUDO docker"
$DOCKER compose version >/dev/null

# ---------- Firewall ----------
# Oracle's Ubuntu images ship iptables rules that REJECT everything except SSH, even when the VCN security list allows it.
if [ "${SKIP_FIREWALL:-0}" != "1" ] && command -v iptables >/dev/null 2>&1; then
  for port in 80 443; do
    if ! $SUDO iptables -C INPUT -p tcp -m state --state NEW --dport "$port" -j ACCEPT 2>/dev/null; then
      reject_line=$($SUDO iptables -L INPUT --line-numbers -n | awk '/REJECT/ {print $1; exit}')
      $SUDO iptables -I INPUT "${reject_line:-1}" -p tcp -m state --state NEW --dport "$port" -j ACCEPT
      echo "Opened TCP $port"
    fi
  done
  if ! $SUDO iptables -C INPUT -p udp --dport 443 -j ACCEPT 2>/dev/null; then
    reject_line=$($SUDO iptables -L INPUT --line-numbers -n | awk '/REJECT/ {print $1; exit}')
    $SUDO iptables -I INPUT "${reject_line:-1}" -p udp --dport 443 -j ACCEPT
  fi
  if command -v netfilter-persistent >/dev/null 2>&1; then $SUDO netfilter-persistent save >/dev/null 2>&1 || true; fi
fi

# ---------- .env ----------
[ -f .env ] || cp .env.example .env
chmod 600 .env
getenv() { grep -E "^$1=" .env | tail -n1 | cut -d= -f2- || true; }
setenv() {
  if grep -qE "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi
}

if [ -z "$(getenv N8N_DOMAIN)" ]; then
  ip=$(curl -fsS --max-time 5 https://ifconfig.me 2>/dev/null || true)
  hint=""; [ -n "$ip" ] && hint=" (no DNS? use ${ip//./-}.sslip.io)"
  read -rp "Domain for n8n, e.g. n8n.bearstudios.in${hint}: " domain
  [ -n "$domain" ] || { echo "A domain is required."; exit 1; }
  setenv N8N_DOMAIN "$domain"
fi

# ---------- n8n data: restore from the Mac (optional) ----------
mkdir -p data/n8n data/caddy data/caddy-config
if [ -f n8n-data.tgz ] && [ -z "$(ls -A data/n8n 2>/dev/null)" ]; then
  say "Restoring your n8n data from n8n-data.tgz…"
  $SUDO tar xzf n8n-data.tgz -C data/n8n
  # The Docker volume on the Mac may hold the data in a .n8n subfolder.
  if [ -d data/n8n/.n8n ] && [ ! -f data/n8n/config ]; then $SUDO sh -c 'mv data/n8n/.n8n/* data/n8n/.n8n/.[!.]* data/n8n/ 2>/dev/null; rmdir data/n8n/.n8n' || true; fi
fi
$SUDO chown -R 1000:1000 data/n8n

# ---------- Encryption key ----------
file_key=""
if $SUDO test -f data/n8n/config; then
  file_key=$($SUDO cat data/n8n/config | grep -o '"encryptionKey"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*"\([^"]*\)"$/\1/' || true)
fi
env_key=$(getenv N8N_ENCRYPTION_KEY)
if [ -n "$file_key" ] && [ -z "$env_key" ]; then
  setenv N8N_ENCRYPTION_KEY "$file_key"; echo "Using the encryption key from your n8n data."
elif [ -n "$file_key" ] && [ "$file_key" != "$env_key" ]; then
  echo "N8N_ENCRYPTION_KEY in .env does not match the key in data/n8n/config. Fix .env (use the one from config) and re-run."; exit 1
elif [ -z "$env_key" ]; then
  setenv N8N_ENCRYPTION_KEY "$(openssl rand -hex 32)"; echo "Generated a new encryption key (fresh install)."
fi

# ---------- Start ----------
say "Starting n8n and Caddy…"
$DOCKER compose pull -q || echo "Could not download images right now; using copies already on this server if there are any."
$DOCKER compose up -d
for i in $(seq 1 60); do
  if $DOCKER compose exec -T n8n wget -qO- http://127.0.0.1:5678/healthz >/dev/null 2>&1; then break; fi
  sleep 3
  [ "$i" -eq 60 ] && { echo "n8n did not become healthy. Logs:"; $DOCKER compose logs --tail 50 n8n; exit 1; }
done

# ---------- Nightly backup ----------
if [ "${SKIP_CRON:-0}" != "1" ] && command -v crontab >/dev/null 2>&1; then
  line="30 3 * * * cd $DIR && ./backup.sh >> $DIR/backup.log 2>&1"
  (crontab -l 2>/dev/null | grep -vF "$DIR/backup.sh"; echo "$line") | crontab -
fi

domain=$(getenv N8N_DOMAIN)
say "Done. n8n is running."
cat <<MSG
  Editor:          https://$domain   (first visit: create your n8n owner login if asked)
  Webhook base:    https://$domain/webhook/...
  Dashboard .env:  N8N_BASE_URL=https://$domain
  Gmail OAuth:     add https://$domain/rest/oauth2-credential/callback as an Authorized redirect URI
  Backups:         nightly at 03:30 into $DIR/backups (last 14 kept)
MSG
