// WF-P4 "Find replies & bounces" (Code node, Run Once for All Items).
// A message in a thread we started with a podcast is a reply (auto-replies ignored);
// a mailer-daemon message naming a podcast's address is a bounce.
// Output: one item per podcast { podcast_id, kind: 'replied' | 'bounced', replied_at }.

const messages = $('Gmail: recent inbox').all().map(i => i.json).filter(m => m && m.threadId)
const threadTo = new Map()
for (const h of $('Sent threads').all().map(i => i.json)) if (h && h.thread_id && h.podcast_id) threadTo.set(h.thread_id, h.podcast_id)
const contacted = $('Emailed podcasts').all().map(i => i.json).filter(l => l && l.id && l.email)

const AUTO = /(automatic reply|auto[- ]?reply|out of (the )?office|ooo\b|on vacation|away from the office|autoresponder)/i
const BOUNCE_FROM = /(mailer-daemon|postmaster|mail delivery (subsystem|system))/i

const found = new Map()
for (const m of messages) {
  const from = String(m.From || m.from || '')
  const text = `${m.Subject || m.subject || ''} ${m.snippet || ''}`
  if (BOUNCE_FROM.test(from)) {
    const p = (threadTo.has(m.threadId) && contacted.find(l => l.id === threadTo.get(m.threadId))) ||
      contacted.find(l => text.toLowerCase().includes(l.email.toLowerCase()))
    if (p && !found.has(p.id)) found.set(p.id, { podcast_id: p.id, kind: 'bounced' })
    continue
  }
  const id = threadTo.get(m.threadId)
  if (!id || AUTO.test(text) || !contacted.some(l => l.id === id)) continue
  const at = m.internalDate ? new Date(Number(m.internalDate)).toISOString() : new Date().toISOString()
  found.set(id, { podcast_id: id, kind: 'replied', replied_at: at })
}

return [...found.values()].map(json => ({ json }))
