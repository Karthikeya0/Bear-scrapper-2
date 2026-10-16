// WF-3 "Pick leads to draft" (Code node, Run Once for All Items).
// Input: leads returned by Supabase, each with its outreach_queue rows embedded.
// Keeps leads that have an email and have never had a draft (any status, so rejected
// drafts are not rewritten). The database query already filters most of this; this is a safety net.

const cfg = $('Config').first().json
const MAX = Number(cfg.batch_size) || 10
const seen = new Set()

const picked = $input
  .all()
  .map(i => i.json)
  .filter(l => l && l.id && l.email && !seen.has(l.email.toLowerCase()) && seen.add(l.email.toLowerCase()))
  .filter(l => !Array.isArray(l.outreach_queue) || l.outreach_queue.length === 0)
  .slice(0, MAX)

// Pull the opening line WF-2 saved ("Hook: …") out of the reasoning text.
return picked.map(l => {
  const hook = String(l.ai_reasoning || '').match(/Hook:\s*(.+)/i)?.[1]?.trim() || null
  const firstName = String(l.name || '').trim().split(/\s+/)[0] || null
  const { outreach_queue, ...lead } = l
  return { json: { ...lead, hook, first_name: firstName && /^[A-Za-z][\w'-]*$/.test(firstName) ? firstName : null } }
})
