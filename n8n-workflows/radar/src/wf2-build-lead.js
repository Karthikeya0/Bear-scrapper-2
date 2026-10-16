// WF-2 "Build lead row" (Code node, Run Once for Each Item).
// Input: Groq chat-completion response for one qualified lead (with or without an email).
// Output: exactly the columns of public.leads (extra keys would make the insert fail).

const lead = $('Pick founder email').item.json
const cfg = $('Config').first().json
const MIN_SCORE = Number(cfg.min_score) || 60

// The model is asked for JSON only; take the first {...} block in case it adds any text around it.
const parseJson = text => {
  const raw = String(text || '').trim()
  const block = raw.match(/\{[\s\S]*\}/)
  return JSON.parse(block ? block[0] : raw)
}
// n8n reports API errors as '400 - {"error":{"message":"..."}}'; keep the readable part.
const errorText = err => {
  const text = String((err && err.message) || err || 'unknown error')
  return (text.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/) || [])[1] || text
}

let scoring = {}
try {
  scoring = parseJson($json.choices[0].message.content)
} catch {
  scoring = { score: null, reasoning: $json.error ? `Groq error: ${errorText($json.error).slice(0, 200)}` : 'Could not parse AI score', signals: [], hook: null }
}
const aiScore = Number.isFinite(Number(scoring.score)) ? Math.max(0, Math.min(100, Math.round(Number(scoring.score)))) : 0

return {
  json: {
    raw_lead_id: lead.id,
    name: lead.name,
    email: lead.email,
    company: lead.company,
    company_domain: lead.company_domain,
    website: lead.website,
    source: lead.source,
    source_id: lead.source_id,
    profile_url: lead.profile_url,
    bio: lead.bio,
    post_content: lead.post_content,
    x_handle: lead.x_handle,
    linkedin_url: lead.linkedin_url,
    launched_at: lead.launched_at,
    team_size: lead.team_size,
    domain_created_at: lead.domain_created_at,
    has_video: lead.has_video,
    signals: lead.signals || [],
    founder_role: lead.founder_role,
    ai_score: aiScore,
    ai_reasoning: [scoring.reasoning, scoring.hook ? `Hook: ${scoring.hook}` : null].filter(Boolean).join('\n') || null,
    ai_signals: Array.isArray(scoring.signals) ? scoring.signals.map(String).slice(0, 8) : [],
    status: 'scored',
    // WF-3 only drafts emails for eligible leads; low scores and leads without an email stay visible but are not emailed.
    outreach_eligible: aiScore >= MIN_SCORE && !!lead.email,
  },
}
