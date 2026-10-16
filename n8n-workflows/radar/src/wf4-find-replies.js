// WF-4 "Find replies & bounces" (Code node, Run Once for All Items).
// Input: recent inbox messages from Gmail (simplified: id, threadId, From, Subject, snippet).
// A message in a thread we started is a reply (auto-replies / out-of-office are ignored);
// a mailer-daemon message naming a lead's address is a bounce.
// Output: one item per lead { lead_id, kind: 'replied' | 'bounced', replied_at }.

const messages = $('Gmail: recent inbox').all().map(i => i.json).filter(m => m && m.threadId)
const threadToLead = new Map()
for (const h of $('Sent threads').all().map(i => i.json)) if (h && h.thread_id && h.lead_id) threadToLead.set(h.thread_id, h.lead_id)
const contacted = $('Contacted leads').all().map(i => i.json).filter(l => l && l.id && l.email)

const AUTO = /(automatic reply|auto[- ]?reply|out of (the )?office|ooo\b|on vacation|away from the office|autoresponder)/i
const BOUNCE_FROM = /(mailer-daemon|postmaster|mail delivery (subsystem|system))/i

const found = new Map()
for (const m of messages) {
  const from = String(m.From || m.from || '')
  const text = `${m.Subject || m.subject || ''} ${m.snippet || ''}`
  if (BOUNCE_FROM.test(from)) {
    const lead = (threadToLead.has(m.threadId) && contacted.find(l => l.id === threadToLead.get(m.threadId))) ||
      contacted.find(l => text.toLowerCase().includes(l.email.toLowerCase()))
    if (lead && !found.has(lead.id)) found.set(lead.id, { lead_id: lead.id, kind: 'bounced' })
    continue
  }
  const leadId = threadToLead.get(m.threadId)
  // Only leads still marked contacted, so a reply is counted once, not on every run.
  if (!leadId || AUTO.test(text) || !contacted.some(l => l.id === leadId)) continue
  const at = m.internalDate ? new Date(Number(m.internalDate)).toISOString() : new Date().toISOString()
  found.set(leadId, { lead_id: leadId, kind: 'replied', replied_at: at })
}

return [...found.values()].map(json => ({ json }))
