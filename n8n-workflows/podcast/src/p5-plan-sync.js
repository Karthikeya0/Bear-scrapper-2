// WF-P5 "Plan sync" (Code node, Run Once for All Items).
// Two-way sync with the "Podcast Leads" Google Sheet (SOP section 3, columns A–N, plus O "Niche"):
//   • Status edited in the sheet (and not changed in the dashboard since the last sync) is copied to Supabase.
//   • Every qualified podcast that is new or changed since the last sync is written to the sheet,
//     matched on "YouTube channel URL" so a show is never added twice.
// Output: one item per sheet row to write, each also carrying `_id` / `_status_from_sheet` (stripped before writing).

const cfg = $('Settings').first().json
const leads = $('Qualified podcasts').all().map(i => i.json).filter(l => l && l.id)
const sheet = $('Read sheet').all().map(i => i.json).filter(r => r && (r['YouTube channel URL'] || r['Podcast name']))
const STATUSES = new Set(['New', 'Sample made', 'DM sent', 'Email sent', 'Replied', 'Won', 'Dead'])
const key = u => String(u || '').trim().toLowerCase().replace(/\/+$/, '')
const byUrl = new Map(sheet.map(r => [key(r['YouTube channel URL']), r]))

const day = v => (v ? new Date(v).toISOString().slice(0, 10) : '')
const out = []
for (const l of leads) {
  const row = byUrl.get(key(l.youtube_channel_url))
  const synced = l.sheet_synced_at ? Date.parse(l.sheet_synced_at) : 0
  const changed = !synced || Date.parse(l.updated_at) > synced + 1000
  let status = l.status
  let fromSheet = null
  const sheetStatus = row && String(row.Status || '').trim()
  if (row && sheetStatus && sheetStatus !== l.status && STATUSES.has(sheetStatus) && !changed) {
    status = sheetStatus // edited in the sheet: the sheet wins
    fromSheet = sheetStatus
  }
  if (!row || changed || fromSheet) {
    out.push({
      json: {
        _id: l.id,
        _status_from_sheet: fromSheet,
        'Date added': day(l.created_at),
        'Podcast name': l.podcast_name || '',
        'Host name': l.host_name || '',
        'YouTube channel URL': l.youtube_channel_url || '',
        'Instagram URL': l.instagram_url || '',
        'Host YouTube / other account': l.host_other_url || 'same',
        'Sample episode URL': l.sample_episode_url || '',
        Subscribers: l.subscribers ?? '',
        'Uploads per month': l.uploads_30d ?? '',
        'Has shorts?': l.has_shorts || '',
        'Contact method': [l.contact_method, l.email].filter(Boolean).join(' · '),
        'Why a fit': l.why_fit || '',
        Status: status,
        'Added by': l.added_by || cfg.added_by || 'Bear Radar',
        Niche: l.niche || '',
      },
    })
  }
}
return out
