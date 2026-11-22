// WF-P3b "Pick email" (Code node, Run Once for All Items).
// The podcast daily limit (default 10) is a hard cap for EVERY podcast email, including ones you send
// from the dashboard. Scheduled ("Approve all") emails also wait for the send window and weekdays.
// Output (at most one item): { outreach_id, mode: 'dashboard' | 'scheduled' | 'over_limit' }

const cfg = $('Settings').first().json
const sentToday = $('Sent today').all().filter(i => i.json && i.json.id).length
const max = Number(cfg.daily_max) || 10
const hook = $('Dashboard: Send podcast email')

if (hook.isExecuted) {
  const id = hook.first().json.body && hook.first().json.body.outreach_id
  if (!id) return []
  if (cfg.paused === true || sentToday >= max) return [{ json: { outreach_id: id, mode: 'over_limit', sent_today: sentToday, max, paused: cfg.paused === true } }]
  return [{ json: { outreach_id: id, mode: 'dashboard' } }]
}

if (cfg.paused === true) return []
const tz = cfg.timezone || 'Asia/Kolkata'
const parts = Object.fromEntries(
  new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23', weekday: 'short' })
    .formatToParts(new Date())
    .map(p => [p.type, p.value]),
)
const hour = Number(parts.hour)
const weekend = parts.weekday === 'Sat' || parts.weekday === 'Sun'
if (weekend && !(cfg.send_on_weekends === true || String(cfg.send_on_weekends) === 'true')) return []
if (hour < Number(cfg.send_window_start ?? 9) || hour >= Number(cfg.send_window_end ?? 18)) return []
if (sentToday >= max) return []

const next = $('Next scheduled').all().map(i => i.json).find(r => r && r.id)
return next ? [{ json: { outreach_id: next.id, mode: 'scheduled' } }] : []
