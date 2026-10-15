# Bear Radar — n8n setup (≈15 minutes)

**Bear Radar** finds tiny, brand-new startups (just launched, small team, no product video) on launch sites,
finds the founder's email, and queues a personalised pitch for your approval in the dashboard.

| Workflow | Replaces | What it does |
|---|---|---|
| `WF1-lead-radar-sources.json` | WF-1 (Reddit scraper) | Every 6h or on "Scrape leads": Hacker News *Show HN*, YC (new, ≤3 people), BetaList, Product Hunt → `raw_leads` (duplicates skipped) |
| `WF2-qualify-enrich.json` | WF-2 (processor) | Hourly or on "Score & enrich": free checks first (team size, launch date, domain age, homepage video, X/LinkedIn), then Hunter (founder email) **only for qualified leads**, then Groq score → `leads` |

WF-3, WF-3b, WF-4 and WF-5 are unchanged. The old Reddit files are kept in `legacy/` for reference only.

---

## Step 1 — Database (Supabase, 1 min)
Supabase → **SQL Editor** → paste all of `supabase/migrations/004_bear_radar.sql` → **Run**.
✅ Check: it finishes without errors (it only adds columns; nothing is deleted).

## Step 2 — Turn off the old WF-1 and WF-2 (1 min)
In n8n open **WF-1: Lead Scraper** → toggle **Published/Active off** → rename it to `OLD WF-1 (Reddit)`.
Do the same for **WF-2: Lead Processor**. (Don't delete them yet; the new ones reuse their webhook paths.)

## Step 3 — Credentials (5 min; skip any you already have)
n8n → **Credentials → Add credential**. Names matter only for convenience.

| Name | Type | Fields |
|---|---|---|
| `Bear dashboard secret` | Header Auth | Name `X-Webhook-Secret`, Value = `N8N_WEBHOOK_SECRET` from your `.env.local` *(you already made this)* |
| `Supabase account` | Supabase API | Host `https://<project-ref>.supabase.co`, Service Role Secret = Supabase **secret / service_role** key *(likely already exists)* |
| `Product Hunt token` | Header Auth | Name `Authorization`, Value `Bearer <your Product Hunt developer token>` |
| `Hunter API key` | Header Auth | Name `X-API-KEY`, Value = your Hunter.io API key |
| `Groq API key` | Header Auth | Name `Authorization`, Value `Bearer <your Groq API key>` |

## Step 4 — Import the two workflows (3 min)
For each file in this folder — `WF1-lead-radar-sources.json`, then `WF2-qualify-enrich.json`:
1. n8n → **Workflows → ⋮ / Add → Import from File** → pick the file.
2. Open the **Config** node → set `supabase_url` to `https://<project-ref>.supabase.co` → close.
3. Any node with a ⚠️ warning → open it → pick the matching credential from Step 3 → close.
   - WF-1: *Dashboard: Scrape leads*, *Product Hunt: launches*, *Save new raw leads*, *Write run log*
   - WF-2: *Dashboard: Score & enrich*, *Fetch raw leads*, *Hunter: founder email*, *Groq: score lead*, *Save lead*, *Mark processed*, *Save disqualified*, *Write run log*
4. **Save**, then **Publish / Activate**.

✅ Check: dashboard → **Settings → Integrations → Re-check** → `wf1-scraper` and `wf2-processor` show **Ready**.

## Step 5 — First run (3 min)
1. Dashboard → **Workflows → Scrape leads → Run now**.
2. n8n → **Executions** → open the newest *WF-1: Lead Radar – Sources* run. Each source node runs independently:
   a red source node does **not** stop the others; its error is saved in the run log.
3. Supabase → `raw_leads` should have new rows (status `raw`).
4. Dashboard → **Score & enrich → Run now**. Then the **Leads** page fills with qualified leads
   (each with signals like `just_launched`, `no_video`, `has_x`), and `raw_leads` rows become
   `processed` or `disqualified` with a `disqualify_reason`.

If any node is red, open it, copy the error, and send it to me.

---

## Settings you can change (Config node — no code)
| Setting | Default | Meaning |
|---|---|---|
| `lookback_days` (WF-1) | 7 | How far back to look on HN / Product Hunt / BetaList |
| `yc_lookback_days` (WF-1) | 120 | Only YC companies listed this recently |
| `max_team_size` | 3 | "Small" = at most this many people (unknown team size is allowed) |
| `max_launch_age_days` / `max_domain_age_days` (WF-2) | 90 / 730 | "New" = launched within 90 days **or** domain younger than 2 years |
| `just_launched_days` (WF-2) | 30 | Counts as a "just launched" buying signal |
| `batch_size` (WF-2) | 25 | Raw leads checked per run — lower it to save Hunter credits |
| `min_score` (WF-2) | 60 | AI score needed for WF-3 to draft an email |

**Qualification rule:** small **and** new **and** a buying signal (*just launched* or *no video on homepage*).
Hunter is only called for leads that pass — check your Hunter plan's monthly quota and lower `batch_size` if needed.

## What was tested, and what to verify on your machine
Tested in a real n8n 2.43 against local stand-ins that follow each service's documented format:
both webhooks, all four sources, duplicate skipping, Product Hunt and BetaList redirects, RDAP domain age,
homepage video / X / LinkedIn detection, founder-email selection, Groq scoring, all Supabase writes
(checked against the real migrated columns), and a run where two sources fail (the rest still saves).

Could not be tested here (this environment cannot reach the live sites) — verify on first run:
- **BetaList feed URL** (`betalist_url`): if that node errors, tell me the error and I'll update the URL.
- **Product Hunt** may hide maker names for some API apps; leads still come through, team size is then "unknown".
- **YC data** comes from the community-maintained `yc-oss` API (not an official YC API).
- Follower counts are **not** used: no free source provides them reliably.

## Edit the logic
Code lives in `radar/src/*.js`. After editing, run `node n8n-workflows/radar/build.mjs` and re-import.
