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
  // Only a real-looking name ("Maya"); handles like "klntsky" or "jdoe42" fall back to "Hi <Company> team,".
  return /^[A-Z](?=.*[a-z])[A-Za-z'-]+$/.test(f) ? f : null
}
const facts = l => [
  'Founder first name: ' + (firstName(l) || 'unknown'),
  'Founder role: ' + (l.founder_role || 'unknown'),
  'Company: ' + (l.company || '?'),
  'Website: ' + (l.website || l.company_domain || '?'),
  'Launched: ' + (l.launched_at || 'unknown') + ' (found on ' + l.source + ')',
  'Homepage has a product video: ' + (l.has_video === null || l.has_video === undefined ? 'unknown' : l.has_video ? 'yes' : 'no'),
  'Signals: ' + (Array.isArray(l.signals) ? l.signals.join(', ') : ''),
  'Hook (a specific detail about them): ' + (hookOf(l) || 'none'),
  'What they built / said: ' + String(l.bio || l.post_content || '').slice(0, 1200),
]

// What Bear Studios is, from the one-pager. The model may only use these facts about us.
const STUDIO = [
  'ABOUT US — Bear Studios (bearstudios.in): motion design and film for startups.',
  'We make two things: (1) Explainer videos — complex products explained simply, precise motion, clean UI animation and tight scripting, so investors and users get it in under 90 seconds; (2) Product launch videos / promos — smooth, cinematic, data-driven motion graphics that make a product feel inevitable.',
  'How we work: Brief, Research, Script, Storyboard, Styleframes, Production, Delivery. Two review rounds. Turnaround: explainer 7-12 days, launch video 10-14 days.',
  'Every video is delivered in 4K in 16:9 (web/YouTube), 9:16 (Reels/Shorts) and 1:1 (LinkedIn/ads). Each client gets a live ClickUp workspace for briefs, storyboards, feedback and deliverables.',
  'Our standard: obsessive craft — the details nobody notices consciously but everyone feels.',
].join('\n')

const VOICE =
  'VOICE: a founder writing to another founder. Confident, warm, specific, concise. Short sentences. Plain text only: no markdown, no bullet points, no emojis, no exclamation marks. ' +
  'Never use: "I hope this finds you well", "I came across", "I wanted to reach out", "just checking in", "touch base", "circle back", "synergy", "game-changer", "revolutionize", "leverage", "cutting-edge", "take it to the next level". ' +
  'Never invent facts, numbers, client names, results or prices. Only use facts given about them and about us. ' +
  'Do NOT write a greeting sign-off or signature (no "Best", "Cheers", name or company at the end) — it is added automatically.'

const SYS_FIRST = [
  'You write first-touch cold emails for Bear Studios to the founder of a startup that just launched.',
  STUDIO,
  VOICE,
  'STRUCTURE (4 short paragraphs, 90-140 words in total):',
  '1. Greeting line: "Hi <first name>," (or "Hi <Company> team," if the name is unknown).',
  '2. One or two sentences showing you actually looked: a specific, genuine observation about what they built or launched (use the hook). No generic praise.',
  '3. The gap and the idea: why a video matters for them right now (e.g. new visitors decide in seconds, the product is hard to grasp from text, launch momentum fades fast) and ONE concrete video idea tailored to their product — describe what the video would show in a sentence. Pick the service that fits: no homepage video -> a 60-90 second explainer; just launched -> a launch film plus vertical and square cuts for social.',
  '4. At most one proof point about how we work (e.g. delivered in 7-12 days, or 4K in every format, or a live workspace) — only if it helps.',
  '5. A low-friction close: a single soft question such as "Would a 15-minute call next week be useful?" or "Want me to sketch a rough storyline for <Company>?". Then a final line exactly: "I\'ve attached a one-pager on how we work."',
  'SUBJECT: 3-6 words, specific to them, sentence case or lowercase, no clickbait, no "quick question".',
  'Output ONLY JSON: {"subject": "...", "body": "..."} where body uses \\n\\n between paragraphs.',
].join('\n')

const SYS_FOLLOW = [
  'You write a short follow-up to a cold email from Bear Studios that got no reply. It is sent as a reply in the same Gmail thread, so do not repeat the original pitch or re-introduce us.',
  STUDIO,
  VOICE,
  'Follow-up step 2 (40-80 words): "Hi <first name>," then add genuine value — one new, concrete storyline idea for a video about their product (what the first seconds would show, what the viewer understands by the end). Close with a soft question.',
  'Follow-up step 3, the last one (30-60 words): "Hi <first name>," then a polite close-the-loop note: you will not follow up again, the door stays open, they can reply any time or book a call at calendly.com/bearstudios-co/30min. No guilt-tripping.',
  'Output ONLY JSON: {"subject": "Re: <original subject>", "body": "..."}',
].join('\n')

const SYS_DM = [
  'You write a short direct message (X or LinkedIn) from Karthikeya at Bear Studios to the founder of a startup that just launched.',
  STUDIO,
  VOICE,
  'DM rules: 35-70 words, casual but sharp, 2-3 short sentences. Start with "Hey <first name>" (or "Hey" if unknown). Mention one specific thing about what they launched, one concrete video idea for it, then ask if they would like to see a couple of examples. No links, no sign-off.',
  'Output ONLY JSON: {"subject": "DM to <company>", "body": "..."}',
].join('\n')

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
