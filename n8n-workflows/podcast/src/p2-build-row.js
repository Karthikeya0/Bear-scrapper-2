// WF-P2 "Build row" (Code node, Run Once for Each Item).
// Adds the AI's judgement (format, language, network-owned, host name, "Why a fit") to the SOP checks
// and decides qualified vs skipped. Output: { id, patch } for the podcast_leads row.

const prep = $('SOP checks').item.json
const res = $json || {}
const facts = prep.facts
const fails = [...prep.fails]

let ai = null
let aiError = null
try {
  const raw = String(res.choices[0].message.content || '')
  const block = raw.match(/\{[\s\S]*\}/)
  ai = JSON.parse(block ? block[0] : raw)
} catch {
  aiError = res.error ? String(res.error.message || res.error).slice(0, 200) : 'Could not read the AI answer'
}

const patch = { ...facts, checks_failed: fails }
let hard = null
if (ai) {
  if (ai.is_podcast === false) hard = 'Not a podcast'
  else if (ai.network_owned === true) hard = 'Owned by a network or brand'
  if (ai.english === false) fails.push('not in English')
  if (['audio-only', 'music', 'other'].includes(String(ai.format))) fails.push(`format: ${ai.format}`)
  patch.host_name = typeof ai.host_name === 'string' && ai.host_name.trim() && !/unknown/i.test(ai.host_name) ? ai.host_name.trim().slice(0, 120) : null
  patch.language = ai.english === false ? 'other' : 'English'
  patch.format = typeof ai.format === 'string' ? ai.format.slice(0, 40) : null
  patch.network_owned = ai.network_owned === true
  const score = Number(ai.score)
  patch.ai_score = Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : null
}

const contact = [facts.email ? 'Email in description' : null, facts.instagram_url ? 'IG DM (check it is open)' : 'IG not found: search by hand']
patch.contact_method = contact.filter(Boolean).join(' · ')
// Instagram activity cannot be checked automatically (no public API): someone confirms it in the dashboard.
patch.ig_verified = false
patch.checks_failed = fails

if (hard || fails.length >= 2) {
  patch.stage = 'skipped'
  patch.skip_reason = hard || `Failed ${fails.length} checks: ${fails.join('; ')}`
} else {
  patch.stage = 'qualified'
  patch.skip_reason = null
  const line = ai && typeof ai.why_fit === 'string' ? ai.why_fit.replace(/\s+/g, ' ').trim().slice(0, 200) : `${facts.uploads_30d} eps/month, ${facts.avg_minutes}-min episodes, Shorts: ${facts.has_shorts}`
  // SOP quality rule: not sure -> add it with "Unsure" in Why a fit, never leave it out silently.
  const unsure = !ai || ai.unsure === true || fails.length === 1
  patch.why_fit = (unsure ? `Unsure (${aiError || fails[0] || 'AI unsure'}): ` : '') + line
}

return { json: { id: prep.id, patch } }
