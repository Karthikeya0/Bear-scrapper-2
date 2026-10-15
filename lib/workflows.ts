// Client-safe workflow metadata. Webhook paths live server-side in lib/n8n.ts.

export const WORKFLOWS = [
  { key: 'WF-1-Scraper', label: 'Scrape leads', description: 'Bear Radar: new launches from Hacker News, Product Hunt, BetaList and YC into raw_leads.' },
  { key: 'WF-2-Processor', label: 'Score & enrich', description: 'Keep small, new teams with a buying signal, find the founder email and score with Groq.' },
  { key: 'WF-3-Outreach', label: 'Draft outreach', description: 'Write personalised emails for qualified leads and queue them for review.' },
  { key: 'WF-4-ReplyMonitor', label: 'Check replies', description: 'Scan Gmail threads and mark leads that replied.' },
  { key: 'WF-5-Feedback', label: 'Feedback loop', description: 'Export outcomes as few-shot examples for future prompts.' },
] as const

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
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
