// WF-6 "Build digest" (Code node, Run Once for All Items).
// One plain-text email to the owner: the drafts waiting for approval, yesterday's results and anything broken.
// The subject carries a one-time code ([#ABC123]); WF-4 only acts on replies that quote a code it sent.
const cfg = $('Settings').first().json
const due = $('Digest due?').first().json
const rows = name => $(name).all().map(i => i.json).filter(r => r && (r.id || r.created_at))

const drafts = rows('Drafts waiting').slice(0, 25)
const scheduled = rows('Scheduled').length
const sent = rows('Sent last 24h').length
const replies = rows('Replies last 24h')
const bounced = rows('Bounced last 24h').length
const failures = rows('Failures last 24h')
const alreadySent = rows('Digest sent today?').length > 0

if (alreadySent && !due.manual) return [{ json: { send: false, reason: 'Digest already sent today.' } }]

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
let code = ''
for (let i = 0; i < 6; i++) code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]

const clip = (s, n) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}
const firstLine = body => clip(String(body || '').split('\n').filter(l => l.trim() && !/^hi\b/i.test(l.trim()))[0], 140)
const who = l => (l && (l.company || l.name)) || 'Unknown'
const window = `${cfg.send_window_start ?? 9}:00–${cfg.send_window_end ?? 18}:00`
const dash = String(cfg.dashboard_url || 'http://localhost:3000').replace(/\/+$/, '')

const lines = []
if (cfg.paused === true) lines.push('⏸ Outreach is PAUSED. Nothing is being sent. Reply RESUME to start again.', '')
if (drafts.length) {
  lines.push(`${drafts.length} email draft${drafts.length === 1 ? ' is' : 's are'} waiting for you. Reply YES to send ${drafts.length === 1 ? 'it' : 'all of them'} — they go out one every 10 minutes between ${window}, at most ${cfg.daily_max ?? 20} a day.`, '')
  drafts.forEach((d, i) => {
    const l = d.leads || {}
    lines.push(`${i + 1}. ${who(l)}${l.ai_score != null ? ` (score ${l.ai_score})` : ''} — "${clip(d.subject, 80)}"`)
    lines.push(`   ${firstLine(d.body)}`)
  })
  lines.push('')
} else {
  lines.push('No drafts are waiting today.', '')
}
if (scheduled) lines.push(`${scheduled} approved email${scheduled === 1 ? ' is' : 's are'} already scheduled to go out.`, '')
lines.push(`Last 24 hours: ${sent} sent · ${replies.length} ${replies.length === 1 ? 'reply' : 'replies'} · ${bounced} bounced`)
if (replies.length) {
  lines.push('', 'Replies to answer:')
  replies.slice(0, 10).forEach(r => lines.push(`- ${r.name || r.company || r.email}${r.company && r.name ? ` (${r.company})` : ''} — ${r.email || ''}`))
}
if (failures.length) {
  lines.push('', 'Problems:')
  failures.slice(0, 5).forEach(f => {
    const msg = Array.isArray(f.errors) && f.errors[0] && f.errors[0].message ? f.errors[0].message : 'failed'
    lines.push(`- ${f.workflow_name}: ${clip(msg, 160)}`)
  })
}
lines.push('', 'Reply with one word:')
if (drafts.length) lines.push(`  YES       send the ${drafts.length} draft${drafts.length === 1 ? '' : 's'} above`)
lines.push('  STOP ALL  pause everything (nothing is scraped, drafted or sent)')
lines.push('  RESUME    start again')
lines.push('', `Or review them one by one: ${dash}/outreach`, '', '— Bear Radar')

const subject = drafts.length
  ? `Bear Radar: ${drafts.length} draft${drafts.length === 1 ? '' : 's'} ready - reply YES to send [#${code}]`
  : `Bear Radar daily: ${sent} sent, ${replies.length} ${replies.length === 1 ? 'reply' : 'replies'} [#${code}]`

return [{
  json: {
    send: true,
    to: cfg.owner_email,
    subject,
    body: lines.join('\n'),
    audit: { actor: 'n8n:WF-6', action: 'digest_sent', details: { code, to: cfg.owner_email, outreach_ids: drafts.map(d => d.id) } },
    log: {
      workflow_name: 'WF-6-Digest', status: 'success', leads_scraped: 0, leads_skipped: 0, leads_scored: drafts.length,
      emails_sent: 0, replies_detected: replies.length, errors: null, started_at: cfg.started_at, finished_at: new Date().toISOString(),
    },
  },
}]
