// Builds the import-ready n8n workflows for Bear Radar from the Code-node sources in ./src.
//   node n8n-workflows/radar/build.mjs
// Output: n8n-workflows/WF1-lead-radar-sources.json, WF2-qualify-enrich.json, WF3-draft-outreach.json, WF3b-send-approved.json, WF4-reply-monitor.json

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
function http(name, pos, { method = 'GET', url, auth, headers = [], query = [], body, responseFormat = 'json', timeout = 30000, batching, fileProperty }, extra = {}) {
  const p = { method, url, options: { timeout, response: { response: { responseFormat, ...(fileProperty ? { outputPropertyName: fileProperty } : {}) } } } }
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
// The one-pager attached to first emails, embedded into WF-3b at build time.
const ONEPAGER_NAME = 'Bear-Studios-How-We-Work.pdf'
const ONEPAGER_B64 = readFileSync(join(here, '..', '..', 'public', ONEPAGER_NAME)).toString('base64')
// For AI calls: ride out short rate limits before giving up.
const RETRY = { retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 }

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
      // llama-3.3-70b-versatile was retired by Groq on 2026-08-16; gpt-oss-120b is Groq's recommended replacement.
      groq_model: 'openai/gpt-oss-120b',
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
      // gpt-oss can take >30s when Groq is busy; a timeout here used to fail the lead.
      timeout: 60000,
      batching: { batchSize: 1, batchInterval: 2500 },
      body:
        "={{ JSON.stringify({ model: $('Config').first().json.groq_model, temperature: 0.2, max_completion_tokens: 2048, ...(String($('Config').first().json.groq_model).startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : {}), messages: [ { role: 'system', content: " +
        JSON.stringify(GROQ_SYSTEM) +
        " }, { role: 'user', content: ['Company: ' + ($json.company || '?'), 'Website: ' + $json.website, 'Source: ' + $json.source, 'Launched: ' + ($json.launched_at || 'unknown'), 'Team size: ' + ($json.team_size || 'unknown'), 'Homepage has a video: ' + ($json.has_video === null ? 'unknown' : $json.has_video), 'Signals: ' + ($json.signals || []).join(', '), 'Founder: ' + ($json.name || '?') + ($json.founder_role ? ' (' + $json.founder_role + ')' : ''), 'About: ' + String($json.post_content || '').slice(0, 1500)].join('\\n') } ] }) }}",
    }, { ...CONTINUE, ...RETRY }),
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
// WF-3: Draft Outreach — first emails, follow-ups and X/LinkedIn DMs -> outreach_queue (pending_review)
// =====================================================================================
function buildWf3() {
  const once = { executeOnce: true, alwaysOutputData: true }
  const nodes = [
    schedule('Every 3 hours', [0, 0], { field: 'hours', hoursInterval: 3 }),
    webhook('Dashboard: Draft outreach', [0, 200], 'wf3-outreach'),
    config('Config', [240, 100], {
      supabase_url: 'https://YOUR-PROJECT-REF.supabase.co',
      batch_size: 10,
      min_score: 60,
      follow_up_days: '4,7',
      draft_dms: true,
      // Every email ends with: sign_off / sender_name / company_name / website
      sign_off: 'Cheers,',
      sender_name: 'Karthikeya Popuri',
      company_name: 'Bear Studios',
      website: 'bearstudios.in',
      // Autopilot (set on the dashboard Settings page): manual | digest | auto
      autopilot_mode: 'manual',
      auto_min_score: 85,
      daily_max: 20,
      paused: false,
      groq_url: 'https://api.groq.com/openai/v1/chat/completions',
      // llama-3.3-70b-versatile was retired by Groq on 2026-08-16; gpt-oss-120b is Groq's recommended replacement.
      groq_model: 'openai/gpt-oss-120b',
      started_at: '={{ $now.toISO() }}',
    }),
    http('Fetch leads to draft', [460, 100], {
      url:
        `=${SB}/rest/v1/leads?select=*,outreach_queue(id)&outreach_queue=is.null&status=eq.scored&outreach_eligible=eq.true` +
        "&email=not.is.null&ai_score=gte.{{ $('Settings').first().json.min_score }}&order=ai_score.desc&limit={{ $('Settings').first().json.batch_size }}",
      auth: { supabase: true },
    }, once),
    http('Fetch DM leads', [680, 100], {
      url:
        `=${SB}/rest/v1/leads?select=*,outreach_queue(id)&outreach_queue=is.null&status=eq.scored&email=is.null` +
        "&or=(x_handle.not.is.null,linkedin_url.not.is.null)&ai_score=gte.{{ $('Settings').first().json.min_score }}&order=ai_score.desc&limit={{ $('Settings').first().json.batch_size }}",
      auth: { supabase: true },
    }, once),
    http('Fetch follow-ups', [900, 100], {
      url:
        `=${SB}/rest/v1/leads?select=*,outreach_queue(id,subject,body,status,sequence_step,sent_at,channel)` +
        '&status=eq.contacted&email=not.is.null&order=first_contacted_at.asc&limit=200',
      auth: { supabase: true },
    }, once),
    http('Waiting drafts', [1010, 240], {
      url: `=${SB}/rest/v1/outreach_queue?select=id&channel=eq.email&status=in.(pending_review,scheduled)&limit=1000`,
      auth: { supabase: true },
    }, once),
    code('Plan drafts', [1120, 100], 'wf3-plan.js'),
    ifTrue('Anything to draft?', [1340, 100], '={{ !!$json.lead_id }}'),
    // One draft at a time: each is saved as soon as Groq writes it, so drafts appear in the dashboard live.
    node('One at a time', 'n8n-nodes-base.splitInBatches', 3, [1560, 100], { batchSize: 1, options: {} }),
    http('Groq: write message', [1780, 0], {
      method: 'POST',
      url: "={{ $('Config').first().json.groq_url }}",
      auth: { header: CRED.groq },
      timeout: 45000,
      body:
        "={{ JSON.stringify({ model: $('Config').first().json.groq_model, temperature: 0.6, max_completion_tokens: 2048, ...(String($('Config').first().json.groq_model).startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : {}), " +
        "messages: [ { role: 'system', content: $json.system }, { role: 'user', content: $json.user } ] }) }}",
    }, { ...CONTINUE, ...RETRY }),
    code('Build drafts', [2000, 0], 'wf3-build-drafts.js'),
    ifTrue('Any drafts?', [2220, 0], '={{ $json.rows.length > 0 }}'),
    http('Queue for review', [2440, -100], {
      method: 'POST',
      url: `=${SB}/rest/v1/outreach_queue`,
      auth: { supabase: true },
      responseFormat: 'text',
      headers: [['Prefer', 'return=minimal']],
      body: '={{ JSON.stringify($json.rows) }}',
    }, { alwaysOutputData: true }),
    node('Next draft', 'n8n-nodes-base.code', 2, [2660, -100], {
      mode: 'runOnceForAllItems',
      jsCode: "// Hand this draft's result back to the loop (Run summary adds them up).\nreturn [{ json: $('Build drafts').first().json }]\n",
    }),
    code('Run summary', [2000, 260], 'wf3-summary.js'),
    http('Write run log', [2220, 260], {
      method: 'POST',
      url: `=${SB}/rest/v1/workflow_logs`,
      auth: { supabase: true },
      responseFormat: 'text',
      headers: [['Prefer', 'return=minimal']],
      body: '={{ JSON.stringify($json.log) }}',
    }),
    ifTrue('Auto-scheduled any?', [2440, 260], "={{ $('Run summary').first().json.audit.length > 0 }}"),
    http('Audit: auto-scheduled', [2660, 200], {
      method: 'POST',
      url: `=${SB}/rest/v1/audit_log`,
      auth: { supabase: true },
      responseFormat: 'text',
      headers: [['Prefer', 'return=minimal']],
      body: "={{ JSON.stringify($('Run summary').first().json.audit) }}",
    }, CONTINUE),
  ]
  // Plan emits one empty item when nothing is left to draft, so the run is still logged.
  nodes.find(n => n.name === 'Plan drafts').alwaysOutputData = true
  const c = {}
  link(c, 'Every 3 hours', 'Config')
  link(c, 'Dashboard: Draft outreach', 'Config')
  link(c, 'Config', 'Fetch leads to draft')
  link(c, 'Fetch leads to draft', 'Fetch DM leads')
  link(c, 'Fetch DM leads', 'Fetch follow-ups')
  link(c, 'Fetch follow-ups', 'Waiting drafts')
  link(c, 'Waiting drafts', 'Plan drafts')
  link(c, 'Plan drafts', 'Anything to draft?')
  link(c, 'Anything to draft?', 'One at a time', 0)
  link(c, 'Anything to draft?', 'Run summary', 1)
  link(c, 'One at a time', 'Run summary', 0) // "done": all per-draft results
  link(c, 'One at a time', 'Groq: write message', 1) // "loop": the next draft
  link(c, 'Groq: write message', 'Build drafts')
  link(c, 'Build drafts', 'Any drafts?')
  link(c, 'Any drafts?', 'Queue for review', 0)
  link(c, 'Any drafts?', 'One at a time', 1)
  link(c, 'Queue for review', 'Next draft')
  link(c, 'Next draft', 'One at a time')
  link(c, 'Run summary', 'Write run log')
  link(c, 'Write run log', 'Auto-scheduled any?')
  link(c, 'Auto-scheduled any?', 'Audit: auto-scheduled', 0)
  return { name: 'WF-3: Draft Outreach', nodes, connections: c, settings: { executionOrder: 'v1' }, pinData: {} }
}

