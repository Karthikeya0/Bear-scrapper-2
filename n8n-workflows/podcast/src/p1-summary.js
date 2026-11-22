// WF-P1 "Run summary" (Code node, Run Once for All Items). One workflow_logs row per run.
const cfg = $('Config').first().json
const c = $('Collect channels').first().json
// The insert returns only channels that were new (ones already in podcast_leads are skipped by the database).
const inserted = $input.all().filter(i => i.json && i.json.id).length
const failed = c.failed || []
return [{
  json: {
    workflow_name: 'WF-P1-PodcastFind',
    status: c.searched === 0 && failed.length ? 'failed' : 'success',
    leads_scraped: inserted,
    leads_skipped: Math.max(0, (c.rows || []).length - inserted),
    leads_scored: 0,
    emails_sent: 0,
    replies_detected: 0,
    errors: failed.length ? failed : null,
    started_at: cfg.started_at,
    finished_at: new Date().toISOString(),
  },
}]
