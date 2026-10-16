// "Settings" (Code node, Run Once for All Items).
// Starts from this workflow's Config node, then applies what you saved on the dashboard's Settings page
// (Supabase row settings.key = 'outreach'). Anything missing or invalid keeps the Config value.
const cfg = { ...$('Config').first().json }
const row = $input.first().json || {}
const saved = row.value && typeof row.value === 'object' && !Array.isArray(row.value) ? row.value : {}
const MAP = {} // dashboard key -> Config key (filled in per workflow by build.mjs)

const num = (min, max) => v => {
  const n = Number(v)
  return v !== '' && Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : undefined
}
const bool = v => (typeof v === 'boolean' ? v : undefined)
const text = v => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : undefined)
const RULES = {
  min_score: num(0, 100),
  drafts_per_run: num(1, 50),
  daily_max: num(1, 500),
  send_window_start: num(0, 23),
  send_window_end: num(1, 24),
  send_on_weekends: bool,
  draft_dms: bool,
  // [] = no follow-ups ('0' is skipped by the planner); otherwise "4,7"
  follow_up_days: v => {
    const list = (Array.isArray(v) ? v : String(v).split(',')).map(Number).filter(n => Number.isInteger(n) && n > 0 && n <= 90)
    return list.length ? list.join(',') : '0'
  },
  timezone: v => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: String(v) })
      return String(v)
    } catch {
      return undefined
    }
  },
  sign_off: text,
  signature_name: text,
  company_name: text,
  website: text,
  from_name: text,
}

const applied = []
for (const [from, to] of Object.entries(MAP)) {
  if (saved[from] === undefined || saved[from] === null || !RULES[from]) continue
  const value = RULES[from](saved[from])
  if (value === undefined) continue
  cfg[to] = value
  applied.push(from)
}
if (cfg.send_window_start !== undefined && Number(cfg.send_window_start) >= Number(cfg.send_window_end)) {
  const base = $('Config').first().json
  cfg.send_window_start = base.send_window_start
  cfg.send_window_end = base.send_window_end
}
cfg.settings_applied = applied
return [{ json: cfg }]