// =====================================================================================
// WF-3b: Send Approved
//   • Dashboard "Approve & send" -> POST /webhook/approve-and-send { outreach_id } -> sends now (same path/payload as before)
//   • Every 10 minutes -> sends ONE bulk-approved ("scheduled") email inside the send window, under daily_max
//   Follow-ups (step 2+) are sent as replies in the original Gmail thread.
// =====================================================================================
function buildWf3b() {
  const Q = "$('Fetch approved email').first().json"
  const once = { executeOnce: true, alwaysOutputData: true }
  const gmailCred = { credentials: { gmailOAuth2: { id: 'bearGmail', name: 'Gmail account' } }, ...CONTINUE }
  const gmailOptions = { appendAttribution: false, senderName: "={{ $('Settings').first().json.sender_name }}" }
  const nodes = [
    webhook('Dashboard: Approve & send', [0, 0], 'approve-and-send'),
    schedule('Every 10 minutes', [0, 240], { field: 'minutes', minutesInterval: 10 }),
    config('Config', [220, 100], {
      supabase_url: 'https://YOUR-PROJECT-REF.supabase.co',
      // Shown as the From name in the lead's inbox.
      sender_name: 'Karthikeya | Bear Studios',
      daily_max: 20,
      send_window_start: 9,
      send_window_end: 18,
      send_on_weekends: false,
      timezone: 'Asia/Kolkata',
      started_at: '={{ $now.toISO() }}',
    }),
    ifTrue('From dashboard?', [440, 100], "={{ $('Dashboard: Approve & send').isExecuted }}"),
    http('Sent today', [660, 240], {
      url:
        `=${SB}/rest/v1/outreach_queue?select=id&status=eq.sent&channel=eq.email` +
        "&sent_at=gte.{{ encodeURIComponent($now.setZone($('Settings').first().json.timezone).startOf('day').toUTC().toISO()) }}",
      auth: { supabase: true },
    }, once),
    http('Next scheduled', [880, 240], {
      url: `=${SB}/rest/v1/outreach_queue?select=id&status=eq.scheduled&channel=eq.email&order=approved_at.asc.nullslast,created_at.asc&limit=1`,
      auth: { supabase: true },
    }, once),
    code('Can send now?', [1100, 240], 'wf3b-can-send.js'),
    // Moves it scheduled -> approved; only one run can claim a row, so nothing is sent twice.
    http('Claim scheduled', [1320, 240], {
      method: 'PATCH',
      url: `=${SB}/rest/v1/outreach_queue?id=eq.{{ $json.id }}&status=eq.scheduled`,
      auth: { supabase: true },
      headers: [['Prefer', 'return=representation']],
      body: "={{ JSON.stringify({ status: 'approved', approved_at: new Date().toISOString() }) }}",
    }),
    code('Target', [1540, 100], 'wf3b-target.js'),
    http('Fetch approved email', [1760, 100], {
      url:
        `=${SB}/rest/v1/outreach_queue?id=eq.{{ $json.outreach_id }}&status=eq.approved` +
        '&select=id,lead_id,subject,body,sequence_step,channel,leads(id,email,name,company,status)',
      auth: { supabase: true },
    }, { alwaysOutputData: true }),
    ifTrue('Ready to send?', [1980, 100],
      "={{ !!$json.id && $json.channel !== 'dm' && !!($json.leads && $json.leads.email) && !['unsubscribed', 'bounced', 'dead', 'replied'].includes($json.leads.status) }}"),
    http('Previous message', [2200, 0], {
      url: `=${SB}/rest/v1/outreach_history?select=message_id,thread_id&lead_id=eq.{{ ${Q}.lead_id }}&message_id=not.is.null&order=sent_at.desc&limit=1`,
      auth: { supabase: true },
    }, once),
    ifTrue('Reply in thread?', [2420, 0], `={{ (${Q}.sequence_step || 1) > 1 && !!$json.message_id && !!$json.thread_id }}`),
    node('Gmail: reply', 'n8n-nodes-base.gmail', 2.1, [2640, -100], {
      // Thread reply (not message reply): only it supports "reply to recipients only", so the lead gets it, not you.
      resource: 'thread',
      operation: 'reply',
      threadId: '={{ $json.thread_id }}',
      messageId: '={{ $json.message_id }}',
      emailType: 'text',
      message: `={{ ${Q}.body }}`,
      options: { ...gmailOptions, replyToRecipientsOnly: true },
    }, gmailCred),
    // First emails carry the one-pager. The PDF is embedded in this node (from public/), so it never depends on
    // n8n reaching the dashboard. Without it the email is NOT sent: the body says it is attached.
    node('One-pager', 'n8n-nodes-base.code', 2, [2640, 100], {
      mode: 'runOnceForAllItems',
      jsCode:
        `const pdf = '${ONEPAGER_B64}'\n` +
        `return [{ json: { file: '${ONEPAGER_NAME}' }, binary: { onepager: { data: pdf, mimeType: 'application/pdf', fileName: '${ONEPAGER_NAME}', fileExtension: 'pdf' } } }]\n`,
    }, CONTINUE),
    ifTrue('Have one-pager?', [2860, 100], '={{ !!($binary && $binary.onepager) }}'),
    node('Gmail: send with one-pager', 'n8n-nodes-base.gmail', 2.1, [3080, 40], {
      sendTo: `={{ ${Q}.leads.email }}`,
      subject: `={{ ${Q}.subject }}`,
      emailType: 'text',
      message: `={{ ${Q}.body }}`,
      options: { ...gmailOptions, attachmentsUi: { attachmentsBinary: [{ property: 'onepager' }] } },
    }, gmailCred),
    code('Send result', [3300, 0], 'wf3b-send-result.js', 'runOnceForEachItem'),
    ifTrue('Sent?', [3520, 0], '={{ $json.ok }}'),
    http('Mark sent', [3740, -100], {
      method: 'PATCH',
      url: `=${SB}/rest/v1/outreach_queue?id=eq.{{ ${Q}.id }}`,
      auth: { supabase: true },
      responseFormat: 'text',
      headers: [['Prefer', 'return=minimal']],
      body: "={{ JSON.stringify({ status: 'sent', sent_at: new Date().toISOString() }) }}",
    }),
    http('Save history', [3960, -100], {
      method: 'POST',
      url: `=${SB}/rest/v1/outreach_history`,
      auth: { supabase: true },
      responseFormat: 'text',
      headers: [['Prefer', 'return=minimal']],
      body:
        `={{ JSON.stringify({ lead_id: ${Q}.lead_id, outreach_id: ${Q}.id, subject: ${Q}.subject, body: ${Q}.body, body_sent: ${Q}.body, ` +
        `sequence_step: ${Q}.sequence_step || 1, thread_id: $('Send result').first().json.thread_id, message_id: $('Send result').first().json.message_id, sent_at: new Date().toISOString() }) }}`,
    }, CONTINUE),
    // Only moves fresh leads to "contacted", so a lead that already replied is never downgraded.
    http('Mark lead contacted', [4180, -100], {
      method: 'PATCH',
      url: `=${SB}/rest/v1/leads?id=eq.{{ ${Q}.lead_id }}&status=eq.scored`,
      auth: { supabase: true },
      responseFormat: 'text',
      headers: [['Prefer', 'return=minimal']],
      body: "={{ JSON.stringify({ status: 'contacted', first_contacted_at: new Date().toISOString() }) }}",
    }),
    http('Log sent', [4400, -100], {
      method: 'POST',
      url: `=${SB}/rest/v1/workflow_logs`,
      auth: { supabase: true },
      responseFormat: 'text',
      headers: [['Prefer', 'return=minimal']],
      body: "={{ JSON.stringify({ workflow_name: 'WF-3b-SendApproved', status: 'success', emails_sent: 1, started_at: $('Config').first().json.started_at, finished_at: new Date().toISOString() }) }}",
    }),
    http('Audit: sent', [4620, -100], {
      method: 'POST',
      url: `=${SB}/rest/v1/audit_log`,
      auth: { supabase: true },
      responseFormat: 'text',
      headers: [['Prefer', 'return=minimal']],
      body: `={{ JSON.stringify({ actor: 'n8n:WF-3b', action: 'sent', lead_id: ${Q}.lead_id, outreach_id: ${Q}.id, details: { to: ${Q}.leads.email, subject: ${Q}.subject, step: ${Q}.sequence_step || 1, trigger: $('Dashboard: Approve & send').isExecuted ? 'dashboard' : 'schedule' } }) }}`,
    }, CONTINUE),
    http('Return to review', [3740, 100], {
      method: 'PATCH',
      url: `=${SB}/rest/v1/outreach_queue?id=eq.{{ ${Q}.id }}&status=eq.approved`,
      auth: { supabase: true },
      responseFormat: 'text',
      headers: [['Prefer', 'return=minimal']],
      body: "={{ JSON.stringify({ status: 'pending_review', approved_at: null }) }}",
    }),
    http('Log failure', [3960, 240], {
      method: 'POST',
      url: `=${SB}/rest/v1/workflow_logs`,
      auth: { supabase: true },
      responseFormat: 'text',
      headers: [['Prefer', 'return=minimal']],
      body:
        "={{ JSON.stringify({ workflow_name: 'WF-3b-SendApproved', status: 'failed', emails_sent: 0, started_at: $('Config').first().json.started_at, finished_at: new Date().toISOString(), " +
        "errors: [{ outreach_id: $('Target').first().json.outreach_id, message: $('Send result').isExecuted " +
        "? 'Gmail send failed: ' + String($('Send result').first().json.error || 'unknown error') + ' (email returned to the review queue)' " +
        ": $('Have one-pager?').isExecuted ? 'Not sent: the one-pager PDF could not be attached (email returned to the review queue). Re-import WF-3b.' " +
        ": 'Not sent: the email is no longer approved, is a DM, or the lead has no email / replied / unsubscribed.' }] }) }}",
    }),
  ]
  const c = {}
  link(c, 'Dashboard: Approve & send', 'Config')
  link(c, 'Every 10 minutes', 'Config')
  link(c, 'Config', 'From dashboard?')
  link(c, 'From dashboard?', 'Target', 0)
  link(c, 'From dashboard?', 'Sent today', 1)
  link(c, 'Sent today', 'Next scheduled')
  link(c, 'Next scheduled', 'Can send now?')
  link(c, 'Can send now?', 'Claim scheduled')
  link(c, 'Claim scheduled', 'Target')
  link(c, 'Target', 'Fetch approved email')
  link(c, 'Fetch approved email', 'Ready to send?')
  link(c, 'Ready to send?', 'Previous message', 0)
  link(c, 'Ready to send?', 'Log failure', 1)
  link(c, 'Previous message', 'Reply in thread?')
  link(c, 'Reply in thread?', 'Gmail: reply', 0)
  link(c, 'Reply in thread?', 'One-pager', 1)
  link(c, 'One-pager', 'Have one-pager?')
  link(c, 'Have one-pager?', 'Gmail: send with one-pager', 0)
  link(c, 'Have one-pager?', 'Return to review', 1)
  link(c, 'Gmail: reply', 'Send result')
  link(c, 'Gmail: send with one-pager', 'Send result')
  link(c, 'Send result', 'Sent?')
  link(c, 'Sent?', 'Mark sent', 0)
  link(c, 'Sent?', 'Return to review', 1)
  link(c, 'Mark sent', 'Save history')
  link(c, 'Save history', 'Mark lead contacted')
  link(c, 'Mark lead contacted', 'Log sent')
  link(c, 'Log sent', 'Audit: sent')
  link(c, 'Return to review', 'Log failure')
  return { name: 'WF-3b: Send Approved', nodes, connections: c, settings: { executionOrder: 'v1' }, pinData: {} }
}

