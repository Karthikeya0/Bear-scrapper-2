// WF-P2 "SOP checks" (Code node, Run Once for Each Item).
// SOP section 5, steps 2–6 for one channel: episodes in the last 30 days, episode length, Shorts tab,
// About links (Instagram, email, host's other channel) and one recent full episode as the sample.
// Input ($json): the Shorts playlist response. Output: { id, hard_skip, patch?, facts…, prompt }.

const cfg = $('Settings').first().json
const ch = $('Channel checks').item.json
const details = $('Video details').item.json || {}
const shortsRes = $json || {}
const DAY = 86400000
const now = Date.now()
const MIN_UPLOADS = Number(cfg.min_uploads_30d) || 2
const MIN_MINUTES = Number(cfg.min_episode_minutes) || 30

// ISO 8601 duration ("PT1H2M3S") -> seconds
const seconds = d => {
  const m = String(d || '').match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  return m ? (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0) : 0
}

// Shorts: the auto "UUSH…" playlist. It returns 404 when the channel has none.
const shortItems = Array.isArray(shortsRes.items) ? shortsRes.items : []
const shortIds = new Set(shortItems.map(s => s.contentDetails && s.contentDetails.videoId).filter(Boolean))
const shorts30 = shortItems.filter(s => {
  const t = Date.parse((s.contentDetails && s.contentDetails.videoPublishedAt) || (s.snippet && s.snippet.publishedAt) || '')
  return t && now - t <= 30 * DAY
}).length
// None: empty Shorts tab. Good: a steady shorts habit (2+ a week) — SOP says skip those. Poor: anything in between.
const hasShorts = shortItems.length === 0 ? 'None' : shorts30 >= 8 ? 'Good' : 'Poor'

const videos = (Array.isArray(details.items) ? details.items : []).map(v => ({
  id: v.id,
  title: String((v.snippet && v.snippet.title) || ''),
  description: String((v.snippet && v.snippet.description) || ''),
  published: Date.parse((v.snippet && v.snippet.publishedAt) || '') || 0,
  secs: seconds(v.contentDetails && v.contentDetails.duration),
  views: Number(v.statistics && v.statistics.viewCount) || 0,
  live: v.snippet && v.snippet.liveBroadcastContent,
  lang: (v.snippet && (v.snippet.defaultAudioLanguage || v.snippet.defaultLanguage)) || null,
}))
// Episodes = full videos (10+ minutes, not a Short, not an upcoming premiere/live).
const episodes = videos.filter(v => !shortIds.has(v.id) && v.secs >= 600 && v.live !== 'upcoming' && v.live !== 'live').sort((a, b) => b.published - a.published)
const recent = episodes.filter(v => now - v.published <= 30 * DAY)
const last = episodes[0] ? episodes[0].published : 0
const sampleSet = episodes.slice(0, 10)
const avgMinutes = sampleSet.length ? Math.round(sampleSet.reduce((s, v) => s + v.secs, 0) / sampleSet.length / 60) : 0

// SOP step 6: one recent FULL episode, preferably from the last 30 days and 30+ minutes; the most-viewed of those.
const pool = recent.filter(v => v.secs >= MIN_MINUTES * 60)
const sample = (pool.length ? pool : recent.length ? recent : episodes.slice(0, 3)).slice().sort((a, b) => b.views - a.views)[0] || null

