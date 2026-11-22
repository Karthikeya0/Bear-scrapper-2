// WF-P1 "Plan searches" (Code node, Run Once for All Items).
// SOP section 4, step 1: "[niche] podcast …" searches across 18 niches. Each run takes the next
// `searches_per_run` searches from the full list (rotating by the hour), so over a day every niche is covered.
// One YouTube search costs 100 of the free 10,000 daily quota units: 20 searches a run x 2 runs = 4,000.

const cfg = $('Settings').first().json
const NICHES = [
  'business', 'startups', 'finance', 'fitness', 'health', 'mental health', 'tech', 'AI', 'marketing', 'true crime',
  'comedy', 'sports', 'parenting', 'real estate', 'creator economy', 'career', 'faith', 'education',
]
const GUESTS = ['founder', 'coach', 'doctor', 'author', 'CEO', 'expert']
const TEMPLATES = [
  n => `${n} podcast episode`,
  n => `${n} podcast full episode ${new Date().getFullYear()}`,
  n => `${n} podcast interview`,
  (n, i) => `${n} podcast ep ${8 + (i % 20)}`, // small shows often have low episode numbers
  (n, i) => `${n} podcast with ${GUESTS[i % GUESTS.length]}`,
  n => `new podcast ${n} first season`,
]

const all = []
TEMPLATES.forEach((t, ti) => NICHES.forEach((n, ni) => all.push({ niche: n, q: t(n, ni + ti) })))

const per = Math.max(1, Math.min(all.length, Number(cfg.searches_per_run) || 20))
// Different slice every run: hours since epoch x per, wrapped around the list.
const start = (Math.floor(Date.now() / 3600000) * per) % all.length
const picked = Array.from({ length: per }, (_, i) => all[(start + i) % all.length])

// "Upload date: this month" from the SOP tip; videoDuration=long (> 20 min) is the "Duration" filter.
const publishedAfter = new Date(Date.now() - 30 * 86400000).toISOString().replace(/\.\d{3}Z$/, 'Z')
return picked.map(p => ({ json: { ...p, publishedAfter } }))
