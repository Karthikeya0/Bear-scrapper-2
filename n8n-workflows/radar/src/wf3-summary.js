// WF-3 "Run summary" (Code node, Run Once for All Items).
// One workflow_logs row per run. Drafts are counted in leads_scored (emails_sent stays 0:
// nothing is sent until you approve a draft in the dashboard).

const cfg = $('Config').first().json
// Input: every per-draft result collected by the "One at a time" loop (or the single empty plan item when
// there was nothing to draft).
const built = { drafted: 0, failed: [] }
for (const { json } of $input.all()) {
  built.drafted += Number(json.drafted) || 0
  if (Array.isArray(json.failed)) built.failed.push(...json.failed)
}

return [{
  json: {
    workflow_name: 'WF-3-Outreach',
    status: built.drafted === 0 && built.failed.length > 0 ? 'failed' : 'success',
    leads_scraped: 0,
    leads_skipped: built.failed.length,
    leads_scored: built.drafted,
    emails_sent: 0,
    replies_detected: 0,
    errors: built.failed.length ? built.failed : null,
    started_at: cfg.started_at,
    finished_at: new Date().toISOString(),
  },
}]
