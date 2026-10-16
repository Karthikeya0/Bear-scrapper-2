// WF-6 "Digest due?" (Code node, Run Once for All Items).
// Clicking "Send digest now" in the dashboard always sends. The hourly schedule sends once a day at
// digest_hour (your time zone), only when autopilot is "digest" or "auto" and an owner email is set.
const cfg = $('Settings').first().json
const manual = $('Dashboard: Send digest').isExecuted
const hour = Number(
  new Intl.DateTimeFormat('en-US', { timeZone: cfg.timezone || 'UTC', hour: 'numeric', hourCycle: 'h23' }).format(new Date()),
)
let reason = ''
if (!cfg.owner_email) reason = 'No owner email set (Settings → Autopilot).'
else if (!manual && !['digest', 'auto'].includes(cfg.autopilot_mode)) reason = 'Autopilot is manual.'
else if (!manual && hour !== Number(cfg.digest_hour ?? 9)) reason = 'Not digest time yet.'
// Start of today in your time zone, used to avoid a second digest on the same day.
const local = new Date(new Date().toLocaleString('en-US', { timeZone: cfg.timezone || 'UTC' }))
const dayStart = new Date(Date.now() - (local.getHours() * 3600 + local.getMinutes() * 60 + local.getSeconds()) * 1000)
return [{ json: { due: !reason, manual, reason, day_start: dayStart.toISOString() } }]
