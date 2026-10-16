// Builds the import-ready n8n workflows for Bear Radar from the Code-node sources in ./src.
//   node n8n-workflows/radar/build.mjs
// Output: n8n-workflows/WF1-lead-radar-sources.json, WF2-qualify-enrich.json, WF3-draft-outreach.json, WF3b-send-approved.json

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const src = name => readFileSync(join(here, 'src', name), 'utf8')
const out = name => join(here, '..', name)

// Stable ids so re-imports update the same nodes instead of duplicating them.
let seq = 0
const id = prefix => `${prefix}-0000-4000-8000-${String(++seq).padStart(12, '0')}`

// Credentials are referenced by name; after import, re-select them in each node if n8n asks.
const CRED = {
  dashboard: { httpHeaderAuth: { id: 'bearDashboardSecret', name: 'Bear dashboard secret' } },
  supabase: { supabaseApi: { id: 'bearSupabase', name: 'Supabase account' } },
  productHunt: { httpHeaderAuth: { id: 'bearProductHunt', name: 'Product Hunt token' } },
  hunter: { httpHeaderAuth: { id: 'bearHunter', name: 'Hunter API key' } },
  groq: { httpHeaderAuth: { id: 'bearGroq', name: 'Groq API key' } },
}

const node = (name, type, typeVersion, position, parameters, extra = {}) => ({
  id: id('b3a5e7c1'),
  name,
  type,
  typeVersion,
  position,
  parameters,
  ...extra,
})

const schedule = (name, pos, interval) => node(name, 'n8n-nodes-base.scheduleTrigger', 1.2, pos, { rule: { interval: [interval] } })

const webhook = (name, pos, path) =>
  node(
    name,
    'n8n-nodes-base.webhook',
    2,
    pos,
    { httpMethod: 'POST', path, authentication: 'headerAuth', responseMode: 'onReceived', options: {} },
    { webhookId: id('7e1f0b2a'), credentials: CRED.dashboard },
  )

const config = (name, pos, values) =>
  node(name, 'n8n-nodes-base.set', 3.4, pos, {
    mode: 'manual',
    assignments: {
      assignments: Object.entries(values).map(([key, value]) => ({
        id: id('c0f19a00'),
        name: key,
        value,
        type: typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'string',
      })),
    },
    includeOtherFields: false,
    options: {},
  })

const code = (name, pos, file, mode = 'runOnceForAllItems') =>
  node(name, 'n8n-nodes-base.code', 2, pos, { mode, jsCode: src(file) })

/** HTTP Request v4.2. `auth`: { supabase } | { header: CRED.x } | undefined */
function http(name, pos, { method = 'GET', url, auth, headers = [], query = [], body, responseFormat = 'json', timeout = 30000, batching }, extra = {}) {
  const p = { method, url, options: { timeout, response: { response: { responseFormat } } } }
  if (batching) p.options.batching = { batch: batching }
  let credentials
  if (auth?.supabase) {
    p.authentication = 'predefinedCredentialType'
    p.nodeCredentialType = 'supabaseApi'
    credentials = CRED.supabase
  } else if (auth?.header) {
    p.authentication = 'genericCredentialType'
    p.genericAuthType = 'httpHeaderAuth'
    credentials = auth.header
  }
  if (query.length) {
    p.sendQuery = true
    p.queryParameters = { parameters: query.map(([n, v]) => ({ name: n, value: v })) }
  }
  if (headers.length) {
    p.sendHeaders = true
    p.headerParameters = { parameters: headers.map(([n, v]) => ({ name: n, value: v })) }
  }
  if (body) {
    p.sendBody = true
    p.contentType = 'json'
    p.specifyBody = 'json'
    p.jsonBody = body
  }
  return node(name, 'n8n-nodes-base.httpRequest', 4.2, pos, p, { ...(credentials ? { credentials } : {}), ...extra })
}

