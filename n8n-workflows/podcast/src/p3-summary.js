// WF-P3 "Run summary" (Code node, Run Once for All Items). One workflow_logs row per run.
const cfg = $('Config').first().json
let drafted = 0
const failed = []
for (const { json } of $input.all()) {
  drafted += Number(json.drafted) || 0
  if (Array.isArray(json.failed)) failed.push(...json.failed)
}
return [{
  json: {
    workflow_name: 'WF-P3-PodcastDraft',
    status: drafted === 0 && failed.length ? 'failed' : 'success',
    leads_scraped: 0,
    leads_skipped: failed.length,
    leads_scored: drafted,
    emails_sent: 0,
    replies_detected: 0,
    errors: failed.length ? failed : null,
    started_at: cfg.started_at,
    finished_at: new Date().toISOString(),
  },
}]