// SOP step 4: About links. The API has no "links" section, so read the channel description and the
// latest episode descriptions (shows nearly always put their Instagram and email there).
const texts = [ch.description || '', ...episodes.slice(0, 6).map(v => v.description)]
const count = (re, pick, skipFn) => {
  const tally = new Map()
  texts.forEach((t, i) => {
    for (const m of t.matchAll(re)) {
      const v = pick(m)
      if (!v || (skipFn && skipFn(v))) continue
      tally.set(v, (tally.get(v) || 0) + (i === 0 ? 3 : 1)) // the channel's own description counts more
    }
  })
  return [...tally.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0])
}
const IG_RESERVED = new Set(['p', 'reel', 'reels', 'explore', 'stories', 'tv', 'accounts', 'direct', 'about', 'legal'])
const instagram = count(/instagram\.com\/([A-Za-z0-9_.]{2,30})/gi, m => m[1].replace(/\.+$/, '').toLowerCase(), v => IG_RESERVED.has(v))
const emails = count(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, m => m[0].toLowerCase().replace(/\.+$/, ''),
  v => /\.(png|jpe?g|gif|webp)$/.test(v) || /(example\.|youtube\.com|sentry|noreply|no-reply)/.test(v))
const own = String(ch.custom_url || '').replace(/^@/, '').toLowerCase()
const otherYt = count(/youtube\.com\/(@[\w.-]+|channel\/UC[\w-]{20,}|c\/[\w.-]+)/gi, m => m[1], v =>
  v.toLowerCase() === '@' + own || v.toLowerCase() === 'c/' + own || v.includes(ch.channel_id))

const facts = {
  subscribers: ch.subscribers,
  uploads_30d: recent.length,
  avg_minutes: avgMinutes,
  has_shorts: hasShorts,
  shorts_30d: shorts30,
  last_upload_at: last ? new Date(last).toISOString() : null,
  instagram_url: instagram[0] ? `https://www.instagram.com/${instagram[0]}` : null,
  email: emails[0] || null,
  host_other_url: otherYt[0] ? `https://www.youtube.com/${otherYt[0]}` : 'same',
  sample_episode_url: sample ? `https://www.youtube.com/watch?v=${sample.id}` : null,
  sample_episode_title: sample ? sample.title.slice(0, 300) : null,
  podcast_name: ch.podcast_name,
  youtube_channel_url: ch.youtube_channel_url,
  description: ch.description,
}

// Hard skips straight from the SOP ("Skip" column), no AI needed.
let hard = null
if (!episodes.length) hard = 'No full-length episodes found'
else if (now - last > 60 * DAY) hard = 'No upload in 60 days'
else if (hasShorts === 'Good') hard = `Already posts Shorts regularly (${shorts30} in 30 days)`
else if (avgMinutes < 10) hard = `Episodes are short (${avgMinutes} min average)`
else if (!sample) hard = 'No recent full episode to sample'

// Soft checks: failing two or more skips the show (SOP: "If a show fails two or more checks, skip it").
const fails = []
if (recent.length < MIN_UPLOADS) fails.push(`only ${recent.length} episode${recent.length === 1 ? '' : 's'} in 30 days`)
if (avgMinutes < MIN_MINUTES) fails.push(`episodes average ${avgMinutes} min`)
if (!facts.instagram_url) fails.push('no Instagram link found')

const prompt = [
  `Channel: ${ch.podcast_name}`,
  `Niche searched: ${ch.niche || 'unknown'}`,
  `Subscribers: ${ch.subscribers}`,
  `Channel country: ${ch.country || 'unknown'}; channel language: ${ch.default_language || 'unknown'}; latest video language: ${(episodes[0] && episodes[0].lang) || 'unknown'}`,
  `Episodes in last 30 days: ${recent.length}; average length: ${avgMinutes} min; Shorts in last 30 days: ${shorts30}`,
  `Channel description:\n${String(ch.description || '').slice(0, 1500)}`,
  `Latest episode titles:\n${episodes.slice(0, 8).map(v => `- ${v.title} (${Math.round(v.secs / 60)} min, ${v.views} views)`).join('\n')}`,
  `Latest episode description:\n${String((episodes[0] && episodes[0].description) || '').slice(0, 1200)}`,
].join('\n\n')

return {
  json: {
    id: ch.id,
    hard_skip: !!hard,
    fails,
    facts,
    prompt,
    patch: hard ? { stage: 'skipped', skip_reason: hard, checks_failed: fails, ...facts } : null,
  },
}
