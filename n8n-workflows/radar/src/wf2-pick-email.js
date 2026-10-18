// WF-2 "Pick founder email" (Code node, Run Once for Each Item).
// Input: Hunter domain-search response for one qualified lead, or the lead itself when the free
// website search already found an address (Hunter is skipped then).
// Prefers Hunter founders / CEOs, then the address published on their site / HN profile.

const lead = $('Qualified?').item.json
const res = $json && ($json.data || $json.error) ? $json : {}
const emails = (res.data && res.data.emails) || []

const score = e => {
  const pos = `${e.position || ''} ${e.seniority || ''}`.toLowerCase()
  let s = Number(e.confidence) || 0
  if (/founder|co-?founder|ceo|owner|chief executive/.test(pos)) s += 200
  else if (/executive|cto|coo|cmo|head|director|vp/.test(pos)) s += 100
  if (e.type === 'generic') s -= 150
  return s
}
const best = emails
  .filter(e => e && e.value && (e.verification?.status ?? 'valid') !== 'invalid')
  .sort((a, b) => score(b) - score(a))[0]

const hunterIsFounder = best && /founder|ceo|owner|chief executive/i.test(`${best.position || ''}`)
const useHunter = best && (hunterIsFounder || !lead.site_email)
const fullName = useHunter ? [best.first_name, best.last_name].filter(Boolean).join(' ') : ''
return {
  json: {
    ...lead,
    email: useHunter ? best.value : lead.site_email || null,
    name: fullName || lead.name || null,
    founder_role: useHunter ? best.position || null : null,
    hunter_error: res.error ? String(res.error.message || res.error).slice(0, 200) : null,
  },
}