const ifTrue = (name, pos, expr) =>
  node(name, 'n8n-nodes-base.if', 2, pos, {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
      conditions: [{ id: id('1f0c0d00'), leftValue: expr, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
      combinator: 'and',
    },
    options: {},
  })

const link = (connections, from, to, outputIndex = 0, inputIndex = 0) => {
  connections[from] ??= { main: [] }
  while (connections[from].main.length <= outputIndex) connections[from].main.push([])
  connections[from].main[outputIndex].push({ node: to, type: 'main', index: inputIndex })
}

const SB = "{{ $('Config').first().json.supabase_url }}"
const CONTINUE = { onError: 'continueRegularOutput' }

// =====================================================================================
// WF-1: Lead Radar – Sources
// =====================================================================================
function buildWf1() {
  const nodes = [
    schedule('Every 6 hours', [0, 0], { field: 'hours', hoursInterval: 6 }),
    webhook('Dashboard: Scrape leads', [0, 200], 'wf1-scraper'),
    config('Config', [240, 100], {
      supabase_url: 'https://YOUR-PROJECT-REF.supabase.co',
      hn_url: 'https://hn.algolia.com/api/v1/search_by_date?tags=show_hn&hitsPerPage=200',
      yc_url: 'https://yc-oss.github.io/api/companies/all.json',
      betalist_url: 'https://betalist.com/startups.rss',
      producthunt_url: 'https://api.producthunt.com/v2/api/graphql',
      lookback_days: 7,
      yc_lookback_days: 120,
      max_team_size: 3,
      started_at: '={{ $now.toISO() }}',
    }),
    http('Hacker News: Show HN', [520, -150], {
      url: "={{ $json.hn_url }}&numericFilters=created_at_i>{{ Math.floor(Date.now() / 1000) - $json.lookback_days * 86400 }}",
    }, CONTINUE),
    http('YC: new companies', [520, 0], { url: '={{ $json.yc_url }}', timeout: 60000 }, CONTINUE),
    node('BetaList: new startups', 'n8n-nodes-base.rssFeedRead', 1.1, [520, 150], { url: '={{ $json.betalist_url }}', options: {} }, CONTINUE),
    http('Product Hunt: launches', [520, 300], {
      method: 'POST',
      url: '={{ $json.producthunt_url }}',
      auth: { header: CRED.productHunt },
      body:
        '={{ JSON.stringify({ query: "query($after: DateTime) { posts(order: NEWEST, first: 50, postedAfter: $after) { edges { node { id name tagline description url website votesCount createdAt makers { name username twitterUsername } } } } }", variables: { after: new Date(Date.now() - $json.lookback_days * 86400000).toISOString() } }) }}',
    }, CONTINUE),
    node('Merge sources', 'n8n-nodes-base.merge', 3, [780, 75], { numberInputs: 4 }),
    code('Normalize & pre-filter', [1000, 75], 'wf1-normalize.js'),
    http('Save new raw leads', [1220, 75], {
      method: 'POST',
      url: `=${SB}/rest/v1/raw_leads?on_conflict=dedup_key`,
      auth: { supabase: true },
      headers: [['Prefer', 'resolution=ignore-duplicates,return=representation']],
      body: '={{ JSON.stringify($json.rows) }}',
    }, { alwaysOutputData: true }),
    code('Run summary', [1440, 75], 'wf1-summary.js'),
    http('Write run log', [1660, 75], {
      method: 'POST',
      url: `=${SB}/rest/v1/workflow_logs`,
      auth: { supabase: true },
      responseFormat: 'text',
      headers: [['Prefer', 'return=minimal']],
      body: '={{ JSON.stringify($json) }}',
    }),
  ]
  const c = {}
  link(c, 'Every 6 hours', 'Config')
  link(c, 'Dashboard: Scrape leads', 'Config')
  link(c, 'Config', 'Hacker News: Show HN')
  link(c, 'Config', 'YC: new companies')
  link(c, 'Config', 'BetaList: new startups')
  link(c, 'Config', 'Product Hunt: launches')
  link(c, 'Hacker News: Show HN', 'Merge sources', 0, 0)
  link(c, 'YC: new companies', 'Merge sources', 0, 1)
  link(c, 'BetaList: new startups', 'Merge sources', 0, 2)
  link(c, 'Product Hunt: launches', 'Merge sources', 0, 3)
  link(c, 'Merge sources', 'Normalize & pre-filter')
  link(c, 'Normalize & pre-filter', 'Save new raw leads')
  link(c, 'Save new raw leads', 'Run summary')
  link(c, 'Run summary', 'Write run log')
  return { name: 'WF-1: Lead Radar – Sources', nodes, connections: c, settings: { executionOrder: 'v1' }, pinData: {} }
}

// =====================================================================================
// WF-2: Qualify & Enrich
// =====================================================================================
const GROQ_SYSTEM =
  'You qualify leads for Bear Studios, a studio that makes brand launch videos, promo videos and SaaS explainer videos for startups. ' +
  'Score 0-100 how likely this company needs a video now AND would reply to a short cold email. Weigh heavily: just launched or launching soon; ' +
  'no product/explainer video on their homepage; a real product company (SaaS, app, tool) rather than an open-source library, hobby project, agency or job post. ' +
  'Tiny teams are fine. Output ONLY JSON: {"score": <0-100>, "reasoning": "<1-2 sentences>", "signals": ["<short signal>"], ' +
  '"hook": "<one specific, non-generic opening line for a cold email that references what they launched>"}'

function buildWf2() {
  const nodes = [
    schedule('Every hour', [0, 0], { field: 'hours', hoursInterval: 1 }),
    webhook('Dashboard: Score & enrich', [0, 200], 'wf2-processor'),
    config('Config', [240, 100], {
      supabase_url: 'https://YOUR-PROJECT-REF.supabase.co',
      batch_size: 25,
      max_team_size: 3,
      max_launch_age_days: 90,
      max_domain_age_days: 730,
      just_launched_days: 30,
      min_score: 60,
      rdap_base: 'https://rdap.org',
      hn_user_api: 'https://hacker-news.firebaseio.com/v0',
      hunter_url: 'https://api.hunter.io/v2/domain-search',
      groq_url: 'https://api.groq.com/openai/v1/chat/completions',
      groq_model: 'llama-3.3-70b-versatile',
      started_at: '={{ $now.toISO() }}',
    }),
    http('Fetch raw leads', [460, 100], {
      url: `=${SB}/rest/v1/raw_leads?status=eq.raw&order=created_at.desc&limit={{ $json.batch_size }}`,
      auth: { supabase: true },
    }, { alwaysOutputData: true }),
    code('Free checks & qualify', [680, 100], 'wf2-free-checks.js'),
    code('Run summary', [900, 360], 'wf2-summary.js'),
    http('Write run log', [1120, 360], {
      method: 'POST',
      url: `=${SB}/rest/v1/workflow_logs`,
      auth: { supabase: true },
      responseFormat: 'text',
      headers: [['Prefer', 'return=minimal']],
      body: '={{ JSON.stringify($json) }}',
    }),
    ifTrue('Qualified?', [900, 100], '={{ $json.qualified }}'),
    // Hunter costs credits, so it only runs when the free website / HN search found no address.
    ifTrue('Need Hunter?', [1010, -60], '={{ !$json.site_email }}'),
    http('Hunter: founder email', [1120, 0], {
      url: "={{ $('Config').first().json.hunter_url }}",
      auth: { header: CRED.hunter },
      query: [['domain', '={{ $json.company_domain }}'], ['limit', '10']],
    }, CONTINUE),
    code('Pick founder email', [1340, 0], 'wf2-pick-email.js', 'runOnceForEachItem'),
    http('Groq: score lead', [1560, 0], {
      method: 'POST',
      url: "={{ $('Config').first().json.groq_url }}",
      auth: { header: CRED.groq },
      batching: { batchSize: 1, batchInterval: 2500 },
      body:
        "={{ JSON.stringify({ model: $('Config').first().json.groq_model, temperature: 0.2, response_format: { type: 'json_object' }, messages: [ { role: 'system', content: " +
        JSON.stringify(GROQ_SYSTEM) +
        " }, { role: 'user', content: ['Company: ' + ($json.company || '?'), 'Website: ' + $json.website, 'Source: ' + $json.source, 'Launched: ' + ($json.launched_at || 'unknown'), 'Team size: ' + ($json.team_size || 'unknown'), 'Homepage has a video: ' + ($json.has_video === null ? 'unknown' : $json.has_video), 'Signals: ' + ($json.signals || []).join(', '), 'Founder: ' + ($json.name || '?') + ($json.founder_role ? ' (' + $json.founder_role + ')' : ''), 'About: ' + String($json.post_content || '').slice(0, 1500)].join('\\n') } ] }) }}",
    }, CONTINUE),
    code('Build lead row', [1780, 0], 'wf2-build-lead.js', 'runOnceForEachItem'),
    http('Save lead', [2000, 0], {
      method: 'POST',
      url: `=${SB}/rest/v1/leads?on_conflict=raw_lead_id`,
      auth: { supabase: true },
      responseFormat: 'text',
      headers: [['Prefer', 'resolution=ignore-duplicates,return=minimal']],
      body: '={{ JSON.stringify($json) }}',
    }, { alwaysOutputData: true }),
    http('Mark processed', [2220, 0], {
      method: 'PATCH',
      url: `=${SB}/rest/v1/raw_leads?id=eq.{{ $('Build lead row').item.json.raw_lead_id }}`,
      auth: { supabase: true },
      responseFormat: 'text',
      headers: [['Prefer', 'return=minimal']],
      body:
        "={{ JSON.stringify({ status: 'processed', processed_at: new Date().toISOString(), disqualify_reason: null, website: $('Build lead row').item.json.website, company_domain: $('Build lead row').item.json.company_domain, x_handle: $('Build lead row').item.json.x_handle, linkedin_url: $('Build lead row').item.json.linkedin_url }) }}",
    }),
    http('Save disqualified', [1780, 260], {
      method: 'PATCH',
      url: `=${SB}/rest/v1/raw_leads?id=eq.{{ $json.id }}`,
      auth: { supabase: true },
      responseFormat: 'text',
      headers: [['Prefer', 'return=minimal']],
      body:
        "={{ JSON.stringify({ status: 'disqualified', processed_at: new Date().toISOString(), disqualify_reason: $json.disqualify_reason, website: $json.website, company_domain: $json.company_domain, x_handle: $json.x_handle, linkedin_url: $json.linkedin_url }) }}",
    }),
  ]
  const c = {}
  link(c, 'Every hour', 'Config')
  link(c, 'Dashboard: Score & enrich', 'Config')
  link(c, 'Config', 'Fetch raw leads')
  link(c, 'Fetch raw leads', 'Free checks & qualify')
  link(c, 'Free checks & qualify', 'Qualified?')
  link(c, 'Free checks & qualify', 'Run summary')
  link(c, 'Run summary', 'Write run log')
  link(c, 'Qualified?', 'Need Hunter?', 0)
  link(c, 'Need Hunter?', 'Hunter: founder email', 0)
  link(c, 'Need Hunter?', 'Pick founder email', 1)
  link(c, 'Qualified?', 'Save disqualified', 1)
  link(c, 'Hunter: founder email', 'Pick founder email')
  // Every qualified lead is scored and saved, even when Hunter finds no email (or its quota is used up):
  // it still shows on the Leads page with its website / X / LinkedIn; WF-3 only drafts for leads with an email.
  link(c, 'Pick founder email', 'Groq: score lead')
  link(c, 'Groq: score lead', 'Build lead row')
  link(c, 'Build lead row', 'Save lead')
  link(c, 'Save lead', 'Mark processed')
  return { name: 'WF-2: Qualify & Enrich', nodes, connections: c, settings: { executionOrder: 'v1' }, pinData: {} }
}

// =====================================================================================
// WF-3: Draft Outreach (Groq writes one email per qualified lead -> outreach_queue, pending_review)
// =====================================================================================
const WRITER_SYSTEM =
  'You write short cold emails for Bear Studios, a small studio that makes brand launch videos, promo videos and SaaS explainer videos for startups. ' +
  'Write to the founder of the company described. Rules: plain text, 60-110 words, no markdown, no emojis, no exclamation marks. ' +
  'Open with the provided hook or another specific detail about what they built or launched (never "I hope this finds you well"). ' +
  'Then offer ONE fitting service: no video on their homepage -> a 60-90s explainer; just launched -> a launch/promo video for socials; otherwise whichever fits best. ' +
  'Never invent facts, numbers, clients or results. Mention the portfolio link only if one is given. ' +
  'End with a soft, low-effort question (e.g. "Worth a quick look at a few examples?"), then sign off with the sender name on its own line. ' +
  'Address the founder by first name if given, otherwise "Hi there". Subject: under 7 words, lowercase is fine, specific to them, no clickbait. ' +
  'Output ONLY JSON: {"subject": "...", "body": "..."}'

function buildWf3() {
  const nodes = [
    schedule('Every 3 hours', [0, 0], { field: 'hours', hoursInterval: 3 }),
    webhook('Dashboard: Draft outreach', [0, 200], 'wf3-outreach'),
    config('Config', [240, 100], {
      supabase_url: 'https://YOUR-PROJECT-REF.supabase.co',
      batch_size: 10,
      min_score: 60,
      sender_name: 'Bear Studios',
      portfolio_url: '',
      groq_url: 'https://api.groq.com/openai/v1/chat/completions',
      groq_model: 'llama-3.3-70b-versatile',
      started_at: '={{ $now.toISO() }}',
    }),
    http('Fetch leads to draft', [460, 100], {
      url:
        `=${SB}/rest/v1/leads?select=*,outreach_queue(id,status)&outreach_queue=is.null&status=eq.scored&outreach_eligible=eq.true` +
        '&email=not.is.null&ai_score=gte.{{ $json.min_score }}&order=ai_score.desc&limit={{ $json.batch_size }}',
      auth: { supabase: true },
    }, { alwaysOutputData: true }),
    code('Pick leads to draft', [680, 100], 'wf3-pick-leads.js', 'runOnceForAllItems'),
    ifTrue('Anything to draft?', [900, 100], '={{ !!$json.id }}'),
    http('Groq: write email', [1120, 0], {
      method: 'POST',
      url: "={{ $('Config').first().json.groq_url }}",
      auth: { header: CRED.groq },
      timeout: 60000,
      // One request every 2.5s keeps 10 drafts inside Groq's free-tier rate limits.
      batching: { batchSize: 1, batchInterval: 2500 },
      body:
        "={{ JSON.stringify({ model: $('Config').first().json.groq_model, temperature: 0.6, response_format: { type: 'json_object' }, messages: [ { role: 'system', content: " +
        JSON.stringify(WRITER_SYSTEM) +
        " }, { role: 'user', content: ['Founder first name: ' + ($json.first_name || 'unknown'), 'Founder role: ' + ($json.founder_role || 'unknown'), 'Company: ' + ($json.company || '?'), 'Website: ' + ($json.website || $json.company_domain || '?'), 'Launched: ' + ($json.launched_at || 'unknown') + ' (via ' + $json.source + ')', 'Homepage has a video: ' + ($json.has_video === null || $json.has_video === undefined ? 'unknown' : $json.has_video), 'Signals: ' + (Array.isArray($json.signals) ? $json.signals.join(', ') : ''), 'Hook: ' + ($json.hook || 'none'), 'About: ' + String($json.bio || $json.post_content || '').slice(0, 1200), 'Sender name: ' + $('Config').first().json.sender_name, 'Portfolio link: ' + ($('Config').first().json.portfolio_url || 'none')].join('\\n') } ] }) }}",
    }, CONTINUE),
    code('Build drafts', [1340, 0], 'wf3-build-drafts.js'),
    ifTrue('Any drafts?', [1560, 0], '={{ $json.rows.length > 0 }}'),
    http('Queue for review', [1780, -100], {
      method: 'POST',
      url: `=${SB}/rest/v1/outreach_queue`,
      auth: { supabase: true },
      responseFormat: 'text',
      headers: [['Prefer', 'return=minimal']],
      body: '={{ JSON.stringify($json.rows) }}',
    }, { alwaysOutputData: true }),
    code('Run summary', [2000, 100], 'wf3-summary.js'),
    http('Write run log', [2000, 100], {
      method: 'POST',
      url: `=${SB}/rest/v1/workflow_logs`,
      auth: { supabase: true },
      responseFormat: 'text',
      headers: [['Prefer', 'return=minimal']],
      body: '={{ JSON.stringify($json) }}',
    }),
  ]
  // Pick emits one empty item when nothing is left to draft, so the run is still logged.
  nodes.find(n => n.name === 'Pick leads to draft').alwaysOutputData = true
  nodes.find(n => n.name === 'Write run log').position = [2220, 100]
  const c = {}
  link(c, 'Every 3 hours', 'Config')
  link(c, 'Dashboard: Draft outreach', 'Config')
  link(c, 'Config', 'Fetch leads to draft')
  link(c, 'Fetch leads to draft', 'Pick leads to draft')
  link(c, 'Pick leads to draft', 'Anything to draft?')
  link(c, 'Anything to draft?', 'Groq: write email', 0)
  link(c, 'Anything to draft?', 'Run summary', 1)
  link(c, 'Groq: write email', 'Build drafts')
  link(c, 'Build drafts', 'Any drafts?')
  link(c, 'Any drafts?', 'Queue for review', 0)
  link(c, 'Any drafts?', 'Run summary', 1)
  link(c, 'Queue for review', 'Run summary')
  link(c, 'Run summary', 'Write run log')
  return { name: 'WF-3: Draft Outreach', nodes, connections: c, settings: { executionOrder: 'v1' }, pinData: {} }
}

// =====================================================================================
// WF-3b: Send Approved (dashboard "Approve & send" -> Gmail -> mark sent / return to review)
// Same webhook path and payload as before: POST /webhook/approve-and-send { outreach_id, lead_id, approved_at }
// =====================================================================================
function buildWf3b() {
  const Q = "$('Fetch approved email').first().json"
  const nodes = [
    webhook('Dashboard: Approve & send', [0, 100], 'approve-and-send'),
    config('Config', [220, 100], {
      supabase_url: 'https://YOUR-PROJECT-REF.supabase.co',
      sender_name: 'Bear Studios',
      started_at: '={{ $now.toISO() }}',
    }),
    http('Fetch approved email', [440, 100], {
      url:
        `=${SB}/rest/v1/outreach_queue?id=eq.{{ $('Dashboard: Approve & send').first().json.body.outreach_id }}&status=eq.approved` +
        '&select=id,lead_id,subject,body,sequence_step,leads(id,email,name,company,status)',
      auth: { supabase: true },
    }, { alwaysOutputData: true }),
    ifTrue('Ready to send?', [660, 100],
      "={{ !!$json.id && !!($json.leads && $json.leads.email) && !['unsubscribed', 'bounced', 'dead'].includes($json.leads.status) }}"),
    node('Gmail: send', 'n8n-nodes-base.gmail', 2.1, [880, 0], {
      sendTo: '={{ $json.leads.email }}',
      subject: '={{ $json.subject }}',
      emailType: 'text',
      message: '={{ $json.body }}',
      options: { appendAttribution: false, senderName: "={{ $('Config').first().json.sender_name }}" },
    }, { credentials: { gmailOAuth2: { id: 'bearGmail', name: 'Gmail account' } }, ...CONTINUE }),
    ifTrue('Sent?', [1100, 0], '={{ !!$json.id && !$json.error }}'),
    http('Mark sent', [1320, -100], {
      method: 'PATCH',
      url: `=${SB}/rest/v1/outreach_queue?id=eq.{{ ${Q}.id }}`,
      auth: { supabase: true },
      responseFormat: 'text',
      headers: [['Prefer', 'return=minimal']],
      body: "={{ JSON.stringify({ status: 'sent', sent_at: new Date().toISOString() }) }}",
    }),
    http('Save history', [1540, -100], {
      method: 'POST',
      url: `=${SB}/rest/v1/outreach_history`,
      auth: { supabase: true },
      responseFormat: 'text',
      headers: [['Prefer', 'return=minimal']],
      body:
        `={{ JSON.stringify({ lead_id: ${Q}.lead_id, outreach_id: ${Q}.id, subject: ${Q}.subject, body: ${Q}.body, body_sent: ${Q}.body, ` +
        `sequence_step: ${Q}.sequence_step || 1, thread_id: $('Gmail: send').first().json.threadId || null, message_id: $('Gmail: send').first().json.id || null, sent_at: new Date().toISOString() }) }}`,
    }, CONTINUE),
    // Only moves fresh leads to "contacted", so a lead that already replied is never downgraded.
    http('Mark lead contacted', [1760, -100], {
      method: 'PATCH',
      url: `=${SB}/rest/v1/leads?id=eq.{{ ${Q}.lead_id }}&status=eq.scored`,
      auth: { supabase: true },
      responseFormat: 'text',
      headers: [['Prefer', 'return=minimal']],
      body: "={{ JSON.stringify({ status: 'contacted', first_contacted_at: new Date().toISOString() }) }}",
    }),
    http('Log sent', [1980, -100], {
      method: 'POST',
      url: `=${SB}/rest/v1/workflow_logs`,
      auth: { supabase: true },
      responseFormat: 'text',
      headers: [['Prefer', 'return=minimal']],
      body: "={{ JSON.stringify({ workflow_name: 'WF-3b-SendApproved', status: 'success', emails_sent: 1, started_at: $('Config').first().json.started_at, finished_at: new Date().toISOString() }) }}",
    }),
    http('Return to review', [1320, 100], {
      method: 'PATCH',
      url: `=${SB}/rest/v1/outreach_queue?id=eq.{{ ${Q}.id }}&status=eq.approved`,
      auth: { supabase: true },
      responseFormat: 'text',
      headers: [['Prefer', 'return=minimal']],
      body: "={{ JSON.stringify({ status: 'pending_review', approved_at: null }) }}",
    }),
    http('Log failure', [1540, 200], {
      method: 'POST',
      url: `=${SB}/rest/v1/workflow_logs`,
      auth: { supabase: true },
      responseFormat: 'text',
      headers: [['Prefer', 'return=minimal']],
      body:
        "={{ JSON.stringify({ workflow_name: 'WF-3b-SendApproved', status: 'failed', emails_sent: 0, started_at: $('Config').first().json.started_at, finished_at: new Date().toISOString(), " +
        "errors: [{ outreach_id: $('Dashboard: Approve & send').first().json.body.outreach_id, message: $('Gmail: send').isExecuted " +
        "? 'Gmail send failed: ' + String(($('Gmail: send').first().json.error && ($('Gmail: send').first().json.error.message || $('Gmail: send').first().json.error)) || 'unknown error').slice(0, 300) + ' (email returned to the review queue)' " +
        ": 'Not sent: the email is no longer approved, or the lead has no email / unsubscribed.' }] }) }}",
    }),
  ]
  const c = {}
  link(c, 'Dashboard: Approve & send', 'Config')
  link(c, 'Config', 'Fetch approved email')
  link(c, 'Fetch approved email', 'Ready to send?')
  link(c, 'Ready to send?', 'Gmail: send', 0)
  link(c, 'Ready to send?', 'Log failure', 1)
  link(c, 'Gmail: send', 'Sent?')
  link(c, 'Sent?', 'Mark sent', 0)
  link(c, 'Sent?', 'Return to review', 1)
  link(c, 'Mark sent', 'Save history')
  link(c, 'Save history', 'Mark lead contacted')
  link(c, 'Mark lead contacted', 'Log sent')
  link(c, 'Return to review', 'Log failure')
  return { name: 'WF-3b: Send Approved', nodes, connections: c, settings: { executionOrder: 'v1' }, pinData: {} }
}

for (const [file, wf] of [
  ['WF1-lead-radar-sources.json', buildWf1()],
  ['WF2-qualify-enrich.json', buildWf2()],
  ['WF3-draft-outreach.json', buildWf3()],
  ['WF3b-send-approved.json', buildWf3b()],
]) {
  writeFileSync(out(file), JSON.stringify(wf, null, 2) + '\n')
  console.log(`wrote n8n-workflows/${file} (${wf.nodes.length} nodes)`)
}
