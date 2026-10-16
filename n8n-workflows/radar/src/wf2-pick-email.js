// WF-2 "Pick founder email" (Code node, Run Once for Each Item).
// Input: Hunter domain-search response for one qualified lead.
// Prefers founders / CEOs; otherwise the most confident personal address.

const lead = $('Qualified?').item.json
const res = $json || {}
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

const fullName = best ? [best.first_name, best.last_name].filter(Boolean).join(' ') : ''
return {
  json: {
    ...lead,
    email: best ? best.value : null,
    name: fullName || lead.name || null,
    founder_role: best?.position || null,
    hunter_error: res.error ? String(res.error.message || res.error).slice(0, 200) : null,
  },
}
