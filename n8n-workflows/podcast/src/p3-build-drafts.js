// WF-P3 "Build drafts" (Code node, Run Once for All Items).
// Input: the AI response for the current draft. Output: ONE item { rows: [...podcast_outreach rows], drafted, failed }.

const parseJson = text => {
  const raw = String(text || '').trim()
  const block = raw.match(/\{[\s\S]*\}/)
  return JSON.parse(block ? block[0] : raw)
}
const errorText = err => {
  const t = String((err && err.message) || err || 'unknown error')
  return (t.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/) || [])[1] || t
}

const cfg = $('Settings').first().json
const plan = $('Plan drafts').all().map(i => i.json)
const planFor = i => {
  try {
    return $('Plan drafts').itemMatching(i).json
  } catch {
    return plan[i]
  }
}

const SIGNATURE = [cfg.sign_off || 'Cheers,', cfg.signature_name || 'Karthikeya Popuri', cfg.company_name || 'Bear Studios', cfg.website || 'bearstudios.in']
  .filter(Boolean)
  .join('\n')
const SIGN_OFF = /^(best|cheers|thanks|thank you|regards|warm regards|kind regards|best regards|sincerely|talk soon)[,.!]?$/i
const stripSignOff = text => {
  const lines = text.split('\n')
  for (let i = Math.max(0, lines.length - 6); i < lines.length; i++) {
    if (SIGN_OFF.test(lines[i].trim())) return lines.slice(0, i).join('\n').trimEnd()
  }
  return lines
    .filter((line, i) => !(i >= lines.length - 3 && /karthikeya|bear studios|bearstudios\.in/i.test(line) && line.trim().split(/\s+/).length <= 4))
    .join('\n')
    .trimEnd()
}

// Podcast autopilot "auto": emails skip review and go straight to the send schedule (still max daily_max a day).
const AUTO = cfg.autopilot === 'auto' && cfg.paused !== true
const rows = []
const failed = []
$input.all().forEach((item, i) => {
  const p = planFor(i)
  if (!p) return
  const res = item.json || {}
  try {
    const out = parseJson(res.choices[0].message.content)
    let subject = String(out.subject || '').replace(/\s+/g, ' ').trim().slice(0, 120)
    let body = String(out.body || '').replace(/\r\n/g, '\n').trim()
    if (p.kind === 'followup') subject = p.fallback_subject
    if (!subject || body.length < 30) throw new Error('empty subject or body')
    if (p.channel === 'email') body = `${stripSignOff(body)}\n\n${SIGNATURE}`
    else body = stripSignOff(body)
    const auto = AUTO && p.channel === 'email'
    rows.push({
      podcast_id: p.podcast_id, subject, body, sequence_step: p.sequence_step, channel: p.channel,
      status: auto ? 'scheduled' : 'pending_review', approved_at: auto ? new Date().toISOString() : null,
    })
  } catch (e) {
    const reason = res.error ? errorText(res.error) : String(e.message || e)
    failed.push({ podcast: p.podcast_id, kind: p.kind, message: `Draft failed: ${reason.slice(0, 200)}` })
  }
})

return [{ json: { rows, drafted: rows.length, failed } }]
