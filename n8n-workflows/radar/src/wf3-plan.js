// WF-3 "Plan drafts" (Code node, Run Once for All Items).
// Reads the three Supabase lookups and decides what to write this run, newest work first:
//   1. follow-ups  – leads emailed N days ago who have not replied (step 2, then step 3)
//   2. first email – qualified leads with an email that have never had a draft
//   3. DM          – qualified leads with no email but an X or LinkedIn profile
// Output: one item per draft with the Groq prompt ready (system + user) and the row fields to save.

const cfg = $('Config').first().json
const MAX = Number(cfg.batch_size) || 10
const FOLLOW_UP_DAYS = String(cfg.follow_up_days || '4,7').split(',').map(n => Number(n.trim())).filter(n => n > 0)
const MAX_STEP = 1 + FOLLOW_UP_DAYS.length
const DAY = 86400000
const PENDING = new Set(['pending_review', 'scheduled', 'approved'])

const rows = name => $(name).all().map(i => i.json).filter(l => l && l.id)
const hookOf = l => String(l.ai_reasoning || '').match(/Hook:\s*(.+)/i)?.[1]?.trim() || null
const firstName = l => {
  const f = String(l.name || '').trim().split(/\s+/)[0] || ''
  return /^[A-Za-z][\w'-]*$/.test(f) ? f : null
}
const facts = l => [
  'Founder first name: ' + (firstName(l) || 'unknown'),
  'Founder role: ' + (l.founder_role || 'unknown'),
  'Company: ' + (l.company || '?'),
  'Website: ' + (l.website || l.company_domain || '?'),
  'Launched: ' + (l.launched_at || 'unknown') + ' (via ' + l.source + ')',
  'Homepage has a video: ' + (l.has_video === null || l.has_video === undefined ? 'unknown' : l.has_video),
  'Signals: ' + (Array.isArray(l.signals) ? l.signals.join(', ') : ''),
  'Hook: ' + (hookOf(l) || 'none'),
  'About: ' + String(l.bio || l.post_content || '').slice(0, 1200),
  'Sender name: ' + cfg.sender_name,
  'Portfolio link: ' + (cfg.portfolio_url || 'none'),
]

const SERVICE = 'Bear Studios, a small studio that makes brand launch videos, promo videos and SaaS explainer videos for startups'
const RULES = 'Never invent facts, numbers, clients or results. Mention the portfolio link only if one is given. No markdown, no emojis, no exclamation marks.'

const SYS_FIRST =
  `You write short cold emails for ${SERVICE}. Write to the founder of the company described. Plain text, 60-110 words. ` +
  'Open with the provided hook or another specific detail about what they built or launched (never "I hope this finds you well"). ' +
  'Then offer ONE fitting service: no video on their homepage -> a 60-90s explainer; just launched -> a launch/promo video for socials; otherwise whichever fits best. ' +
  `${RULES} End with a soft, low-effort question (e.g. "Worth a quick look at a few examples?"), then sign off with the sender name on its own line. ` +
  'Address the founder by first name if given, otherwise "Hi there". Subject: under 7 words, lowercase is fine, specific to them, no clickbait. ' +
  'Output ONLY JSON: {"subject": "...", "body": "..."}'

const SYS_FOLLOW =
  `You write a short follow-up to a cold email that got no reply, for ${SERVICE}. It is sent as a reply in the same thread, so do not repeat the pitch. ` +
  'Plain text, 25-60 words. Step 2: a friendly nudge that adds ONE new, concrete idea for a video they could use (based on their product). ' +
  'Step 3 (last): a polite close-the-loop note that says you will not follow up again and leaves the door open. ' +
  `${RULES} Sign off with the sender name. Output ONLY JSON: {"subject": "Re: <original subject>", "body": "..."}`

const SYS_DM =
  `You write a short direct message (X or LinkedIn) for ${SERVICE}, to the founder of the company described. Plain text, 25-60 words, casual and human. ` +
  'Mention one specific thing about what they launched, then ask if they would be open to seeing a couple of launch/explainer video examples. ' +
  `${RULES} No sign-off needed. Output ONLY JSON: {"subject": "DM to <company>", "body": "..."}`

const plan = []
const seenLead = new Set()
const seenEmail = new Set()
const add = item => {
  if (plan.length >= MAX || seenLead.has(item.lead_id)) return
  if (item.email && seenEmail.has(item.email.toLowerCase())) return
  seenLead.add(item.lead_id)
  if (item.email) seenEmail.add(item.email.toLowerCase())
  plan.push(item)
}

// 1. Follow-ups
const now = Date.now()
for (const l of rows('Fetch follow-ups')) {
  const queue = Array.isArray(l.outreach_queue) ? l.outreach_queue : []
  if (!l.email || queue.some(q => PENDING.has(q.status))) continue
  const sent = queue.filter(q => q.status === 'sent' && q.sent_at && (q.channel || 'email') === 'email')
  if (!sent.length) continue
  const last = sent.reduce((a, b) => ((b.sequence_step || 1) > (a.sequence_step || 1) ? b : a))
  const step = (last.sequence_step || 1) + 1
  if (step > MAX_STEP) continue
  const waitDays = FOLLOW_UP_DAYS[step - 2]
  if ((now - Date.parse(last.sent_at)) / DAY < waitDays) continue
  const first = sent.find(q => (q.sequence_step || 1) === 1) || last
  add({
    kind: 'followup', lead_id: l.id, email: l.email, channel: 'email', sequence_step: step,
    system: SYS_FOLLOW,
    user: [
      `This is follow-up step ${step} of ${MAX_STEP}.`,
      `Original subject: ${first.subject}`,
      `Original email:\n${String(first.body || '').slice(0, 1500)}`,
      ...facts(l),
    ].join('\n'),
    fallback_subject: /^re:/i.test(first.subject || '') ? first.subject : `Re: ${first.subject}`,
  })
}

// 2. First emails
for (const l of rows('Fetch leads to draft')) {
  if (!l.email || (Array.isArray(l.outreach_queue) && l.outreach_queue.length)) continue
  add({ kind: 'first', lead_id: l.id, email: l.email, channel: 'email', sequence_step: 1, system: SYS_FIRST, user: facts(l).join('\n') })
}

// 3. DMs for leads without an email
if (cfg.draft_dms !== false && String(cfg.draft_dms) !== 'false') {
  for (const l of rows('Fetch DM leads')) {
    if (l.email || !(l.x_handle || l.linkedin_url) || (Array.isArray(l.outreach_queue) && l.outreach_queue.length)) continue
    add({ kind: 'dm', lead_id: l.id, email: null, channel: 'dm', sequence_step: 1, system: SYS_DM, user: facts(l).join('\n') })
  }
}

return plan.map(json => ({ json }))