// =====================================================================================
// WF-4: Reply Monitor — marks leads replied / bounced and cancels their unsent follow-ups
// =====================================================================================
function buildWf4() {
  const once = { executeOnce: true, alwaysOutputData: true }
  const F = "$('Find replies & bounces').item.json"
  const nodes = [
    schedule('Every 30 minutes', [0, 0], { field: 'minutes', minutesInterval: 30 }),
    webhook('Dashboard: Check replies', [0, 200], 'wf4-reply-monitor'),
    config('Config', [220, 100], {
      supabase_url: 'https://YOUR-PROJECT-REF.supabase.co',
      lookback_days: 3,
      started_at: '={{ $now.toISO() }}',
    }),
    node('Gmail: recent inbox', 'n8n-nodes-base.gmail', 2.1, [440, 100], {
      resource: 'message',
      operation: 'getAll',
      returnAll: false,
      limit: 100,
      simple: true,
      filters: { q: "={{ 'in:inbox newer_than:' + $('Config').first().json.lookback_days + 'd -from:me' }}" },
      options: {},
    }, { credentials: { gmailOAuth2: { id: 'bearGmail', name: 'Gmail account' } }, ...CONTINUE, ...once }),
    http('Sent threads', [660, 100], {
      url: `=${SB}/rest/v1/outreach_history?select=lead_id,thread_id&thread_id=not.is.null&order=sent_at.desc&limit=2000`,
      auth: { supabase: true },
    }, once),
    http('Contacted leads', [880, 100], {
      url: `=${SB}/rest/v1/leads?select=id,email&status=eq.contacted&email=not.is.null&limit=5000`,
      auth: { supabase: true },
    }, once),
    code('Find replies & bounces', [1100, 100], 'wf4-find-replies.js'),
    ifTrue('Anything found?', [1320, 100], '={{ !!$json.lead_id }}'),
    http('Update lead', [1540, 0], {
      method: 'PATCH',
      url: `=${SB}/rest/v1/leads?id=eq.{{ $json.lead_id }}&status=in.(scored,contacted)`,
      auth: { supabase: true },
      responseFormat: 'text',
      headers: [['Prefer', 'return=minimal']],
      body: "={{ JSON.stringify($json.kind === 'replied' ? { status: 'replied', replied_at: $json.replied_at } : { status: 'bounced' }) }}",
    }),
    http('Cancel follow-ups', [1760, 0], {
      method: 'PATCH',
      url: `=${SB}/rest/v1/outreach_queue?lead_id=eq.{{ ${F}.lead_id }}&status=in.(pending_review,scheduled)`,
      auth: { supabase: true },
      responseFormat: 'text',
      headers: [['Prefer', 'return=minimal']],
      body: "={{ JSON.stringify({ status: 'rejected', rejected_at: new Date().toISOString() }) }}",
    }),
    code('Run summary', [1980, 100], 'wf4-summary.js'),
    http('Write run log', [2200, 100], {
      method: 'POST',
      url: `=${SB}/rest/v1/workflow_logs`,
      auth: { supabase: true },
      responseFormat: 'text',
      headers: [['Prefer', 'return=minimal']],
      body: '={{ JSON.stringify($json) }}',
    }),
  ]
  // Your one-word replies to the daily digest (YES / STOP ALL / RESUME). Runs even while paused, so RESUME works.
  const O = "$('Read owner commands').first().json"
  nodes.push(
    ifTrue('Commands on?', [440, 420], "={{ !!$('Settings').first().json.owner_email }}"),
    node('Gmail: owner replies', 'n8n-nodes-base.gmail', 2.1, [660, 420], {
      resource: 'message',
      operation: 'getAll',
      returnAll: false,
      limit: 20,
      simple: true,
      filters: { q: "={{ 'from:' + $('Settings').first().json.owner_email + ' subject:\"Bear Radar\" newer_than:3d' }}" },
      options: {},
    }, { credentials: { gmailOAuth2: { id: 'bearGmail', name: 'Gmail account' } }, ...CONTINUE, ...once }),
    http('Recent digests', [880, 420], {
      url: `=${SB}/rest/v1/audit_log?select=details,created_at&action=eq.digest_sent&created_at=gte.{{ encodeURIComponent($now.minus({ days: 3 }).toUTC().toISO()) }}&order=created_at.desc&limit=20`,
      auth: { supabase: true },
    }, once),
    http('Handled commands', [1100, 420], {
      url: `=${SB}/rest/v1/audit_log?select=details&action=eq.owner_command&created_at=gte.{{ encodeURIComponent($now.minus({ days: 5 }).toUTC().toISO()) }}&limit=500`,
      auth: { supabase: true },
    }, once),
    node('Read owner commands', 'n8n-nodes-base.code', 2, [1320, 420], {
      mode: 'runOnceForAllItems',
      // Reads the Gmail results (not the Supabase lookups) as its input.
      jsCode: src('wf4-owner-commands.js').replace('$input.all()', "$('Gmail: owner replies').all()"),
    }),
    ifTrue('Approve drafts?', [1540, 420], `={{ ${O}.approve_ids.length > 0 }}`),
    http('Schedule approved drafts', [1760, 360], {
      method: 'PATCH',
      url: `=${SB}/rest/v1/outreach_queue?id=in.({{ ${O}.approve_ids.join(',') }})&status=eq.pending_review&channel=eq.email`,
      auth: { supabase: true },
      responseFormat: 'text',
      headers: [['Prefer', 'return=minimal']],
      body: "={{ JSON.stringify({ status: 'scheduled', approved_at: new Date().toISOString() }) }}",
    }),
    ifTrue('Pause changed?', [1980, 420], `={{ ${O}.pause !== null }}`),
    http('Save pause', [2200, 360], {
      method: 'POST',
      url: `=${SB}/rest/v1/settings?on_conflict=key`,
      auth: { supabase: true },
      responseFormat: 'text',
      headers: [['Prefer', 'resolution=merge-duplicates,return=minimal']],
      body: `={{ JSON.stringify([{ key: 'outreach', value: ${O}.settings_value, updated_at: new Date().toISOString() }]) }}`,
    }),
    ifTrue('Commands found?', [2420, 420], `={{ ${O}.audit.length > 0 }}`),
    http('Audit: owner commands', [2640, 360], {
      method: 'POST',
      url: `=${SB}/rest/v1/audit_log`,
      auth: { supabase: true },
      responseFormat: 'text',
      headers: [['Prefer', 'return=minimal']],
      body: `={{ JSON.stringify(${O}.audit) }}`,
    }),
    ifTrue('Confirm to owner?', [2860, 420], `={{ !!${O}.confirm }}`),
    node('Gmail: confirm to owner', 'n8n-nodes-base.gmail', 2.1, [3080, 360], {
      sendTo: "={{ $('Settings').first().json.owner_email }}",
      subject: 'Bear Radar: done',
      emailType: 'text',
      message: `={{ ${O}.confirm }}`,
      options: { appendAttribution: false },
    }, { credentials: { gmailOAuth2: { id: 'bearGmail', name: 'Gmail account' } }, ...CONTINUE }),
  )
  nodes.find(n => n.name === 'Find replies & bounces').alwaysOutputData = true
  const c = {}
  link(c, 'Every 30 minutes', 'Config')
  link(c, 'Dashboard: Check replies', 'Config')
  link(c, 'Config', 'Gmail: recent inbox')
  link(c, 'Gmail: recent inbox', 'Sent threads')
  link(c, 'Sent threads', 'Contacted leads')
  link(c, 'Contacted leads', 'Find replies & bounces')
  link(c, 'Find replies & bounces', 'Anything found?')
  link(c, 'Anything found?', 'Update lead', 0)
  link(c, 'Anything found?', 'Run summary', 1)
  link(c, 'Update lead', 'Cancel follow-ups')
  link(c, 'Cancel follow-ups', 'Run summary')
  link(c, 'Run summary', 'Write run log')
  link(c, 'Config', 'Commands on?')
  link(c, 'Commands on?', 'Gmail: owner replies', 0)
  link(c, 'Gmail: owner replies', 'Recent digests')
  link(c, 'Recent digests', 'Handled commands')
  link(c, 'Handled commands', 'Read owner commands')
  link(c, 'Read owner commands', 'Approve drafts?')
  link(c, 'Approve drafts?', 'Schedule approved drafts', 0)
  link(c, 'Approve drafts?', 'Pause changed?', 1)
  link(c, 'Schedule approved drafts', 'Pause changed?')
  link(c, 'Pause changed?', 'Save pause', 0)
  link(c, 'Pause changed?', 'Commands found?', 1)
  link(c, 'Save pause', 'Commands found?')
  link(c, 'Commands found?', 'Audit: owner commands', 0)
  link(c, 'Audit: owner commands', 'Confirm to owner?')
  link(c, 'Confirm to owner?', 'Gmail: confirm to owner', 0)
  return { name: 'WF-4: Reply Monitor', nodes, connections: c, settings: { executionOrder: 'v1' }, pinData: {} }
}

