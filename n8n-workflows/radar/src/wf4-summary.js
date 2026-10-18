// WF-4 "Run summary" (Code node, Run Once for All Items).
const cfg = $('Config').first().json
const found = $('Find replies & bounces').all().map(i => i.json).filter(f => f && f.lead_id)
const gmail = $('Gmail: recent inbox').all().map(i => i.json)
const gmailError = gmail.find(m => m && m.error)
return [{
  json: {
    workflow_name: 'WF-4-ReplyMonitor',
    status: gmailError ? 'failed' : 'success',
    replies_detected: found.filter(f => f.kind === 'replied').length,
    leads_skipped: found.filter(f => f.kind === 'bounced').length,
    errors: gmailError
      ? [{ message: `Gmail: ${String(gmailError.error.message || gmailError.error).slice(0, 200)}` }]
      : found.some(f => f.kind === 'bounced')
        ? found.filter(f => f.kind === 'bounced').map(f => ({ lead: f.lead_id, message: 'Email bounced; lead marked bounced.' }))
        : null,
    started_at: cfg.started_at,
    finished_at: new Date().toISOString(),
  },
}]
