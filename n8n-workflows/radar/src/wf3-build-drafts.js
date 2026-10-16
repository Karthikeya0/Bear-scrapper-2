// WF-3 "Build drafts" (Code node, Run Once for All Items).
// Input: one Groq response per picked lead, in the same order.
// Output: ONE item { rows: [...outreach_queue rows], drafted, failed: [...] }.

const leads = $('Pick leads to draft').all().map(i => i.json)
const rows = []
const failed = []

$input.all().forEach((item, i) => {
  const lead = leads[i]
  if (!lead) return
  const res = item.json || {}
  try {
    const email = JSON.parse(res.choices[0].message.content)
    const subject = String(email.subject || '').replace(/\s+/g, ' ').trim().slice(0, 120)
    const body = String(email.body || '').replace(/\r\n/g, '\n').trim()
    if (!subject || body.length < 40) throw new Error('empty subject or body')
    rows.push({ lead_id: lead.id, subject, body, status: 'pending_review', sequence_step: 1 })
  } catch (e) {
    const reason = res.error ? String(res.error.message || res.error) : String(e.message || e)
    failed.push({ lead: lead.id, email: lead.email, message: `Draft failed: ${reason.slice(0, 200)}` })
  }
})

return [{ json: { rows, drafted: rows.length, failed } }]