// =====================================================================================
// WF-6: Daily digest — one email to you with the drafts waiting, yesterday's results and problems.
//   Reply YES / STOP ALL / RESUME to it; WF-4 reads the reply.
// =====================================================================================
function buildWf6() {
  const once = { executeOnce: true, alwaysOutputData: true }
  const D = "$('Build digest').first().json"
  const nodes = [
    schedule('Every hour', [0, 0], { field: 'hours', hoursInterval: 1 }),
    webhook('Dashboard: Send digest', [0, 200], 'wf6-digest'),
    config('Config', [220, 100], {
      supabase_url: 'https://YOUR-PROJECT-REF.supabase.co',
      // Link in the email. Change it if you open the dashboard at another address.
      dashboard_url: 'http://localhost:3000',
      autopilot_mode: 'manual',
      digest_hour: 9,
      owner_email: '',
      timezone: 'Asia/Kolkata',
      daily_max: 20,
      send_window_start: 9,
      send_window_end: 18,
      paused: false,
      started_at: '={{ $now.toISO() }}',
    }),
    code('Digest due?', [440, 100], 'wf6-due.js'),
    ifTrue('Due?', [660, 100], '={{ $json.due }}'),
    http('Drafts waiting', [880, 0], {
      url: `=${SB}/rest/v1/outreach_queue?select=id,subject,body,created_at,leads(name,company,ai_score,email)&status=eq.pending_review&channel=eq.email&order=created_at.asc&limit=25`,
      auth: { supabase: true },
    }, once),
    http('Scheduled', [1100, 0], {
      url: `=${SB}/rest/v1/outreach_queue?select=id&status=eq.scheduled&limit=1000`,
      auth: { supabase: true },
    }, once),
    http('Sent last 24h', [1320, 0], {
      url: `=${SB}/rest/v1/outreach_queue?select=id&status=eq.sent&channel=eq.email&sent_at=gte.{{ encodeURIComponent($now.minus({ hours: 24 }).toUTC().toISO()) }}&limit=1000`,
      auth: { supabase: true },
    }, once),
    http('Replies last 24h', [1540, 0], {
      url: `=${SB}/rest/v1/leads?select=id,name,company,email&replied_at=gte.{{ encodeURIComponent($now.minus({ hours: 24 }).toUTC().toISO()) }}&limit=50`,
      auth: { supabase: true },
    }, once),
    http('Bounced last 24h', [1760, 0], {
      url: `=${SB}/rest/v1/leads?select=id&status=eq.bounced&updated_at=gte.{{ encodeURIComponent($now.minus({ hours: 24 }).toUTC().toISO()) }}&limit=500`,
      auth: { supabase: true },
    }, { ...once, ...CONTINUE }),
    http('Failures last 24h', [1980, 0], {
      url: `=${SB}/rest/v1/workflow_logs?select=workflow_name,errors,created_at&status=eq.failed&created_at=gte.{{ encodeURIComponent($now.minus({ hours: 24 }).toUTC().toISO()) }}&order=created_at.desc&limit=10`,
      auth: { supabase: true },
    }, once),
    http('Digest sent today?', [2200, 0], {
      url: `=${SB}/rest/v1/audit_log?select=id,created_at&action=eq.digest_sent&created_at=gte.{{ encodeURIComponent($('Digest due?').first().json.day_start) }}&limit=1`,
      auth: { supabase: true },
    }, once),
    code('Build digest', [2420, 0], 'wf6-build-digest.js'),
    ifTrue('Send it?', [2640, 0], '={{ $json.send }}'),
    node('Gmail: send digest', 'n8n-nodes-base.gmail', 2.1, [2860, -60], {
      sendTo: `={{ ${D}.to }}`,
      subject: `={{ ${D}.subject }}`,
      emailType: 'text',
      message: `={{ ${D}.body }}`,
      options: { appendAttribution: false, senderName: 'Bear Radar' },
    }, { credentials: { gmailOAuth2: { id: 'bearGmail', name: 'Gmail account' } }, ...RETRY }),
    http('Audit: digest sent', [3080, -60], {
      method: 'POST',
      url: `=${SB}/rest/v1/audit_log`,
      auth: { supabase: true },
      responseFormat: 'text',
      headers: [['Prefer', 'return=minimal']],
      body: `={{ JSON.stringify(${D}.audit) }}`,
    }),
    http('Write run log', [3300, -60], {
      method: 'POST',
      url: `=${SB}/rest/v1/workflow_logs`,
      auth: { supabase: true },
      responseFormat: 'text',
      headers: [['Prefer', 'return=minimal']],
      body: `={{ JSON.stringify(${D}.log) }}`,
    }),
  ]
  const c = {}
  link(c, 'Every hour', 'Config')
  link(c, 'Dashboard: Send digest', 'Config')
  link(c, 'Config', 'Digest due?')
  link(c, 'Digest due?', 'Due?')
  link(c, 'Due?', 'Drafts waiting', 0)
  link(c, 'Drafts waiting', 'Scheduled')
  link(c, 'Scheduled', 'Sent last 24h')
  link(c, 'Sent last 24h', 'Replies last 24h')
  link(c, 'Replies last 24h', 'Bounced last 24h')
  link(c, 'Bounced last 24h', 'Failures last 24h')
  link(c, 'Failures last 24h', 'Digest sent today?')
  link(c, 'Digest sent today?', 'Build digest')
  link(c, 'Build digest', 'Send it?')
  link(c, 'Send it?', 'Gmail: send digest', 0)
  link(c, 'Gmail: send digest', 'Audit: digest sent')
  link(c, 'Audit: digest sent', 'Write run log')
  return { name: 'WF-6: Daily Digest', nodes, connections: c, settings: { executionOrder: 'v1' }, pinData: {} }
}

