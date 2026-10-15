// WF-2 "Build lead row" (Code node, Run Once for Each Item).
// Input: Groq chat-completion response for one lead with an email.
// Output: exactly the columns of public.leads (extra keys would make the insert fail).

const lead = $('Has email?').item.json
const cfg = $('Config').first().json
const MIN_SCORE = Number(cfg.min_score) || 60

let scoring = {}
try {
  scoring = JSON.parse($json.choices[0].message.content)
} catch {
  scoring = { score: null, reasoning: $json.error ? `Groq error: ${String($json.error.message || $json.error).slice(0, 200)}` : 'Could not parse AI score', signals: [], hook: null }
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
    // WF-3 only drafts emails for eligible leads; low scores stay visible but are not emailed.
    outreach_eligible: aiScore >= MIN_SCORE,
  },
}
