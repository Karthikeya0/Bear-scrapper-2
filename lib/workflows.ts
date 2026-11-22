// Client-safe workflow metadata. Webhook paths live server-side in lib/n8n.ts.
import { markStarted } from './activity'

export const WORKFLOWS = [
  { key: 'WF-1-Scraper', label: 'Scrape leads', description: 'Bear Radar: new launches from Hacker News, Product Hunt, BetaList and YC into raw_leads.' },
  { key: 'WF-2-Processor', label: 'Score & enrich', description: 'Keep small, new teams with a buying signal, find the founder email and score with Groq.' },
  { key: 'WF-3-Outreach', label: 'Draft outreach', description: 'Write first emails, due follow-ups and X/LinkedIn DMs, and queue them for your review.' },
  { key: 'WF-4-ReplyMonitor', label: 'Check replies', description: 'Read your Gmail inbox, mark leads that replied or bounced, and stop their follow-ups.' },
  { key: 'WF-5-Feedback', label: 'Feedback loop', description: 'Export outcomes as few-shot examples for future prompts.' },
  { key: 'WF-6-Digest', label: 'Daily digest', description: 'Email you the drafts waiting for approval, yesterday’s results and any problems. Reply YES to send.' },
  { key: 'WF-P1-PodcastFind', label: 'Find podcasts', description: 'Podcasts: search YouTube across 18 niches for small shows posting full episodes this month.' },
  { key: 'WF-P2-PodcastQualify', label: 'Check podcasts', description: 'Podcasts: SOP checks (1k–25k subs, 2+ episodes in 30 days, 30+ min, no shorts habit), Instagram, email and a sample episode.' },
  { key: 'WF-P3-PodcastDraft', label: 'Draft podcast outreach', description: 'Podcasts: write first emails, follow-ups and Instagram DMs for qualified shows.' },
  { key: 'WF-P4-PodcastReplies', label: 'Check podcast replies', description: 'Podcasts: mark shows that replied or bounced and stop their follow-ups.' },
  { key: 'WF-P5-PodcastSheet', label: 'Sync podcast sheet', description: 'Podcasts: write qualified shows to the “Podcast Leads” Google Sheet and read Status changes back.' },
] as const

/** Names that appear in workflow_logs but are not started from the Workflows page. */
export const WORKFLOW_LABELS: Record<string, string> = {
  ...Object.fromEntries(WORKFLOWS.map(w => [w.key, w.label])),
  'WF-3b-SendApproved': 'Send approved',
  'WF-P3b-PodcastSend': 'Send podcast email',
}

export type WorkflowKey = (typeof WORKFLOWS)[number]['key']

export async function triggerWorkflow(workflow: WorkflowKey): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('/api/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workflow }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.ok) return { ok: false, error: data.error ?? `Request failed (HTTP ${res.status}).` }
    markStarted(workflow)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
