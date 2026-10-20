// WF-3b "Can send now?" (Code node, Run Once for All Items) — scheduled path only.
// Sends at most one email per run, only inside the send window (Config timezone) and while today's sent count
// is under daily_max. Normally that is the oldest bulk-approved ("scheduled") email. Daily minimum (Autopilot
// only): when nothing is scheduled and fewer than daily_min went out today, it sends a draft still waiting for
// review instead. Emails approved one by one in the dashboard skip this and go out immediately.

const cfg = $('Settings').first().json
// STOP ALL (dashboard banner, Settings, or an emailed "STOP ALL"): nothing scheduled goes out until resumed.
if (cfg.paused === true) return []
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
if (next) return [{ json: { id: next.id, from_status: 'scheduled' } }]

if (cfg.autopilot_mode !== 'auto' || sentToday >= (Number(cfg.daily_min) || 0)) return []
const BLOCKED = ['unsubscribed', 'bounced', 'dead', 'replied']
const review = $('Review drafts').all().map(i => i.json)
  .filter(r => r && r.id && r.leads && r.leads.email && !BLOCKED.includes(r.leads.status))
  .sort((a, b) => (Number(b.leads.ai_score) || 0) - (Number(a.leads.ai_score) || 0))
if (!review.length) return []
// Best score first, but rotate every 10 minutes so one draft Gmail keeps rejecting can't block the rest.
const pick = review[Math.floor(Date.now() / 600000) % Math.min(review.length, 3)]
return [{ json: { id: pick.id, from_status: 'pending_review' } }]
