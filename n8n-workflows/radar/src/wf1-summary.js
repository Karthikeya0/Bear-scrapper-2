// WF-1 "Run summary" (Code node, Run Once for All Items).
// Builds one workflow_logs row so the run appears on the dashboard's Workflows page.

const cfg = $('Config').first().json
const norm = $('Normalize & pre-filter').first().json
// The insert returns only rows that were new (duplicates are skipped by the database).
const inserted = $input.all().filter(i => i.json && i.json.id).length
const failed = norm.failed_sources || []
const allSourcesFailed = failed.length > 0 && norm.collected === 0

return [{
  json: {
    workflow_name: 'WF-1-Scraper',
    status: allSourcesFailed ? 'failed' : 'success',
    leads_scraped: inserted,
    leads_skipped: Math.max(0, (norm.collected || 0) - inserted),
    leads_scored: 0,
    emails_sent: 0,
    replies_detected: 0,
    errors: failed.length ? failed.map(message => ({ message })) : null,
    started_at: cfg.started_at,
    finished_at: new Date().toISOString(),
  },
}]
