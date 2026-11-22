// WF-P1 "Collect channels" (Code node, Run Once for All Items).
// Input: one YouTube search.list response per planned search. Output: ONE item { rows, searched, failed }
// where rows are new podcast_leads (stage 'found'); WF-P2 checks each one against the SOP.

const plans = $('Plan searches').all().map(i => i.json)
const planFor = i => {
  try {
    return $('Plan searches').itemMatching(i).json
  } catch {
    return plans[i] || {}
  }
}
const errorText = err => {
  const t = String((err && err.message) || err || 'unknown error')
  return (t.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/) || [])[1] || t
}

// Obvious big networks / brands: never small shows (SOP: skip network-owned podcasts).
const BIG = /\b(TED|NPR|BBC|CNN|Fox|NBC|CBS|ABC News|iHeart|Spotify|Wondery|Bloomberg|Forbes|CNBC|Barstool|PBD|Joe Rogan|Lex Fridman|Diary Of A CEO|Huberman|Valuetainment)\b/i

const seen = new Map()
const failed = []
let searched = 0
$input.all().forEach((item, i) => {
  const plan = planFor(i)
  const res = item.json || {}
  if (res.error || !Array.isArray(res.items)) {
    failed.push({ message: `YouTube search "${plan.q}": ${errorText(res.error || 'no results field')}`.slice(0, 300) })
    return
  }
  searched++
  for (const v of res.items) {
    const s = v && v.snippet
    const channelId = s && s.channelId
    if (!channelId || seen.has(channelId)) continue
    if (BIG.test(s.channelTitle || '')) continue
    seen.set(channelId, {
      youtube_channel_id: channelId,
      youtube_channel_url: `https://www.youtube.com/channel/${channelId}`,
      podcast_name: String(s.channelTitle || '').slice(0, 200) || null,
      niche: plan.niche || null,
      source_query: plan.q || null,
      stage: 'found',
      status: 'New',
    })
  }
})

return [{ json: { rows: [...seen.values()], searched, failed } }]
