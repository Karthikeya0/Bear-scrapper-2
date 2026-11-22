// WF-P2 "Run summary" (Code node, Run Once for All Items). Runs after every channel was checked and saved.
const cfg = $('Config').first().json
const ran = name => {
  try {
    return $(name).isExecuted ? $(name).all().map(i => i.json) : []
  } catch {
    return []
  }
}
const channelsRes = ran('YouTube: channels')[0] || {}
const early = ran('Channel checks').filter(r => r && r.ok === false)
const hard = ran('SOP checks').filter(r => r && r.hard_skip)
const built = ran('Build row').filter(r => r && r.patch)
const qualified = built.filter(r => r.patch.stage === 'qualified').length
const skipped = early.length + hard.length + built.length - qualified
const errors = []
if (channelsRes.error) errors.push({ message: `YouTube channels: ${String(channelsRes.error.message || channelsRes.error).slice(0, 200)}` })
return [{
  json: {
    workflow_name: 'WF-P2-PodcastQualify',
    status: errors.length ? 'failed' : 'success',
    leads_scraped: 0,
    leads_scored: qualified,
    leads_skipped: skipped,
    emails_sent: 0,
    replies_detected: 0,
    errors: errors.length ? errors : null,
    started_at: cfg.started_at,
    finished_at: new Date().toISOString(),
  },
}]
