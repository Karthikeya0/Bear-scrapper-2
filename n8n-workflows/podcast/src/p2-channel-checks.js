// WF-P2 "Channel checks" (Code node, Run Once for All Items).
// SOP section 5, step 1: open the channel, check the subscriber count, skip if outside the range.
// Input: one YouTube channels.list response for up to 50 channels. Output: one item per podcast_leads row:
//   { id, channel_id, ok, patch?, …channel facts }   ok=false rows carry the `patch` that marks them skipped.

const cfg = $('Settings').first().json
const found = $('Fetch found podcasts').all().map(i => i.json).filter(r => r && r.id)
const res = $input.first().json || {}
const channels = new Map((Array.isArray(res.items) ? res.items : []).map(c => [c.id, c]))
const MIN = Number(cfg.min_subscribers) || 1000
const MAX = Number(cfg.max_subscribers) || 25000
const apiError = res.error ? String(res.error.message || res.error).slice(0, 200) : null

const skip = (row, reason, extra = {}) => ({
  json: { id: row.id, channel_id: row.youtube_channel_id, ok: false, skip_reason: reason, patch: { stage: 'skipped', skip_reason: reason, ...extra } },
})

const out = []
for (const row of found) {
  // A failed API call leaves the rows as 'found' so the next run retries them.
  if (apiError) continue
  const ch = channels.get(row.youtube_channel_id)
  if (!ch) {
    out.push(skip(row, 'Channel not found on YouTube'))
    continue
  }
  const sn = ch.snippet || {}
  const st = ch.statistics || {}
  const subs = st.hiddenSubscriberCount ? null : Number(st.subscriberCount)
  const facts = {
    podcast_name: String(sn.title || row.podcast_name || '').slice(0, 200) || null,
    youtube_channel_url: sn.customUrl ? `https://www.youtube.com/${sn.customUrl.startsWith('@') ? sn.customUrl : '@' + sn.customUrl}` : `https://www.youtube.com/channel/${ch.id}`,
    subscribers: Number.isFinite(subs) ? subs : null,
    description: String(sn.description || (ch.brandingSettings && ch.brandingSettings.channel && ch.brandingSettings.channel.description) || '').slice(0, 5000),
  }
  if (subs === null || !Number.isFinite(subs)) {
    out.push(skip(row, 'Subscriber count hidden', facts))
    continue
  }
  if (subs < MIN || subs > MAX) {
    out.push(skip(row, `${subs.toLocaleString('en-US')} subscribers (want ${MIN.toLocaleString('en-US')}–${MAX.toLocaleString('en-US')})`, facts))
    continue
  }
  const uploads = ch.contentDetails && ch.contentDetails.relatedPlaylists && ch.contentDetails.relatedPlaylists.uploads
  if (!uploads) {
    out.push(skip(row, 'No uploads playlist', facts))
    continue
  }
  out.push({
    json: {
      id: row.id,
      channel_id: ch.id,
      ok: true,
      niche: row.niche,
      uploads_playlist: uploads,
      // Every channel's Shorts live in an auto-made playlist "UUSH" + channel id without its "UC" prefix.
      shorts_playlist: 'UUSH' + ch.id.slice(2),
      custom_url: sn.customUrl || null,
      default_language: sn.defaultLanguage || null,
      country: sn.country || null,
      ...facts,
    },
  })
}

// On an API error nothing is output (Run summary reports it from the channels response).
return out
