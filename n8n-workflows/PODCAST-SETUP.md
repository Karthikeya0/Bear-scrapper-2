# Podcast outreach — setup (≈20 minutes)

Podcast outreach follows the **Bear Studios Podcast Lead Research SOP**. It is a separate pipeline next to Bear Radar (startups):
its own tables (`podcast_leads`, `podcast_outreach`) and its own workflows. **WF-1 … WF-6 are not changed and do not need re-importing.**

**Daily email limits:** 10 startup emails + 10 podcast emails = **20 a day in total**.
- Startups: the existing `daily_max` setting, now 10. Migration 007 lowers it, and the dashboard's "Approve & send" respects it too.
- Podcasts: their own limit of 10, set on the **Podcasts → Settings** page. WF-P3b enforces it for every send, including dashboard sends.

| Workflow | Runs | What it does |
|---|---|---|
| `WFP1-podcast-find.json` | every 12 h, or **Find podcasts** | Searches YouTube with the SOP queries (`[niche] podcast episode`, `… full episode 2026`, `… ep 12`, …) across the 18 niches, for long videos uploaded this month. Each new channel is saved as *found*. |
| `WFP2-podcast-qualify.json` | hourly, or **Check now** | Runs the SOP checks on 40 channels per run: 1k–25k subscribers, 2+ episodes in 30 days, 30+ min episodes, Shorts tab None / Poor / Good, no upload in 60 days, network-owned, English, talking-head format. It pulls Instagram, email and the host's other channel from the descriptions and picks a recent full episode as the sample. Fail 2+ checks and the show is skipped. Unsure shows are kept with "Unsure" in Why a fit. |
| `WFP3-podcast-draft.json` | every 3 h, or **Draft now** | Writes first emails (shows with an email), follow-ups (4 and 7 days later) and Instagram DMs (shows without an email). New drafts appear under Podcast outreach → Needs review. |
| `WFP3b-podcast-send.json` | every 10 min, plus **Approve & send** | Sends approved podcast emails from Gmail, at most **10 a day**, inside your send window. Follow-ups go as replies in the same thread. |
| `WFP4-podcast-replies.json` | every 30 min | Replies set the show to **Replied** and cancel its follow-ups. Bounced emails set it to **Dead**. |
| `WFP5-podcast-sheet.json` | hourly, or **sync now** | Writes every qualified show to the **Podcast Leads** Google Sheet (columns A–N from the SOP, plus O "Niche"). If you change Status in the sheet, it is copied back. |

Instagram DMs can't be sent automatically: Instagram doesn't allow it and bans accounts that try. They're drafted for you; press Copy, paste it into Instagram, then press **I sent it**.

---

## 1. Database (1 min)
Supabase → **SQL Editor** → paste all of `supabase/migrations/007_podcasts.sql` → **Run**.
It adds the two podcast tables and the `podcast` settings row, and lowers the startup `daily_max` to 10. Nothing is deleted.

## 2. Credentials in n8n (5 min)
Keep the ones you already have (*Bear dashboard secret*, *Supabase account*, *Groq API key*, *Gmail account*). Add two:

| Name | Type | Fields |
|---|---|---|
| `YouTube API key` | **Query Auth** | Name `key`, Value = your YouTube Data API v3 key |
| `Google Sheets account` | Google Sheets OAuth2 API | Sign in with the Google account that owns the sheet |

To get a YouTube key: [console.cloud.google.com](https://console.cloud.google.com) → create a project → **APIs & Services → Library** →
"YouTube Data API v3" → **Enable** → **Credentials → Create credentials → API key**. It's free and comes with 10,000 units a day.
WF-P1 uses about 4,000 of them (20 searches × 2 runs) and WF-P2 about 200.

## 3. The Google Sheet (2 min)
1. Create a Google Sheet. Rename the first tab to exactly **Podcast Leads**.
2. Put these headers in row 1, in this order (or File → Import `n8n-workflows/podcast/podcast-leads-header.csv`):
   `Date added, Podcast name, Host name, YouTube channel URL, Instagram URL, Host YouTube / other account, Sample episode URL, Subscribers, Uploads per month, Has shorts?, Contact method, Why a fit, Status, Added by, Niche`
3. Freeze the top row and add a filter on column M (Status), as the SOP says.
4. Dashboard → **Podcasts → Settings** → paste the sheet link → **Save**.

## 4. Import the six workflows (8 min)
For each file, in this order: `WFP1-podcast-find.json`, `WFP2-podcast-qualify.json`, `WFP3-podcast-draft.json`,
`WFP3b-podcast-send.json`, `WFP4-podcast-replies.json`, `WFP5-podcast-sheet.json`:
1. n8n → **Create workflow → ⋮ → Import from File**. Use one workflow per file; never paste two into one canvas.
2. **Config** node → set `supabase_url` to `https://<project-ref>.supabase.co`.
3. Open each node that shows a ⚠️ and pick the matching credential from step 2.
4. In WF-P5, open **Read sheet** and **Write to sheet**. If n8n asks, pick the sheet from the list. The link from Settings is filled in automatically.
5. **Save → Publish**.

✅ Check: dashboard → **Settings → Integrations → Re-check** → `wfp1-podcast-find` … `wfp5-podcast-sheet` and `wfp3b-podcast-send` show **Ready**.

## 5. First run
1. Dashboard → **Podcasts → Find podcasts**. About a minute later, *Waiting for checks* fills up.
2. **Check now** (or wait for the hourly run). Shows that pass move to **Qualified**, the rest to **Skipped** with a reason.
3. Open a show to see its links. Tick "posted on Instagram in the last 30 days" once you've checked (SOP step 5: there's no API for that).
   If you find an email on its About tab, paste it in. Once you've cut the free sample short, paste its link: the status becomes **Sample made** and the next email includes the link.
4. **Podcast outreach → Draft now** → review → **Approve all**. One email goes out every 10 minutes, at most 10 a day.
   To skip the review step, set Podcasts → Settings → Sending to **Autopilot**.

The SOP says to collect 100 qualified shows across 5+ niches before outreach starts. The checklist on the Podcasts page tracks this.

To rebuild the JSON files after changing anything in `n8n-workflows/podcast/src`, run `node n8n-workflows/podcast/build.mjs`.