// Dashboard Settings page -> Config keys, per workflow (see src/settings.js).
const SETTINGS_MAP = {
  wf1: { paused: 'paused' },
  wf2: { min_score: 'min_score', paused: 'paused' },
  wf3: {
    min_score: 'min_score', drafts_per_run: 'batch_size', follow_up_days: 'follow_up_days', draft_dms: 'draft_dms',
    sign_off: 'sign_off', signature_name: 'sender_name', company_name: 'company_name', website: 'website',
    paused: 'paused', autopilot_mode: 'autopilot_mode', auto_min_score: 'auto_min_score', daily_max: 'daily_max',
  },
  wf3b: {
    from_name: 'sender_name', daily_max: 'daily_max', send_window_start: 'send_window_start', send_window_end: 'send_window_end',
    send_on_weekends: 'send_on_weekends', timezone: 'timezone', paused: 'paused',
  },
  wf4: { paused: 'paused', owner_email: 'owner_email', autopilot_mode: 'autopilot_mode' },
  wf6: {
    paused: 'paused', autopilot_mode: 'autopilot_mode', digest_hour: 'digest_hour', owner_email: 'owner_email', timezone: 'timezone',
    daily_max: 'daily_max', send_window_start: 'send_window_start', send_window_end: 'send_window_end',
  },
}

