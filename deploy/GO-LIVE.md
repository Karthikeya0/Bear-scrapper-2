# Go live: always on, open it from your phone, no credit card

| Piece | Where it runs | Cost |
|---|---|---|
| **Dashboard** (this app) | **Vercel**: a link like `bear-radar.vercel.app` you can open on your phone | Free, no card |
| **n8n** (the automation) | **Hugging Face Spaces**: runs 24/7 | Free, no card |
| **n8n's storage** | Your **Supabase** database, in a separate `n8n` schema; your app's tables are untouched | Already free |
| **Keep-awake ping** | **UptimeRobot** pings n8n every 5 minutes, so the free Space never goes to sleep | Free, no card |

After this your Mac can be off. Takes about 45 minutes. Do the steps in order.

---

## Step 1: Get the Supabase connection details (3 min)

n8n stores its workflows and credentials in your Supabase database, so nothing is lost when Hugging Face restarts it.

1. Supabase → your project → **Connect** (top of the page) → **Session pooler**. This one works from Hugging Face.
2. Write down these values:
   - **host**: looks like `aws-0-ap-south-1.pooler.supabase.com`
   - **user**: looks like `postgres.abcdefghijklmnop`
   - **database**: `postgres`
   - **password**: your database password. Forgot it? Go to **Project Settings → Database → Reset database password**.
     This only affects direct database logins; the dashboard keeps working.

## Step 2: Create the n8n Space on Hugging Face (10 min)

1. Sign up at **huggingface.co** (email only, no card).
2. **New → Space**:
   - **Space name:** `bear-radar-n8n`
   - **SDK:** **Docker → Blank**
   - **Hardware:** **CPU basic (free)**
   - **Visibility:** **Public**. Your dashboard and Gmail must be able to reach it. The n8n editor still needs your
     n8n login, and the webhooks need your secret.
   - Click **Create Space**.
3. **Settings → Variables and secrets.** Add each of these with **New secret**:

   | Name | Value |
   |---|---|
   | `DB_POSTGRESDB_HOST` | host from step 1 |
   | `DB_POSTGRESDB_USER` | user from step 1 |
   | `DB_POSTGRESDB_PASSWORD` | password from step 1 |
   | `DB_POSTGRESDB_DATABASE` | `postgres` |
   | `N8N_ENCRYPTION_KEY` | a long random string. On your Mac, run `openssl rand -hex 32` in Terminal and paste the result. **Save it somewhere safe. Never change it.** |

   Then add these three with **New variable**. Your Space address is `https://YOURNAME-bear-radar-n8n.hf.space`,
   with your Hugging Face username in place of YOURNAME:

   | Name | Value |
   |---|---|
   | `N8N_HOST` | `YOURNAME-bear-radar-n8n.hf.space` |
   | `WEBHOOK_URL` | `https://YOURNAME-bear-radar-n8n.hf.space/` |
   | `N8N_EDITOR_BASE_URL` | `https://YOURNAME-bear-radar-n8n.hf.space/` |

4. **Files → Add file → Upload files**: upload `deploy/huggingface/Dockerfile` and `deploy/huggingface/README.md`
   from this repo, then **Commit**. The Space builds by itself, which takes 3–5 minutes.
5. When it says **Running**, open `https://YOURNAME-bear-radar-n8n.hf.space` and **create your n8n owner account right
   away**. Until you do, anyone who opens the link could claim it.

## Step 3: Move your workflows into it (15 min)

1. **Credentials:** in the new n8n, add the same credentials you have on your Mac:
   - **Supabase account**
   - **Groq API key**
   - **Hunter API key**
   - **Product Hunt token**
   - **Bear Scrapper Webhook Secret**: Header Auth, name `X-Webhook-Secret`, same value as before
   - **Gmail account**: first, in Google Cloud Console → **APIs & Services → Credentials** → your OAuth client →
     **Authorized redirect URIs**, add `https://YOURNAME-bear-radar-n8n.hf.space/rest/oauth2-credential/callback`
     and **Save**. Then sign in with Google inside n8n.
2. **Workflows:** import these from `n8n-workflows/`, each into its own new workflow (Create workflow → ⋮ → Import from file):
   `WF1-lead-radar-sources.json`, `WF2-qualify-enrich.json`, `WF3-draft-outreach.json`, `WF3b-send-approved.json`,
   `WF4-reply-monitor.json`, `WF6-daily-digest.json`.
3. In each workflow:
   - In the **Config** node, set `supabase_url`. In WF-6, also set `dashboard_url` to your Vercel link from step 5.
   - Pick a credential on every node marked ⚠️.
   - **Save → Publish**.
4. **Stop n8n on your Mac** (Docker Desktop → stop the n8n container, and turn off its auto-start). If both run,
   every email goes out twice.

## Step 4: Keep it awake (3 min)

Free Spaces go to sleep after 48 hours without visitors. n8n's own timers don't count as visitors, so add a free ping:

1. Sign up at **uptimerobot.com** (free, no card).
2. **New monitor** → type **HTTP(s)** → URL `https://YOURNAME-bear-radar-n8n.hf.space/healthz` → interval **5 minutes** → **Create**.

You also get an email if it ever goes down.

## Step 5: Put the dashboard online (10 min)

1. Sign up at **vercel.com** with your GitHub account (Hobby plan, no card).
2. **Add New → Project** → import **bear-scrapper-2**.
3. Before clicking Deploy, open **Environment Variables** and add these four:

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | same as in your `.env.local` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same as in your `.env.local` |
   | `N8N_BASE_URL` | `https://YOURNAME-bear-radar-n8n.hf.space` (no slash at the end) |
   | `N8N_WEBHOOK_SECRET` | same as in your `.env.local` |

4. **Deploy.** You get a link like `https://bear-scrapper-2.vercel.app`.
   - The latest work is on the branch `claude/gracious-bohr-gmcrtg`, not `main`. Either merge it into `main` (a pull
     request on GitHub), or in Vercel go to **Settings → Environments → Production → Branch Tracking** and pick that
     branch, then **Redeploy**.
5. **Let Supabase log you in at the new address:** Supabase → **Authentication → URL Configuration**:
   - **Site URL:** your Vercel link
   - **Redirect URLs:** add `https://YOUR-VERCEL-LINK/**`. Keep `http://localhost:3000/**` so local still works.
6. Open the Vercel link → **Settings → Connections → Re-check**. Every webhook should say **Ready**.

## Step 6: On your phone (1 min)

Open the Vercel link → log in with the email link → **Add to Home Screen**. On iPhone that's Safari → Share. On
Android it's the ⋮ menu in Chrome. It opens full-screen with the Bear Radar icon, straight to the Outreach queue.

---

## Good to know

- **Hugging Face restarts free Spaces now and then.** That's fine: everything lives in Supabase, and n8n comes back by itself.
- **n8n keeps only failed runs** in its history, so the free 500 MB Supabase database doesn't fill up. Successful runs
  still show in the dashboard's Workflows → Run history and Audit log.
- **Vercel's free plan is meant for non-commercial use.** A private internal dashboard is usually fine. If Vercel ever
  asks, the paid plan or Netlify's free plan are the alternatives.
- **If something stops:** check UptimeRobot first (is the Space up?), then the Space's **Logs** tab, then n8n →
  Executions for the failed run.
