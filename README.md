# Bear Studios — Lead Generation & Studio Operations

**Bear Radar**: a signal-based lead engine that finds tiny, just-launched startups and queues personalised pitches for approval. A Next.js 16 dashboard on top of Supabase and self-hosted n8n. It covers lead scraping and AI scoring, human-approved cold outreach, and client/project operations with a client portal.

```
n8n (self-hosted)
  WF-1 Lead Radar – Sources (HN Show HN, Product Hunt, BetaList, YC) → raw_leads
  WF-2 Qualify & Enrich (small + new + signal, Hunter, Groq)        → leads
  WF-3 Outreach generator (Groq)               → outreach_queue (pending_review)
  WF-3b Send approved (webhook: approve-and-send, Gmail) → outreach_history, outreach_sequences
  WF-4 Reply monitor (Gmail polling)           → leads.status = replied
  WF-5 Feedback loop (weekly)                  → prompt_examples

Supabase  — Postgres + Auth (magic link) + RLS + Realtime + check-lead-exists edge function
Next.js   — this app (deploy on Vercel)
```

## Run locally

```bash
npm install
cp .env.example .env.local    # then fill in real values
npm run dev                   # http://localhost:3000
```

Other scripts: `npm run lint`, `npm run build`, `npm start` (serves the production build).

If the Supabase variables are missing, the app shows a "configuration required" screen. It never falls back to demo data.

## Environment variables

| Variable | Where | Exposed to browser? | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel / `.env.local` | yes (by design) | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel / `.env.local` | yes (by design, protected by RLS) | Supabase anon key |
| `N8N_BASE_URL` | Vercel / `.env.local` | **no** | e.g. `https://n8n.example.com` (no trailing `/webhook`) |
| `N8N_WEBHOOK_SECRET` | Vercel / `.env.local` **and** n8n | **no** | Sent as `X-Webhook-Secret`, checked by the n8n "Validate Secret" node |

The app does **not** need the Supabase service-role key. n8n and the edge function use it on their side.

## Database

Run these in the Supabase SQL editor, in order. Every file is safe to re-run.

1. `supabase/schema.sql`: base schema. Skip it if it's already applied.
2. `supabase/migrations/002_n8n_compat.sql`: **additive only**. Adds the columns the n8n workflows read/write (`raw_leads.status`, `leads.ai_reasoning`, `outreach_history.body_sent/thread_id`, `outreach_sequences.sent/cancelled`, …), allows the `bounced` status, enables Realtime.
3. `supabase/migrations/003_security_rls.sql`: replaces the open `using (true)` policies with role-based ones. It also fixes the recursive `user_profiles` policy and makes new sign-ups `pending` instead of `owner`. Before you run it, make sure n8n uses the **service-role** key.

4. `supabase/migrations/004_bear_radar.sql`: **additive only**. Columns for Bear Radar (website, X/LinkedIn, team size, domain age, video check, signals) and duplicate-safe inserts.

### Roles

| Role | Access |
|---|---|
| `owner` | Everything except the client portal |
| `editor` | Overview + Production board (read-only on leads) |
| `client` | `/portal/dashboard`: their own projects, deliverables, messages |
| `pending` | Nothing until an owner assigns a role (default for new sign-ups) |

Assign roles in the SQL editor:

```sql
update public.user_profiles set role = 'editor'
where id = (select id from auth.users where email = 'person@example.com');

-- Give a client portal access: set their role, then link them to a client row
update public.user_profiles set role = 'client'
where id = (select id from auth.users where email = 'client@acme.com');
update public.clients set portal_user_id = (select id from auth.users where email = 'client@acme.com')
where company = 'Acme';
```

## n8n setup

See [`n8n-workflows/BEAR-RADAR-SETUP.md`](n8n-workflows/BEAR-RADAR-SETUP.md) for the step-by-step import guide (WF-1 and WF-2 v2).

## n8n integration contract (unchanged)

Every call is `POST {N8N_BASE_URL}/webhook/<path>` with header `X-Webhook-Secret: <N8N_WEBHOOK_SECRET>`.

| Path | Called when | Body |
|---|---|---|
| `approve-and-send` | Approve & send in Outreach queue | `{ outreach_id, lead_id, approved_at }` |
| `wf1-scraper` … `wf5-feedback` | "Run now" on the Workflows page | `{ triggered_by: "dashboard", timestamp }` |

**Each of these paths must exist in n8n as a Webhook trigger node** (HTTP Method `POST`, the path above, Authentication → Header Auth with header name `X-Webhook-Secret`), in a published/active workflow. The exports in `n8n-workflows/` only contain a webhook for `approve-and-send`. WF-1–WF-5 use Schedule/Manual triggers, so add the Webhook node next to the existing trigger and connect it to the same first node(s). Settings → Integrations probes every path (a secret-less GET that does not run the workflow) and marks each one Ready / Missing in n8n / Not POST.

The approve flow sets the row to `approved` (with your edits) first. WF-3b then reads subject/body from that row. If n8n can't be reached, the row goes back to `pending_review` and the UI shows the error, so nothing is silently lost or double-sent.

Settings → Integrations shows live Supabase/n8n status. It never shows secret values.

## Deploy (Vercel)

1. Set the four environment variables above in **Project → Settings → Environment Variables**.
2. Supabase → Authentication → URL Configuration: add `https://<your-domain>/auth/callback` to Redirect URLs.
3. Deploy. `vercel.json` pins the region to `sin1`.
