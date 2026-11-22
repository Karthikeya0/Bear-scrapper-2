// WF-P3 "Plan drafts" (Code node, Run Once for All Items).
// Decides what to write this run: follow-ups first, then first emails (shows with an email), then
// Instagram DMs (shows without an email). Output: one item per draft with the AI prompt ready.

const cfg = $('Settings').first().json
const MAX = Number(cfg.batch_size) || 10
const FOLLOW_UP_DAYS = String(cfg.follow_up_days || '4,7').split(',').map(n => Number(n.trim())).filter(n => n > 0)
const MAX_STEP = 1 + FOLLOW_UP_DAYS.length
const DAY = 86400000
const PENDING = new Set(['pending_review', 'scheduled', 'approved'])
// Scheduled runs keep at most one day of podcast sending (daily_max) waiting; "Draft now" in the dashboard is not capped.
const fromDashboard = $('Dashboard: Draft podcast outreach').isExecuted
const waiting = $('Waiting drafts').all().filter(i => i.json && i.json.id).length
let firstEmailRoom = fromDashboard ? Infinity : Math.max(0, (Number(cfg.daily_max) || 10) - waiting)

const rows = name => $(name).all().map(i => i.json).filter(l => l && l.id)
const firstName = l => {
  const f = String(l.host_name || '').trim().split(/\s+/)[0] || ''
  return /^[A-Z](?=.*[a-z])[A-Za-z'-]+$/.test(f) ? f : null
}
const facts = l => [
  'Podcast: ' + (l.podcast_name || '?'),
  'Host first name: ' + (firstName(l) || 'unknown'),
  'Niche: ' + (l.niche || 'unknown'),
  'YouTube subscribers: ' + (l.subscribers ?? 'unknown'),
  'Episodes in the last 30 days: ' + (l.uploads_30d ?? 'unknown'),
  'Average episode length: ' + (l.avg_minutes ? l.avg_minutes + ' minutes' : 'unknown'),
  'Shorts on their channel: ' + (l.has_shorts || 'unknown') + (l.shorts_30d ? ` (${l.shorts_30d} in 30 days)` : ''),
  'Recent episode we would clip: ' + (l.sample_episode_title ? `"${l.sample_episode_title}"` : 'unknown') + (l.sample_episode_url ? ` ${l.sample_episode_url}` : ''),
  'Free sample short already made: ' + (l.sample_clip_url ? `yes, ${l.sample_clip_url}` : 'no'),
  'Why they fit (internal note, do not quote): ' + (l.why_fit || ''),
]

const STUDIO = [
  'ABOUT US — Bear Studios (bearstudios.in): an editing studio for podcasters.',
  'Three services: (1) Clip Engine: turning each episode into vertical shorts/reels with captions and clean reframing for YouTube Shorts, Instagram Reels and TikTok; (2) show trailers; (3) full podcast episode edits.',
  'Offer: we cut one free sample short from a recent episode so they can see the quality before deciding anything.',
].join('\n')

const VOICE =
  'VOICE: a creator writing to another creator. Warm, specific, concise. Short sentences. Plain text only: no markdown, no bullet points, no emojis, no exclamation marks. ' +
  'Never use: "I hope this finds you well", "I came across", "I wanted to reach out", "just checking in", "touch base", "circle back", "game-changer", "leverage", "take it to the next level". ' +
  'Never invent facts, numbers, client names, results or prices. Only use the facts given. ' +
  'Do NOT write a sign-off or signature (no "Best", "Cheers", name or company at the end) — it is added automatically.'

const SYS_FIRST = [
  'You write first-touch cold emails from Bear Studios to the host of a small podcast that publishes full episodes on YouTube.',
  STUDIO,
  VOICE,
  'STRUCTURE (4 short paragraphs, 80-130 words in total):',
  '1. Greeting: "Hi <first name>," (or "Hi <Podcast> team," if the name is unknown).',
  '2. One or two sentences that show you watched: name the recent episode and one specific thing about it or the show. No generic praise.',
  '3. The gap: long, regular episodes but few or no shorts, so the best moments never reach people scrolling Shorts and Reels. One concrete clip idea from that episode (what the 30-60 second short would show).',
  '4. The offer and close: if a free sample short already exists, share its link; otherwise offer to cut one free from that episode, no strings. End with one soft question such as "Want me to send it over?".',
  'SUBJECT: 3-6 words, specific to their show or episode, lowercase or sentence case, no clickbait.',
  'Output ONLY JSON: {"subject": "...", "body": "..."} where body uses \\n\\n between paragraphs.',
].join('\n')

const SYS_FOLLOW = [
  'You write a short follow-up to a cold email from Bear Studios to a podcast host that got no reply. It is sent as a reply in the same thread, so do not re-introduce us.',
  STUDIO,
  VOICE,
  'Follow-up step 2 (40-70 words): "Hi <first name>," then one new, concrete clip idea from a recent episode and a reminder that the sample short is free. Close with a soft question.',
  'Follow-up step 3, the last one (30-50 words): "Hi <first name>," then a polite close-the-loop note: no more follow-ups, the offer stays open, they can reply any time.',
  'Output ONLY JSON: {"subject": "Re: <original subject>", "body": "..."}',
].join('\n')

const SYS_DM = [
  'You write an Instagram DM from Karthikeya at Bear Studios to a small podcast.',
  STUDIO,
  VOICE,
  'DM rules: 35-60 words, casual and specific, 2-3 short sentences. Start with "Hey <first name>" (or "Hey" if unknown). Mention the recent episode by name, say we would love to cut a free short from it (or share the sample link if one exists), and ask if they want it. No sign-off.',
  'Output ONLY JSON: {"subject": "IG DM to <podcast>", "body": "..."}',
].join('\n')

const plan = []
const seen = new Set()
const seenEmail = new Set()
const add = item => {
  if (plan.length >= MAX || seen.has(item.podcast_id)) return
  if (item.email && seenEmail.has(item.email.toLowerCase())) return
  seen.add(item.podcast_id)
  if (item.email) seenEmail.add(item.email.toLowerCase())
  plan.push(item)
}

// 1. Follow-ups
const now = Date.now()
for (const l of rows('Fetch follow-ups')) {
  const queue = Array.isArray(l.podcast_outreach) ? l.podcast_outreach : []
  if (!l.email || queue.some(q => PENDING.has(q.status))) continue
  const sent = queue.filter(q => q.status === 'sent' && q.sent_at && q.channel === 'email')
  if (!sent.length) continue
  const last = sent.reduce((a, b) => ((b.sequence_step || 1) > (a.sequence_step || 1) ? b : a))
  const step = (last.sequence_step || 1) + 1
  if (step > MAX_STEP) continue
  if ((now - Date.parse(last.sent_at)) / DAY < FOLLOW_UP_DAYS[step - 2]) continue
  const first = sent.find(q => (q.sequence_step || 1) === 1) || last
  add({
    kind: 'followup', podcast_id: l.id, email: l.email, channel: 'email', sequence_step: step,
    system: SYS_FOLLOW,
    user: [`This is follow-up step ${step} of ${MAX_STEP}.`, `Original subject: ${first.subject}`, `Original email:\n${String(first.body || '').slice(0, 1500)}`, ...facts(l)].join('\n'),
    fallback_subject: /^re:/i.test(first.subject || '') ? first.subject : `Re: ${first.subject}`,
  })
}

// 2. First emails
for (const l of rows('Fetch podcasts to draft')) {
  if (!l.email || (Array.isArray(l.podcast_outreach) && l.podcast_outreach.length)) continue
  if (firstEmailRoom <= 0) break
  const before = plan.length
  add({ kind: 'first', podcast_id: l.id, email: l.email, channel: 'email', sequence_step: 1, system: SYS_FIRST, user: facts(l).join('\n') })
  if (plan.length > before) firstEmailRoom--
}

// 3. Instagram DMs for shows without an email (you paste these into Instagram yourself)
if (cfg.draft_dms !== false && String(cfg.draft_dms) !== 'false') {
  for (const l of rows('Fetch podcasts to draft')) {
    if (l.email || !l.instagram_url || (Array.isArray(l.podcast_outreach) && l.podcast_outreach.length)) continue
    add({ kind: 'dm', podcast_id: l.id, email: null, channel: 'dm', sequence_step: 1, system: SYS_DM, user: facts(l).join('\n') })
  }
}

return plan.map(json => ({ json }))
