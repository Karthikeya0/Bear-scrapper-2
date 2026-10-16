// WF-3b "Can send now?" (Code node, Run Once for All Items) — scheduled path only.
// Sends at most one bulk-approved ("scheduled") email per run, only inside the send window
// (Config timezone) and while today's sent count is under daily_max. Emails approved one by
// one in the dashboard skip this and go out immediately.

const cfg = $('Settings').first().json
const tz = cfg.timezone || 'UTC'
const parts = Object.fromEntries(
  new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23', weekday: 'short' })
    .formatToParts(new Date())
    .map(p => [p.type, p.value]),
)
const hour = Number(parts.hour)
const weekend = parts.weekday === 'Sat' || parts.weekday === 'Sun'
if (weekend && !(cfg.send_on_weekends === true || String(cfg.send_on_weekends) === 'true')) return []
if (hour < Number(cfg.send_window_start ?? 9) || hour >= Number(cfg.send_window_end ?? 18)) return []

const sentToday = $('Sent today').all().filter(i => i.json && i.json.id).length
if (sentToday >= (Number(cfg.daily_max) || 20)) return []

const next = $('Next scheduled').all().map(i => i.json).find(r => r && r.id)
return next ? [{ json: { id: next.id } }] : []
