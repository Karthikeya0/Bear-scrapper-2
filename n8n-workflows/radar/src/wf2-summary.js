// WF-2 "Run summary" (Code node, Run Once for All Items).
// One workflow_logs row per run: how many raw leads were checked and how many qualified.

const cfg = $('Config').first().json
const checked = $input.all().map(i => i.json).filter(l => l && l.id)
const qualified = checked.filter(l => l.qualified).length
const failures = checked.filter(l => /^check_failed/.test(l.disqualify_reason || '')).map(l => ({ lead: l.id, message: l.disqualify_reason }))

return [{
  json: {
    workflow_name: 'WF-2-Processor',
    status: 'success',
    leads_scraped: 0,
    leads_skipped: checked.length - qualified,
    leads_scored: qualified,
    emails_sent: 0,
    replies_detected: 0,
    // Only real failures go in `errors` (the dashboard flags any run with errors).
    errors: failures.length ? failures : null,
    started_at: cfg.started_at,
    finished_at: new Date().toISOString(),
  },
}]
