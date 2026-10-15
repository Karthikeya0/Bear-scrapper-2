// Builds the import-ready n8n workflows for Bear Radar from the Code-node sources in ./src.
//   node n8n-workflows/radar/build.mjs
// Output: n8n-workflows/WF1-lead-radar-sources.json and n8n-workflows/WF2-qualify-enrich.json

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
function http(name, pos, { method = 'GET', url, auth, headers = [], query = [], body, responseFormat = 'json', timeout = 30000 }, extra = {}) {
  const p = { method, url, options: { timeout, response: { response: { responseFormat } } } }
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
    http('Hunter: founder email', [1120, 0], {
      url: "={{ $('Config').first().json.hunter_url }}",
      auth: { header: CRED.hunter },
      query: [['domain', '={{ $json.company_domain }}'], ['limit', '10']],
    }, CONTINUE),
    code('Pick founder email', [1340, 0], 'wf2-pick-email.js', 'runOnceForEachItem'),
    ifTrue('Has email?', [1560, 0], '={{ !!$json.email }}'),
    http('Groq: score lead', [1780, -100], {
      method: 'POST',
      url: "={{ $('Config').first().json.groq_url }}",
      auth: { header: CRED.groq },
      body:
        "={{ JSON.stringify({ model: $('Config').first().json.groq_model, temperature: 0.2, response_format: { type: 'json_object' }, messages: [ { role: 'system', content: " +
        JSON.stringify(GROQ_SYSTEM) +
        " }, { role: 'user', content: ['Company: ' + ($json.company || '?'), 'Website: ' + $json.website, 'Source: ' + $json.source, 'Launched: ' + ($json.launched_at || 'unknown'), 'Team size: ' + ($json.team_size || 'unknown'), 'Homepage has a video: ' + ($json.has_video === null ? 'unknown' : $json.has_video), 'Signals: ' + ($json.signals || []).join(', '), 'Founder: ' + ($json.name || '?') + ($json.founder_role ? ' (' + $json.founder_role + ')' : ''), 'About: ' + String($json.post_content || '').slice(0, 1500)].join('\\n') } ] }) }}",
    }, CONTINUE),
    code('Build lead row', [2000, -100], 'wf2-build-lead.js', 'runOnceForEachItem'),
    http('Save lead', [2220, -100], {
      method: 'POST',
      url: `=${SB}/rest/v1/leads?on_conflict=raw_lead_id`,
      auth: { supabase: true },
      responseFormat: 'text',
      headers: [['Prefer', 'resolution=ignore-duplicates,return=minimal']],
      body: '={{ JSON.stringify($json) }}',
    }, { alwaysOutputData: true }),
    http('Mark processed', [2440, -100], {
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
  link(c, 'Qualified?', 'Hunter: founder email', 0)
  link(c, 'Qualified?', 'Save disqualified', 1)
  link(c, 'Hunter: founder email', 'Pick founder email')
  link(c, 'Pick founder email', 'Has email?')
  link(c, 'Has email?', 'Groq: score lead', 0)
  link(c, 'Has email?', 'Save disqualified', 1)
  link(c, 'Groq: score lead', 'Build lead row')
  link(c, 'Build lead row', 'Save lead')
  link(c, 'Save lead', 'Mark processed')
  return { name: 'WF-2: Qualify & Enrich', nodes, connections: c, settings: { executionOrder: 'v1' }, pinData: {} }
}

for (const [file, wf] of [['WF1-lead-radar-sources.json', buildWf1()], ['WF2-qualify-enrich.json', buildWf2()]]) {
  writeFileSync(out(file), JSON.stringify(wf, null, 2) + '\n')
  console.log(`wrote n8n-workflows/${file} (${wf.nodes.length} nodes)`)
}
