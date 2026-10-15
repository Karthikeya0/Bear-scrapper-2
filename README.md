# Bear Studios — Lead Generation System

A full-stack lead generation and outreach management system for Bear Studios.

---

## Architecture

```
Oracle Cloud (self-hosted n8n)
  └─ WF-1: Scraper (Reddit, Product Hunt, YC)  → Supabase raw_leads
  └─ WF-2: Processor (Hunter.io enrich + Groq score) → Supabase leads
  └─ WF-3: Outreach Generator (Groq personalize) → Supabase outreach_queue
  └─ WF-3b: Send Approved (Gmail API) → on webhook from dashboard
  └─ WF-4: Reply Monitor (Gmail polling) → status updates
  └─ WF-5: Feedback Loop (weekly) → prompt_examples

Supabase (database + auth + edge functions)
  └─ 10 tables with RLS
  └─ check-lead-exists edge function (dedup)

Vercel (Next.js 14 dashboard)
  └─ Magic link login
  └─ Leads table + detail view
  └─ Outreach approval queue
  └─ Run history + manual triggers
  └─ Settings editor
```

---

## Setup Guide

### Step 0 — Prerequisites (DO THESE BEFORE ANYTHING ELSE)

- [ ] Verify SPF/DKIM/DMARC on your sending domain at [mxtoolbox.com/SuperTool.aspx](https://mxtoolbox.com/SuperTool.aspx)
- [ ] Register a Reddit app at [reddit.com/prefs/apps](https://www.reddit.com/prefs/apps)
- [ ] Get a Product Hunt API token at [api.producthunt.com](https://api.producthunt.com)
- [ ] Enable Gmail API in Google Cloud Console + create OAuth2 credentials
- [ ] Sign up for Hunter.io (free: 25 lookups/month)
- [ ] Get your Groq API key at [console.groq.com](https://console.groq.com)

---

### Step 1 — Supabase Setup

1. Open your Supabase project → **SQL Editor**
2. Paste the entire contents of `../supabase/schema.sql` and click **Run**
3. Deploy the Edge Function:
   ```bash
   cd ../supabase
   npx supabase functions deploy check-lead-exists --project-ref YOUR_PROJECT_REF
   ```
4. In Supabase → **Authentication → URL Configuration**:
   - Add your Vercel URL to **Site URL**: `https://bear-dashboard.vercel.app`
   - Add to **Redirect URLs**: `https://bear-dashboard.vercel.app/auth/callback`
5. In Supabase → **Authentication → Email Templates**: keep defaults (magic link email)

---

### Step 2 — Deploy Dashboard to Vercel

```bash
# Install Vercel CLI
npm install -g vercel

# From the dashboard directory:
cd dashboard

# Deploy (follow prompts — link to new project)
vercel

# Set environment variables:
vercel env add NEXT_PUBLIC_SUPABASE_URL
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY
vercel env add SUPABASE_SERVICE_ROLE_KEY
vercel env add N8N_BASE_URL          # e.g. http://YOUR_ORACLE_IP:5678
vercel env add N8N_WEBHOOK_SECRET    # any random string you choose

# Deploy to production:
vercel --prod
```

You'll get a URL like `https://bear-studios-dashboard.vercel.app`. Visit it and sign in with your email.

---

### Step 3 — Import n8n Workflows

For each file in `../n8n-workflows/`:

1. Open your n8n canvas
2. Click **⋮ (menu) → Import from file**
3. Select the JSON file
4. After import, connect credentials:
   - Reddit OAuth2
   - Gmail OAuth2
   - Supabase (API key + URL)
   - Generic HTTP Auth for Groq (`Authorization: Bearer YOUR_GROQ_KEY`)
   - Generic HTTP Auth for Hunter.io
5. Set environment variables in n8n:
   - `SUPABASE_URL` = your Supabase URL
   - `SUPABASE_SERVICE_ROLE_KEY` = your service role key
   - `GROQ_API_KEY` = your Groq key
   - `HUNTER_API_KEY` = your Hunter.io key
   - `N8N_WEBHOOK_SECRET` = same secret as in Vercel
6. Activate each workflow in order: WF-1 → WF-2 → WF-3b → WF-4 → WF-5

> **Note**: WF-3 (outreach generator) is triggered manually from the dashboard. WF-3b runs on webhook.

---

### Step 4 — Connect n8n Webhooks to Dashboard

The WF-3b workflow uses the webhook path `approve-and-send`. In your n8n, the webhook URL will be:
```
http://YOUR_ORACLE_IP:5678/webhook/approve-and-send
```

Set `N8N_BASE_URL=http://YOUR_ORACLE_IP:5678` in Vercel so the dashboard can reach it.

> If your Oracle Cloud IP is not publicly accessible, open port 5678 in your OCI Security List for your Vercel IP ranges, or use a Cloudflare Tunnel for secure exposure.

---

### Step 5 — First Run Test

1. Go to dashboard → **Runs** → click **⚡ Run Scraper**
2. Wait ~2 minutes, then click **⚡ Run Processor**
3. Check **Leads** — you should see scored leads appear
4. Click **⚡ Generate Outreach** → leads should appear in **Outreach Queue**
5. Review an email → edit if needed → **✓ Approve & Send**
6. Reply to yourself from another email → within 30 min, lead status flips to **replied**

---

## Environment Variables Reference

| Variable | Where | Description |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel | Supabase anon key (safe to expose) |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel (server-only) | Service role key for admin ops |
| `N8N_BASE_URL` | Vercel | URL to your n8n instance |
| `N8N_WEBHOOK_SECRET` | Vercel + n8n | Shared secret for webhook auth |
| `SUPABASE_URL` | n8n | Same as above |
| `SUPABASE_SERVICE_ROLE_KEY` | n8n | Same as above |
| `GROQ_API_KEY` | n8n | Groq API key |
| `HUNTER_API_KEY` | n8n | Hunter.io API key |

---

## Sending Limits (Default)

- 20 emails/day max
- 2 emails/hour max
- 5-minute minimum gap
- Send window: 9am–5pm weekdays only
- 4-touch sequence: Day 0, 7, 14, 21

Change these in **Settings → Sending Limits** from the dashboard.

---

## Feedback Loop

Every Sunday at 8pm, WF-5 exports outcome data (converted/replied/dead/bounced leads) into the `prompt_examples` table. These get injected as few-shot examples into future Groq prompts. Review the **Settings → Email Templates** view to see current prompts and adjust.
