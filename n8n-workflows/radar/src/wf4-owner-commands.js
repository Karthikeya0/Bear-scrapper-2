// WF-4 "Read owner commands" (Code node, Run Once for All Items).
// Turns your one-word replies to the daily digest into actions:
//   YES / SEND / APPROVE  -> schedule the drafts listed in THAT digest (never anything else)
//   STOP ALL / STOP / PAUSE -> paused = true      RESUME / START -> paused = false
// A reply only counts if it comes from the owner email, quotes a digest code ([#ABC123]) sent in the
// last 3 days, and has not been handled before (each Gmail message is acted on once).
const cfg = $('Settings').first().json
const owner = String(cfg.owner_email || '').toLowerCase()
const digests = new Map(
  $('Recent digests').all().map(i => i.json).filter(r => r && r.details && r.details.code).map(r => [r.details.code, r.details]),
)
const handled = new Set(
  $('Handled commands').all().map(i => i.json).filter(r => r && r.details).map(r => r.details.message_id),
)

const emailOf = from => (String(from || '').match(/<([^>]+)>/) || [null, from])[1].trim().toLowerCase()
const messages = $input.all().map(i => i.json).filter(m => m && m.id && !m.error)
  .sort((a, b) => Number(a.internalDate || 0) - Number(b.internalDate || 0))

const approve = new Set()
let pause = null
const audit = []
const done = []
for (const m of messages) {
  if (handled.has(m.id)) continue
  const subject = String(m.Subject || m.subject || '')
  const code = (subject.match(/\[#([A-Z0-9]{6})\]/) || [])[1]
  if (!/^re:/i.test(subject.trim()) || !code || !digests.has(code)) continue
  if (emailOf(m.From || m.from) !== owner) continue
  const word = String(m.snippet || m.text || '').trim().split(/\r?\n/)[0].toUpperCase().replace(/[^A-Z ]/g, ' ').trim()
  let command = 'unknown'
  if (/^(YES|Y|SEND|APPROVE|OK|GO)\b/.test(word)) command = 'approve'
  else if (/^(STOP ALL|STOP|PAUSE)\b/.test(word)) command = 'pause'
  else if (/^(RESUME|START|UNPAUSE)\b/.test(word)) command = 'resume'
  if (command === 'approve') {
    const ids = digests.get(code).outreach_ids || []
    ids.forEach(id => approve.add(id))
    done.push(`Scheduled ${ids.length} draft${ids.length === 1 ? '' : 's'} from digest #${code}.`)
  } else if (command === 'pause') {
    pause = true
    done.push('Paused. Nothing will be scraped, drafted or sent until you reply RESUME.')
  } else if (command === 'resume') {
    pause = false
    done.push('Resumed. Scheduled emails will go out in your send window again.')
  }
  audit.push({ actor: 'owner-email', action: 'owner_command', details: { message_id: m.id, code, command, text: word.slice(0, 40) } })
}

const saved = $('Load dashboard settings').first().json
const value = { ...(saved && saved.value && typeof saved.value === 'object' ? saved.value : {}), ...(pause === null ? {} : { paused: pause }) }
if (pause !== null) audit.push({ actor: 'owner-email', action: pause ? 'paused' : 'resumed', details: {} })
if (approve.size) audit.push({ actor: 'owner-email', action: 'approved_all', details: { outreach_ids: [...approve], count: approve.size } })

return [{
  json: {
    approve_ids: [...approve],
    pause,
    settings_value: value,
    audit,
    confirm: done.length ? done.join('\n') + '\n\n— Bear Radar' : null,
  },
}]
