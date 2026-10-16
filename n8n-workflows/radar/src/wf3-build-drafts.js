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

const plan = $('Plan drafts').all().map(i => i.json)
const rows = []
const failed = []

$input.all().forEach((item, i) => {
  const p = plan[i]
  if (!p) return
  const res = item.json || {}
  try {
    const out = parseJson(res.choices[0].message.content)
    let subject = String(out.subject || '').replace(/\s+/g, ' ').trim().slice(0, 120)
    const body = String(out.body || '').replace(/\r\n/g, '\n').trim()
    // Follow-ups go out as replies in the original Gmail thread, so keep the original subject.
    if (p.kind === 'followup') subject = p.fallback_subject
    if (!subject || body.length < 40) throw new Error('empty subject or body')
    rows.push({ lead_id: p.lead_id, subject, body, status: 'pending_review', sequence_step: p.sequence_step, channel: p.channel })
  } catch (e) {
    const reason = res.error ? errorText(res.error) : String(e.message || e)
    failed.push({ lead: p.lead_id, kind: p.kind, message: `Draft failed: ${reason.slice(0, 200)}` })
  }
})

return [{ json: { rows, drafted: rows.length, failed } }]
