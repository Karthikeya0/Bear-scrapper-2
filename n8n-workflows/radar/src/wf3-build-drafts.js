// WF-3 "Build drafts" (Code node, Run Once for All Items).
// Input: one Groq response per planned draft, in the same order as "Plan drafts".
// Output: ONE item { rows: [...outreach_queue rows], drafted, failed: [...] }.

// The model is asked for JSON only; take the first {...} block in case it adds any text around it.
const parseJson = text => {
  const raw = String(text || '').trim()
  const block = raw.match(/\{[\s\S]*\}/)
  return JSON.parse(block ? block[0] : raw)
}
// n8n reports API errors as '400 - {"error":{"message":"..."}}'; keep the readable part.
const errorText = err => {
  const text = String((err && err.message) || err || 'unknown error')
  return (text.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/) || [])[1] || text
}

const cfg = $('Config').first().json
const plan = $('Plan drafts').all().map(i => i.json)

// One fixed, professional ending for every email (the model is told not to write its own).
const SIGNATURE = [cfg.sign_off || 'Cheers,', cfg.sender_name || 'Karthikeya Popuri', cfg.company_name || 'Bear Studios', cfg.website || 'bearstudios.in']
  .filter(Boolean)
  .join('\n')
const ATTACH_LINE = "I've attached a one-pager on how we work."
const SIGN_OFF = /^(best|cheers|thanks|thank you|regards|warm regards|kind regards|best regards|sincerely|talk soon)[,.!]?$/i

// Drop any sign-off the model added anyway, so the signature never appears twice.
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

const finishEmail = (body, kind) => {
  let text = stripSignOff(body)
  if (kind === 'first') {
    text = text.replace(/\n*I['’]ve attached a one-pager on how we work\.?\s*$/i, '')
    text = `${text.trimEnd()}\n\n${ATTACH_LINE}`
  }
  return `${text}\n\n${SIGNATURE}`
}
const rows = []
const failed = []

$input.all().forEach((item, i) => {
  const p = plan[i]
  if (!p) return
  const res = item.json || {}
  try {
    const out = parseJson(res.choices[0].message.content)
    let subject = String(out.subject || '').replace(/\s+/g, ' ').trim().slice(0, 120)
    let body = String(out.body || '').replace(/\r\n/g, '\n').trim()
    // Follow-ups go out as replies in the original Gmail thread, so keep the original subject.
    if (p.kind === 'followup') subject = p.fallback_subject
    if (!subject || body.length < 40) throw new Error('empty subject or body')
    if (p.channel === 'email') body = finishEmail(body, p.kind)
    rows.push({ lead_id: p.lead_id, subject, body, status: 'pending_review', sequence_step: p.sequence_step, channel: p.channel })
  } catch (e) {
    const reason = res.error ? errorText(res.error) : String(e.message || e)
    failed.push({ lead: p.lead_id, kind: p.kind, message: `Draft failed: ${reason.slice(0, 200)}` })
  }
})

return [{ json: { rows, drafted: rows.length, failed } }]