/**
 * Config -> Load dashboard settings -> Settings -> (whatever Config fed before). Later nodes read $('Settings').
 * gate: also stop the run while paused (STOP ALL), via a "Paused?" check right after Settings.
 */
function withDashboardSettings(wf, map, { gate = false } = {}) {
  const cfg = wf.nodes.find(n => n.name === 'Config')
  const [x, y] = cfg.position
  for (const n of wf.nodes) if (n.position[0] > x) n.position = [n.position[0] + (gate ? 880 : 440), n.position[1]]
  wf.nodes.push(
    http('Load dashboard settings', [x + 220, y], {
      url: `=${SB}/rest/v1/settings?key=eq.outreach&select=value`,
      auth: { supabase: true },
      timeout: 15000,
    }, { executeOnce: true, alwaysOutputData: true, ...CONTINUE }),
    node('Settings', 'n8n-nodes-base.code', 2, [x + 440, y], {
      mode: 'runOnceForAllItems',
      jsCode: src('settings.js').replace('const MAP = {}', `const MAP = ${JSON.stringify(map)}`),
    }),
  )
  const c = wf.connections
  c.Config = { main: [[{ node: 'Load dashboard settings', type: 'main', index: 0 }]], ...{ _old: c.Config } }
  const targets = c.Config._old
  delete c.Config._old
  c['Load dashboard settings'] = { main: [[{ node: 'Settings', type: 'main', index: 0 }]] }
  if (!gate) {
    c.Settings = targets
    return wf
  }
  wf.nodes.push(
    ifTrue('Paused?', [x + 660, y], '={{ $json.paused === true }}'),
    node('Paused: skip this run', 'n8n-nodes-base.noOp', 1, [x + 880, y - 160], {}),
  )
  c.Settings = { main: [[{ node: 'Paused?', type: 'main', index: 0 }]] }
  c['Paused?'] = { main: [[{ node: 'Paused: skip this run', type: 'main', index: 0 }], targets.main[0]] }
  return wf
}

for (const [file, wf] of [
  ['WF1-lead-radar-sources.json', withDashboardSettings(buildWf1(), SETTINGS_MAP.wf1, { gate: true })],
  ['WF2-qualify-enrich.json', withDashboardSettings(buildWf2(), SETTINGS_MAP.wf2, { gate: true })],
  ['WF3-draft-outreach.json', withDashboardSettings(buildWf3(), SETTINGS_MAP.wf3, { gate: true })],
  // WF-3b: the pause is checked in "Can send now?" (scheduled sends); the dashboard refuses to send while paused.
  ['WF3b-send-approved.json', withDashboardSettings(buildWf3b(), SETTINGS_MAP.wf3b)],
  // WF-4 keeps running while paused: it only protects (stops follow-ups to people who replied) and reads RESUME.
  ['WF4-reply-monitor.json', withDashboardSettings(buildWf4(), SETTINGS_MAP.wf4)],
  ['WF6-daily-digest.json', withDashboardSettings(buildWf6(), SETTINGS_MAP.wf6)],
]) {
  writeFileSync(out(file), JSON.stringify(wf, null, 2) + '\n')
  console.log(`wrote n8n-workflows/${file} (${wf.nodes.length} nodes)`)
}
