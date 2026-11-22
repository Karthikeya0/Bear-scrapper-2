// Podcast "Settings" (Code node, Run Once for All Items).
// Starts from this workflow's Config node, then applies the dashboard settings saved in Supabase:
//   settings.key = 'outreach' -> shared with the startup pipeline: STOP ALL, timezone, send window, signature
//   settings.key = 'podcast'  -> podcast only: daily limit (10), subscriber range, searches per run, sheet URL, …
// Anything missing or invalid keeps the Config value.
const cfg = { ...$('Config').first().json }
const rows = $input.all().map(i => i.json).filter(r => r && r.key)
const valueOf = key => {
  const r = rows.find(x => x.key === key)
  return r && r.value && typeof r.value === 'object' && !Array.isArray(r.value) ? r.value : {}
}

const num = (min, max) => v => {
  const n = Number(v)
  return v !== '' && v !== null && Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : undefined
}
const bool = v => (typeof v === 'boolean' ? v : undefined)
const text = v => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 300) : undefined)
const days = v => {
  const list = (Array.isArray(v) ? v : String(v).split(',')).map(Number).filter(n => Number.isInteger(n) && n > 0 && n <= 90)
  return list.length ? list.join(',') : '0'
}
const tz = v => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: String(v) })
    return String(v)
  } catch {
    return undefined
  }
}

// [dashboard key, Config key, rule]
const SHARED = [
  ['paused', 'paused', bool],
  ['timezone', 'timezone', tz],
  ['send_window_start', 'send_window_start', num(0, 23)],
  ['send_window_end', 'send_window_end', num(1, 24)],
  ['send_on_weekends', 'send_on_weekends', bool],
  ['from_name', 'from_name', text],
  ['sign_off', 'sign_off', text],
  ['signature_name', 'signature_name', text],
  ['company_name', 'company_name', text],
  ['website', 'website', text],
]
const PODCAST = [
  ['daily_max', 'daily_max', num(1, 50)],
  ['min_subscribers', 'min_subscribers', num(0, 10000000)],
  ['max_subscribers', 'max_subscribers', num(1, 10000000)],
  ['min_uploads_30d', 'min_uploads_30d', num(0, 60)],
  ['min_episode_minutes', 'min_episode_minutes', num(1, 600)],
  ['searches_per_run', 'searches_per_run', num(1, 90)],
  ['follow_up_days', 'follow_up_days', days],
  ['draft_dms', 'draft_dms', bool],
  ['autopilot', 'autopilot', v => (['manual', 'auto'].includes(v) ? v : undefined)],
  ['sheet_url', 'sheet_url', v => (typeof v === 'string' && v.trim() ? v.trim() : undefined)], // empty = keep Config's link
  ['added_by', 'added_by', text],
]

const applied = []
const apply = (saved, list, prefix) => {
  for (const [from, to, rule] of list) {
    if (saved[from] === undefined || saved[from] === null || !(to in cfg)) continue
    const value = rule(saved[from])
    if (value === undefined) continue
    cfg[to] = value
    applied.push(prefix + from)
  }
}
apply(valueOf('outreach'), SHARED, '')
apply(valueOf('podcast'), PODCAST, 'podcast.')

const base = $('Config').first().json
if (cfg.send_window_start !== undefined && Number(cfg.send_window_start) >= Number(cfg.send_window_end)) {
  cfg.send_window_start = base.send_window_start
  cfg.send_window_end = base.send_window_end
}
if (cfg.min_subscribers !== undefined && Number(cfg.min_subscribers) >= Number(cfg.max_subscribers)) {
  cfg.min_subscribers = base.min_subscribers
  cfg.max_subscribers = base.max_subscribers
}
cfg.settings_applied = applied
return [{ json: cfg }]
