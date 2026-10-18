# Run Bear Radar 24/7 on Oracle Cloud (free)

This moves **n8n** (all the workflows) from your Mac to an always-on server, so scraping, drafting, the daily email
and sending keep running when your laptop is closed. Your workflows, credentials and history come with it.
The dashboard can stay on your Mac. It only needs to know the new n8n address.

What you end up with:

- n8n at `https://n8n.bearstudios.in` (or a free `…sslip.io` address), with HTTPS that renews itself
- It restarts by itself after a crash or a reboot
- A backup every night at 03:30, with the last 14 kept
- Cost: ₹0 on Oracle's Always Free tier (an Ampere ARM server, up to 4 CPUs and 24 GB RAM)

Takes about 30–40 minutes the first time.

---

## 1. Create the server (Oracle website, about 10 min)

1. Sign up at **cloud.oracle.com**. A card is needed to verify you; Always Free resources are not charged.
   Pick your **home region** carefully, because it can't be changed later. **Mumbai** or **Hyderabad** are closest to you.
2. **Menu → Compute → Instances → Create instance**:
   - **Image:** Canonical **Ubuntu 24.04**.
   - **Shape:** Change shape → **Ampere → VM.Standard.A1.Flex**, **2 OCPUs, 12 GB memory**. That's plenty, and inside the free limit.
   - **Networking:** create a new virtual cloud network with a **public subnet**. Keep **Assign a public IPv4 address** on.
   - **SSH keys:** **Save private key**. Keep this file safe, because it's the only way in.
   - Click **Create**. If it says *Out of capacity*, try another availability domain, try 1 OCPU / 6 GB, or try again later.
     This is common on the free tier.
3. Copy the instance's **Public IP address** from its page.
4. **Open the web ports:** on the instance page, click the **Subnet** → its **Default Security List** → **Add Ingress Rules**:
   - Source CIDR `0.0.0.0/0`, IP protocol **TCP**, destination port **80**
   - Same again for port **443**

   SSH (22) is already open. The setup script also opens 80/443 inside the server's own firewall.

> **Important: idle reclaim.** Oracle may reclaim Always Free servers that stay almost idle for 7 days, and n8n is
> mostly idle. To prevent that, upgrade the account to **Pay As You Go**
> (Billing → Upgrade). You still pay nothing while you stay inside the free limits. Either way, the nightly backups
> mean nothing is lost.

## 2. Pick the address (2 min)

- **Recommended:** add a DNS **A record** at the company that manages bearstudios.in's DNS (where you bought the domain):
  name `n8n`, value = the server's public IP. Your address becomes `n8n.bearstudios.in`.
- **No DNS change:** use `<IP with dashes>.sslip.io`. For example, IP `140.238.10.20` becomes `140-238-10-20.sslip.io`.

## 3. Copy the setup files to the server (from your Mac, 2 min)

```bash
cd ~/Bear-scrapper-2 && git pull
chmod 600 ~/Downloads/ssh-key-*.key            # the private key you saved
scp -i ~/Downloads/ssh-key-*.key -r deploy/oracle ubuntu@SERVER_IP:~/bear-radar
```

## 4. Bring your n8n data from the Mac (5 min)

This keeps every workflow, credential and setting exactly as it is now.

1. In n8n on your Mac, check the version under **Help → About n8n**. If it's **newer than 2.43.6**, put that version in
   the server's `.env` later (`N8N_VERSION=…`).
2. **Stop n8n on your Mac** first. It must not run in two places, or every email goes out twice.
   - **Docker Desktop:** in Terminal, run `docker ps` to find the n8n container name (often `n8n`), then:
     ```bash
     docker stop n8n
     docker update --restart=no n8n                       # don't start again with Docker
     docker inspect n8n --format '{{range .Mounts}}{{.Name}}{{.Source}} -> {{.Destination}}{{"\n"}}{{end}}'
     ```
     The line ending in `-> /home/node/.n8n` is your data. If it's a **named volume** (e.g. `n8n_data`):
     ```bash
     docker run --rm -v n8n_data:/data -v "$PWD":/out alpine tar czf /out/n8n-data.tgz -C /data .
     ```
     If it's a **folder** (e.g. `/Users/you/.n8n`): `tar czf n8n-data.tgz -C /Users/you/.n8n .`
   - **Installed with npm / npx:** stop it (Ctrl+C), then `tar czf n8n-data.tgz -C ~/.n8n .`
3. Send it to the server:
   ```bash
   scp -i ~/Downloads/ssh-key-*.key n8n-data.tgz ubuntu@SERVER_IP:~/bear-radar/
   ```

Starting fresh instead? Skip this step. After setup, import the workflow JSON files and create the credentials again
(see `n8n-workflows/BEAR-RADAR-SETUP.md`).

## 5. Run the setup (on the server, 5 min)

```bash
ssh -i ~/Downloads/ssh-key-*.key ubuntu@SERVER_IP
cd ~/bear-radar && ./setup.sh
```

It asks for the address from step 2, then:

- installs Docker
- opens the firewall
- restores your data and reuses its encryption key, so your saved credentials still work
- starts n8n behind HTTPS
- schedules the nightly backup

When it says **Done**, open `https://YOUR-ADDRESS` and sign in with your usual n8n login.

## 6. Reconnect the three things that know the old address (5 min)

1. **Gmail:** Google Cloud Console → **APIs & Services → Credentials** → your OAuth client → **Authorized redirect URIs**
   → add `https://YOUR-ADDRESS/rest/oauth2-credential/callback` → **Save**. Then in n8n → **Credentials → Gmail** →
   **Reconnect / Sign in with Google**.
2. **Dashboard:** in `~/Bear-scrapper-2/.env.local` set `N8N_BASE_URL=https://YOUR-ADDRESS`. Leave `N8N_WEBHOOK_SECRET`
   as it is. Restart `npm run dev`, then open **Settings → Connections → Re-check**: every webhook should say **Ready**.
3. **Check the workflows are published:** in n8n, open each workflow and make sure it's **Published / Active**.

Test it: in the dashboard, click **Draft new emails**, then **Settings → Send me today's email now**.

---

## Everyday commands (on the server, in `~/bear-radar`)

| What | Command |
|---|---|
| Is it running? | `docker compose ps` |
| Live logs | `docker compose logs -f n8n` |
| Restart | `docker compose restart n8n` |
| Back up now | `./backup.sh` (files in `backups/`) |
| Update n8n | set `N8N_VERSION=…` in `.env`, then `./update.sh` (takes a backup first) |
| Restore a backup | `docker compose down && sudo rm -rf data/n8n && sudo tar xzf backups/n8n-DATE.tgz -C data && docker compose up -d` |

Copy a backup to your Mac now and then: `scp -i KEY ubuntu@SERVER_IP:~/bear-radar/backups/n8n-*.tgz .`

## What's in this folder

| File | Purpose |
|---|---|
| `docker-compose.yml` | n8n plus Caddy (HTTPS); restarts automatically; keeps 14 days of execution history |
| `Caddyfile` | HTTPS for your address, with automatic Let's Encrypt certificates |
| `.env.example` | Settings; `setup.sh` turns it into `.env` (private, never committed) |
| `setup.sh` | First-time setup; safe to run again |
| `backup.sh` | Nightly backup (n8n pauses for a few seconds) |
| `update.sh` | Back up, then update n8n |

Security: the server only accepts SSH (with your key), 80 and 443. n8n needs its own login. Dashboard webhooks need the
`X-Webhook-Secret`, and calls without it are refused (403). Secrets live only in `.env` and in n8n's encrypted credentials.
