// Builds the import-ready n8n workflows for PODCAST outreach from the Code-node sources in ./src.
//   node n8n-workflows/podcast/build.mjs
// Output: n8n-workflows/WFP1-podcast-find.json … WFP5-podcast-sheet.json
//
// This is a separate pipeline from Bear Radar (startups). It reads/writes only podcast_leads and
// podcast_outreach (migration 007), so WF-1 … WF-6 are untouched and never see podcast rows.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const src = name => readFileSync(join(here, 'src', name), 'utf8')
const out = name => join(here, '..', name)

let seq = 0
const id = prefix => `${prefix}-0000-4000-8000-${String(++seq).padStart(12, '0')}`

// Same credential names as the Bear Radar workflows, plus YouTube and Google Sheets.
const CRED = {
  dashboard: { httpHeaderAuth: { id: 'bearDashboardSecret', name: 'Bear dashboard secret' } },
  supabase: { supabaseApi: { id: 'bearSupabase', name: 'Supabase account' } },
  groq: { httpHeaderAuth: { id: 'bearGroq', name: 'Groq API key' } },
  youtube: { httpQueryAuth: { id: 'bearYouTube', name: 'YouTube API key' } },
  gmail: { gmailOAuth2: { id: 'bearGmail', name: 'Gmail account' } },
  sheets: { googleSheetsOAuth2Api: { id: 'bearSheets', name: 'Google Sheets account' } },
}

const node = (name, type, typeVersion, position, parameters, extra = {}) => ({ id: id('9d1c4b70'), name, type, typeVersion, position, parameters, ...extra })
const schedule = (name, pos, interval) => node(name, 'n8n-nodes-base.scheduleTrigger', 1.2, pos, { rule: { interval: [interval] } })
const webhook = (name, pos, path) =>
  node(name, 'n8n-nodes-base.webhook', 2, pos, { httpMethod: 'POST', path, authentication: 'headerAuth', responseMode: 'onReceived', options: {} },
    { webhookId: id('5a2e9c31'), credentials: CRED.dashboard })
const config = (name, pos, values) =>
  node(name, 'n8n-nodes-base.set', 3.4, pos, {
    mode: 'manual',
    assignments: {
      assignments: Object.entries(values).map(([key, value]) => ({
        id: id('c7d3e100'), name: key, value,
        type: typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'string',
      })),
    },
    includeOtherFields: false,
    options: {},
  })
const code = (name, pos, file, mode = 'runOnceForAllItems', extra = {}) => node(name, 'n8n-nodes-base.code', 2, pos, { mode, jsCode: src(file) }, extra)
const inline = (name, pos, jsCode, mode = 'runOnceForAllItems', extra = {}) => node(name, 'n8n-nodes-base.code', 2, pos, { mode, jsCode }, extra)

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
  } else if (auth?.query) {
    p.authentication = 'genericCredentialType'
    p.genericAuthType = 'httpQueryAuth'
    credentials = auth.query
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
      conditions: [{ id: id('2e0d1c00'), leftValue: expr, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
      combinator: 'and',
    },
    options: {},
  })

const link = (c, from, to, outputIndex = 0, inputIndex = 0) => {
  c[from] ??= { main: [] }
  while (c[from].main.length <= outputIndex) c[from].main.push([])
  c[from].main[outputIndex].push({ node: to, type: 'main', index: inputIndex })
}

const SB = "{{ $('Config').first().json.supabase_url }}"
const YT = 'https://www.googleapis.com/youtube/v3'
const CONTINUE = { onError: 'continueRegularOutput' }
const RETRY = { retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 }
const ONCE = { executeOnce: true, alwaysOutputData: true }
const GROQ_MODEL = 'openai/gpt-oss-120b'
const groqBody = (system, userExpr, temperature) =>
  "={{ JSON.stringify({ model: $('Config').first().json.groq_model, temperature: " + temperature + ", max_completion_tokens: 2048, " +
  "...(String($('Config').first().json.groq_model).startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : {}), " +
  'messages: [ { role: \'system\', content: ' + system + ' }, { role: \'user\', content: ' + userExpr + ' } ] }) }}'

const logRun = (name, pos, bodyExpr = '={{ JSON.stringify($json) }}') =>
  http(name, pos, { method: 'POST', url: `=${SB}/rest/v1/workflow_logs`, auth: { supabase: true }, responseFormat: 'text', headers: [['Prefer', 'return=minimal']], body: bodyExpr })

/** Config -> Load settings (outreach + podcast rows) -> Settings -> [Paused? gate] -> first node. */
function settingsChain(nodes, c, first, { gate = true, x = 240, y = 100 } = {}) {
  nodes.push(
    http('Load dashboard settings', [x + 220, y], {
      url: `=${SB}/rest/v1/settings?key=in.(outreach,podcast)&select=key,value`,
      auth: { supabase: true },
      timeout: 15000,
    }, { executeOnce: true, alwaysOutputData: true, ...CONTINUE }),
    code('Settings', [x + 440, y], 'settings.js'),
  )
  link(c, 'Config', 'Load dashboard settings')
  link(c, 'Load dashboard settings', 'Settings')
  if (!gate) return link(c, 'Settings', first)
  nodes.push(ifTrue('Paused?', [x + 660, y], '={{ $json.paused === true }}'), node('Paused: skip this run', 'n8n-nodes-base.noOp', 1, [x + 880, y - 160], {}))
  link(c, 'Settings', 'Paused?')
  link(c, 'Paused?', 'Paused: skip this run', 0)
  link(c, 'Paused?', first, 1)
}

const BASE_CONFIG = {
  supabase_url: 'https://YOUR-PROJECT-REF.supabase.co',
  paused: false,
  timezone: 'Asia/Kolkata',
  send_window_start: 9,
  send_window_end: 18,
  send_on_weekends: false,
  from_name: 'Karthikeya | Bear Studios',
  sign_off: 'Cheers,',
  signature_name: 'Karthikeya Popuri',
  company_name: 'Bear Studios',
  website: 'bearstudios.in',
  daily_max: 10,
  min_subscribers: 1000,
  max_subscribers: 25000,
  min_uploads_30d: 2,
  min_episode_minutes: 30,
  searches_per_run: 20,
  follow_up_days: '4,7',
  draft_dms: true,
  autopilot: 'manual',
  sheet_url: '',
  added_by: 'Bear Radar',
  groq_url: 'https://api.groq.com/openai/v1/chat/completions',
  groq_model: GROQ_MODEL,
  started_at: '={{ $now.toISO() }}',
}

// =====================================================================================
// WF-P1: Find podcasts on YouTube (SOP section 4)
// =====================================================================================
function buildP1() {
  const c = {}
  const nodes = [
    schedule('Twice a day', [0, 0], { field: 'hours', hoursInterval: 12 }),
    webhook('Dashboard: Find podcasts', [0, 200], 'wfp1-podcast-find'),
    config('Config', [240, 100], BASE_CONFIG),
    code('Plan searches', [1340, 100], 'p1-plan-searches.js'),
    http('YouTube: search', [1560, 100], {
      url: `${YT}/search`,
      auth: { query: CRED.youtube },
      query: [
        ['part', 'snippet'], ['type', 'video'], ['maxResults', '50'], ['q', '={{ $json.q }}'], ['videoDuration', 'long'],
        ['publishedAfter', '={{ $json.publishedAfter }}'], ['relevanceLanguage', 'en'],
      ],
      batching: { batchSize: 1, batchInterval: 300 },
    }, CONTINUE),
    code('Collect channels', [1780, 100], 'p1-collect.js'),
    http('Save new podcasts', [2000, 100], {
      method: 'POST',
      url: `=${SB}/rest/v1/podcast_leads?on_conflict=youtube_channel_id`,
      auth: { supabase: true },
      headers: [['Prefer', 'resolution=ignore-duplicates,return=representation']],
      body: '={{ JSON.stringify($json.rows) }}',
    }, { alwaysOutputData: true }),
    code('Run summary', [2220, 100], 'p1-summary.js'),
    logRun('Write run log', [2440, 100]),
  ]
  link(c, 'Twice a day', 'Config')
  link(c, 'Dashboard: Find podcasts', 'Config')
  settingsChain(nodes, c, 'Plan searches')
  link(c, 'Plan searches', 'YouTube: search')
  link(c, 'YouTube: search', 'Collect channels')
  link(c, 'Collect channels', 'Save new podcasts')
  link(c, 'Save new podcasts', 'Run summary')
  link(c, 'Run summary', 'Write run log')
  return { name: 'WF-P1: Find Podcasts (YouTube)', nodes, connections: c, settings: { executionOrder: 'v1' }, pinData: {} }
}

// =====================================================================================
// WF-P2: Qualify podcasts against the SOP (sections 2 and 5)
// =====================================================================================
const QUALIFY_SYSTEM =
  'You help Bear Studios qualify small podcasts that publish full episodes on YouTube, for a clip-repurposing, trailer and podcast-editing offer. ' +
  'From the channel facts decide: is it really a podcast or talk show (not a music, gaming, news-clip or compilation channel); is it in English; ' +
  'its format: "talking-head", "interview", "conversation", "audio-only" (static image / waveform), "music" or "other"; is it owned by a big network, ' +
  'media company or brand rather than run by the host or a small team; the main host\'s full name if stated; and a one-line "why a fit" note for a salesperson ' +
  '(e.g. "Weekly 60-min founder interviews, strong guests, no clips"). Score 0-100 how good a lead it is (regular long episodes, few shorts, real guests, small and independent). ' +
  'If you are not sure, set unsure to true. Output ONLY JSON: {"is_podcast": true, "english": true, "format": "...", "network_owned": false, "host_name": "... or unknown", ' +
  '"why_fit": "...", "score": 0, "unsure": false}'

function buildP2() {
  const c = {}
  const nodes = [
    schedule('Every hour', [0, 0], { field: 'hours', hoursInterval: 1 }),
    webhook('Dashboard: Qualify podcasts', [0, 200], 'wfp2-podcast-qualify'),
    config('Config', [240, 100], { ...BASE_CONFIG, batch_size: 40 }),
    http('Fetch found podcasts', [1340, 100], {
      url: `=${SB}/rest/v1/podcast_leads?stage=eq.found&select=id,youtube_channel_id,podcast_name,niche&order=created_at.asc&limit={{ $('Config').first().json.batch_size }}`,
      auth: { supabase: true },
    }),
    // Up to 50 channels in one call (1 quota unit).
    http('YouTube: channels', [1560, 100], {
      url: `${YT}/channels`,
      auth: { query: CRED.youtube },
      query: [['part', 'snippet,statistics,contentDetails,brandingSettings'], ['maxResults', '50'], ['id', "={{ $('Fetch found podcasts').all().map(i => i.json.youtube_channel_id).filter(Boolean).join(',') }}"]],
    }, { ...CONTINUE, executeOnce: true }),
    code('Channel checks', [1780, 100], 'p2-channel-checks.js'),
    ifTrue('Subscribers OK?', [2000, 100], '={{ $json.ok }}'),
    http('Uploads', [2220, 0], {
      url: `${YT}/playlistItems`,
      auth: { query: CRED.youtube },
      query: [['part', 'contentDetails'], ['maxResults', '50'], ['playlistId', '={{ $json.uploads_playlist }}']],
      batching: { batchSize: 1, batchInterval: 100 },
    }, CONTINUE),
    http('Video details', [2440, 0], {
      url: `${YT}/videos`,
      auth: { query: CRED.youtube },
      query: [['part', 'snippet,contentDetails,statistics'], ['maxResults', '50'], ['id', '={{ ($json.items || []).map(i => i.contentDetails && i.contentDetails.videoId).filter(Boolean).slice(0, 50).join(\',\') || \'none\' }}']],
      batching: { batchSize: 1, batchInterval: 100 },
    }, CONTINUE),
    // 404 = the channel has no Shorts (that's good for us), so errors continue.
    http('Shorts', [2660, 0], {
      url: `${YT}/playlistItems`,
      auth: { query: CRED.youtube },
      query: [['part', 'contentDetails'], ['maxResults', '50'], ['playlistId', "={{ $('Channel checks').item.json.shorts_playlist }}"]],
      batching: { batchSize: 1, batchInterval: 100 },
    }, CONTINUE),
    code('SOP checks', [2880, 0], 'p2-prepare.js', 'runOnceForEachItem'),
    ifTrue('Passed hard checks?', [3100, 0], '={{ !$json.hard_skip }}'),
    http('AI: judge show', [3320, -100], {
      method: 'POST',
      url: "={{ $('Config').first().json.groq_url }}",
      auth: { header: CRED.groq },
      timeout: 60000,
      batching: { batchSize: 1, batchInterval: 2500 },
      body: groqBody(JSON.stringify(QUALIFY_SYSTEM), '$json.prompt', 0.2),
    }, { ...CONTINUE, ...RETRY }),
    code('Build row', [3540, -100], 'p2-build-row.js', 'runOnceForEachItem'),
    http('Save checked podcast', [3760, -100], {
      method: 'PATCH',
      url: `=${SB}/rest/v1/podcast_leads?id=eq.{{ $json.id }}`,
      auth: { supabase: true },
      responseFormat: 'text',
      headers: [['Prefer', 'return=minimal']],
      body: '={{ JSON.stringify($json.patch) }}',
    }, CONTINUE),
    http('Save skipped', [3320, 200], {
      method: 'PATCH',
      url: `=${SB}/rest/v1/podcast_leads?id=eq.{{ $json.id }}`,
      auth: { supabase: true },
      responseFormat: 'text',
      headers: [['Prefer', 'return=minimal']],
      body: '={{ JSON.stringify($json.patch) }}',
    }, CONTINUE),
    // Runs after the branch above has finished (it sits lower on the canvas; execution order v1).
    code('Run summary', [1780, 420], 'p2-summary.js', 'runOnceForAllItems', { executeOnce: true }),
    logRun('Write run log', [2000, 420]),
  ]
  link(c, 'Every hour', 'Config')
  link(c, 'Dashboard: Qualify podcasts', 'Config')
  settingsChain(nodes, c, 'Fetch found podcasts')
  link(c, 'Fetch found podcasts', 'YouTube: channels')
  link(c, 'YouTube: channels', 'Channel checks')
  link(c, 'YouTube: channels', 'Run summary')
  link(c, 'Channel checks', 'Subscribers OK?')
  link(c, 'Subscribers OK?', 'Uploads', 0)
  link(c, 'Subscribers OK?', 'Save skipped', 1)
  link(c, 'Uploads', 'Video details')
  link(c, 'Video details', 'Shorts')
  link(c, 'Shorts', 'SOP checks')
  link(c, 'SOP checks', 'Passed hard checks?')
  link(c, 'Passed hard checks?', 'AI: judge show', 0)
  link(c, 'Passed hard checks?', 'Save skipped', 1)
  link(c, 'AI: judge show', 'Build row')
  link(c, 'Build row', 'Save checked podcast')
  link(c, 'Run summary', 'Write run log')
  return { name: 'WF-P2: Qualify Podcasts (SOP checks)', nodes, connections: c, settings: { executionOrder: 'v1' }, pinData: {} }
}

// =====================================================================================
// WF-P3: Draft podcast outreach -> podcast_outreach (pending_review, or scheduled on autopilot)
// =====================================================================================
function buildP3() {
  const c = {}
  const nodes = [
    schedule('Every 3 hours', [0, 0], { field: 'hours', hoursInterval: 3 }),
    webhook('Dashboard: Draft podcast outreach', [0, 200], 'wfp3-podcast-draft'),
    config('Config', [240, 100], { ...BASE_CONFIG, batch_size: 10 }),
    http('Fetch podcasts to draft', [1340, 100], {
      url:
        `=${SB}/rest/v1/podcast_leads?select=*,podcast_outreach(id)&podcast_outreach=is.null&stage=eq.qualified` +
        '&status=in.(New,%22Sample%20made%22)&or=(email.not.is.null,instagram_url.not.is.null)&order=ai_score.desc.nullslast&limit=100',
      auth: { supabase: true },
    }, ONCE),
    http('Fetch follow-ups', [1560, 100], {
      url: `=${SB}/rest/v1/podcast_leads?select=*,podcast_outreach(id,subject,body,status,sequence_step,sent_at,channel)&status=eq.Email%20sent&email=not.is.null&order=first_contacted_at.asc&limit=200`,
      auth: { supabase: true },
    }, ONCE),
    http('Waiting drafts', [1780, 100], {
      url: `=${SB}/rest/v1/podcast_outreach?select=id&channel=eq.email&status=in.(pending_review,scheduled)&limit=1000`,
      auth: { supabase: true },
    }, ONCE),
    code('Plan drafts', [2000, 100], 'p3-plan.js', 'runOnceForAllItems', { alwaysOutputData: true }),
    ifTrue('Anything to draft?', [2220, 100], '={{ !!$json.podcast_id }}'),
    node('One at a time', 'n8n-nodes-base.splitInBatches', 3, [2440, 100], { batchSize: 1, options: {} }),
    http('AI: write message', [2660, 0], {
      method: 'POST',
      url: "={{ $('Config').first().json.groq_url }}",
      auth: { header: CRED.groq },
      timeout: 45000,
      body: groqBody('$json.system', '$json.user', 0.6),
    }, { ...CONTINUE, ...RETRY }),
    code('Build drafts', [2880, 0], 'p3-build-drafts.js'),
    ifTrue('Any drafts?', [3100, 0], '={{ $json.rows.length > 0 }}'),
    http('Queue for review', [3320, -100], {
      method: 'POST',
      url: `=${SB}/rest/v1/podcast_outreach`,
      auth: { supabase: true },
      responseFormat: 'text',
      headers: [['Prefer', 'return=minimal']],
      body: '={{ JSON.stringify($json.rows) }}',
    }, { alwaysOutputData: true }),
    inline('Next draft', [3540, -100], "// Hand this draft's result back to the loop (Run summary adds them up).\nreturn [{ json: $('Build drafts').first().json }]\n"),
    code('Run summary', [2880, 260], 'p3-summary.js'),
    logRun('Write run log', [3100, 260]),
  ]
  link(c, 'Every 3 hours', 'Config')
  link(c, 'Dashboard: Draft podcast outreach', 'Config')
  settingsChain(nodes, c, 'Fetch podcasts to draft')
  link(c, 'Fetch podcasts to draft', 'Fetch follow-ups')
  link(c, 'Fetch follow-ups', 'Waiting drafts')
  link(c, 'Waiting drafts', 'Plan drafts')
  link(c, 'Plan drafts', 'Anything to draft?')
  link(c, 'Anything to draft?', 'One at a time', 0)
  link(c, 'Anything to draft?', 'Run summary', 1)
  link(c, 'One at a time', 'Run summary', 0)
  link(c, 'One at a time', 'AI: write message', 1)
  link(c, 'AI: write message', 'Build drafts')
  link(c, 'Build drafts', 'Any drafts?')
  link(c, 'Any drafts?', 'Queue for review', 0)
  link(c, 'Any drafts?', 'One at a time', 1)
  link(c, 'Queue for review', 'Next draft')
  link(c, 'Next draft', 'One at a time')
  link(c, 'Run summary', 'Write run log')
  return { name: 'WF-P3: Draft Podcast Outreach', nodes, connections: c, settings: { executionOrder: 'v1' }, pinData: {} }
}

// =====================================================================================
// WF-P3b: Send podcast emails — hard cap of daily_max (10) a day, including dashboard sends
// =====================================================================================
function buildP3b() {
  const c = {}
  const Q = "$('Fetch approved email').first().json"
  const gmail = { credentials: CRED.gmail, ...CONTINUE }
  const gmailOptions = { appendAttribution: false, senderName: "={{ $('Settings').first().json.from_name }}" }
  const P = "$('Pick email').first().json"
  const nodes = [
    webhook('Dashboard: Send podcast email', [0, 0], 'wfp3b-podcast-send'),
    schedule('Every 10 minutes', [0, 240], { field: 'minutes', minutesInterval: 10 }),
    config('Config', [240, 100], BASE_CONFIG),
    http('Sent today', [900, 100], {
      url:
        `=${SB}/rest/v1/podcast_outreach?select=id&status=eq.sent&channel=eq.email` +
        "&sent_at=gte.{{ encodeURIComponent($now.setZone($('Settings').first().json.timezone).startOf('day').toUTC().toISO()) }}&limit=1000",
      auth: { supabase: true },
    }, ONCE),
    http('Next scheduled', [1120, 100], {
      url: `=${SB}/rest/v1/podcast_outreach?select=id&status=eq.scheduled&channel=eq.email&order=approved_at.asc.nullslast,created_at.asc&limit=1`,
      auth: { supabase: true },
    }, ONCE),
    code('Pick email', [1340, 100], 'p3b-pick.js'),
    ifTrue('Over the daily limit?', [1560, 100], "={{ $json.mode === 'over_limit' }}"),
    http('Limit: back to review', [1780, 260], {
      method: 'PATCH',
      url: `=${SB}/rest/v1/podcast_outreach?id=eq.{{ $json.outreach_id }}&status=eq.approved`,
      auth: { supabase: true },
      responseFormat: 'text',
      headers: [['Prefer', 'return=minimal']],
      body: "={{ JSON.stringify({ status: 'scheduled', error: $json.paused ? 'Paused (STOP ALL): will send after you resume.' : 'Daily podcast limit reached (' + $json.max + '): it will go out on the next sending day.' }) }}",
    }),
    ifTrue('Scheduled send?', [1780, 0], "={{ $json.mode === 'scheduled' }}"),
    // scheduled -> approved; only one run can claim a row, so nothing is sent twice.
    http('Claim scheduled', [2000, -100], {
      method: 'PATCH',
      url: `=${SB}/rest/v1/podcast_outreach?id=eq.{{ $json.outreach_id }}&status=eq.scheduled`,
      auth: { supabase: true },
      headers: [['Prefer', 'return=representation']],
      body: "={{ JSON.stringify({ status: 'approved', approved_at: new Date().toISOString() }) }}",
    }),
    http('Fetch approved email', [2220, 0], {
      url:
        `=${SB}/rest/v1/podcast_outreach?id=eq.{{ ${P}.outreach_id }}&status=eq.approved` +
        '&select=id,podcast_id,subject,body,sequence_step,channel,podcast_leads(id,email,podcast_name,status)',
      auth: { supabase: true },
    }, ONCE),
    ifTrue('Ready to send?', [2440, 0],
      "={{ !!$json.id && $json.channel === 'email' && !!($json.podcast_leads && $json.podcast_leads.email) && !['Replied', 'Won', 'Dead'].includes($json.podcast_leads.status) }}"),
    http('Previous message', [2660, -100], {
      url: `=${SB}/rest/v1/podcast_outreach?select=message_id,thread_id&podcast_id=eq.{{ ${Q}.podcast_id }}&status=eq.sent&message_id=not.is.null&order=sent_at.desc&limit=1`,
      auth: { supabase: true },
    }, ONCE),
    ifTrue('Reply in thread?', [2880, -100], `={{ (${Q}.sequence_step || 1) > 1 && !!$json.message_id && !!$json.thread_id }}`),
    node('Gmail: reply', 'n8n-nodes-base.gmail', 2.1, [3100, -200], {
      resource: 'thread',
      operation: 'reply',
      threadId: '={{ $json.thread_id }}',
      messageId: '={{ $json.message_id }}',
      emailType: 'text',
      message: `={{ ${Q}.body }}`,
      options: { ...gmailOptions, replyToRecipientsOnly: true },
    }, gmail),
    node('Gmail: send', 'n8n-nodes-base.gmail', 2.1, [3100, 0], {
      sendTo: `={{ ${Q}.podcast_leads.email }}`,
      subject: `={{ ${Q}.subject }}`,
      emailType: 'text',
      message: `={{ ${Q}.body }}`,
      options: gmailOptions,
    }, gmail),
    inline('Send result', [3320, -100],
      "const r = $json || {}\nreturn { json: { ok: !!r.id && !r.error, message_id: r.id || null, thread_id: r.threadId || null, error: r.error ? String(r.error.message || r.error).slice(0, 300) : null } }\n",
      'runOnceForEachItem'),
    ifTrue('Sent?', [3540, -100], '={{ $json.ok }}'),
    http('Mark sent', [3760, -200], {
      method: 'PATCH',
      url: `=${SB}/rest/v1/podcast_outreach?id=eq.{{ ${Q}.id }}`,
      auth: { supabase: true },
      responseFormat: 'text',
      headers: [['Prefer', 'return=minimal']],
      body: "={{ JSON.stringify({ status: 'sent', sent_at: new Date().toISOString(), thread_id: $json.thread_id, message_id: $json.message_id, error: null }) }}",
    }),
    // Only moves New / Sample made -> Email sent, so a show that already replied is never downgraded.
    http('Mark podcast emailed', [3980, -200], {
      method: 'PATCH',
      url: `=${SB}/rest/v1/podcast_leads?id=eq.{{ ${Q}.podcast_id }}&status=in.(New,%22Sample%20made%22,%22DM%20sent%22)`,
      auth: { supabase: true },
      responseFormat: 'text',
      headers: [['Prefer', 'return=minimal']],
      body: "={{ JSON.stringify({ status: 'Email sent', first_contacted_at: new Date().toISOString() }) }}",
    }),
    logRun('Log sent', [4200, -200],
      "={{ JSON.stringify({ workflow_name: 'WF-P3b-PodcastSend', status: 'success', emails_sent: 1, started_at: $('Config').first().json.started_at, finished_at: new Date().toISOString() }) }}"),
    http('Return to review', [3760, 100], {
      method: 'PATCH',
      url: `=${SB}/rest/v1/podcast_outreach?id=eq.{{ ${Q}.id }}&status=eq.approved`,
      auth: { supabase: true },
      responseFormat: 'text',
      headers: [['Prefer', 'return=minimal']],
      body: "={{ JSON.stringify({ status: 'pending_review', approved_at: null, error: 'Gmail send failed: ' + String($('Send result').first().json.error || 'unknown error') }) }}",
    }),
    logRun('Log failure', [3980, 100],
      "={{ JSON.stringify({ workflow_name: 'WF-P3b-PodcastSend', status: 'failed', emails_sent: 0, started_at: $('Config').first().json.started_at, finished_at: new Date().toISOString(), " +
      "errors: [{ outreach_id: $('Pick email').first().json.outreach_id, message: $('Send result').isExecuted ? 'Gmail send failed (email returned to review): ' + String($('Send result').first().json.error || 'unknown') : 'Not sent: not approved any more, a DM, no email address, or the show already replied.' }] }) }}"),
  ]
  link(c, 'Dashboard: Send podcast email', 'Config')
  link(c, 'Every 10 minutes', 'Config')
  settingsChain(nodes, c, 'Sent today', { gate: false })
  link(c, 'Sent today', 'Next scheduled')
  link(c, 'Next scheduled', 'Pick email')
  link(c, 'Pick email', 'Over the daily limit?')
  link(c, 'Over the daily limit?', 'Limit: back to review', 0)
  link(c, 'Over the daily limit?', 'Scheduled send?', 1)
  link(c, 'Scheduled send?', 'Claim scheduled', 0)
  link(c, 'Scheduled send?', 'Fetch approved email', 1)
  link(c, 'Claim scheduled', 'Fetch approved email')
  link(c, 'Fetch approved email', 'Ready to send?')
  link(c, 'Ready to send?', 'Previous message', 0)
  link(c, 'Ready to send?', 'Log failure', 1)
  link(c, 'Previous message', 'Reply in thread?')
  link(c, 'Reply in thread?', 'Gmail: reply', 0)
  link(c, 'Reply in thread?', 'Gmail: send', 1)
  link(c, 'Gmail: reply', 'Send result')
  link(c, 'Gmail: send', 'Send result')
  link(c, 'Send result', 'Sent?')
  link(c, 'Sent?', 'Mark sent', 0)
  link(c, 'Sent?', 'Return to review', 1)
  link(c, 'Mark sent', 'Mark podcast emailed')
  link(c, 'Mark podcast emailed', 'Log sent')
  link(c, 'Return to review', 'Log failure')
  return { name: 'WF-P3b: Send Podcast Emails (max 10/day)', nodes, connections: c, settings: { executionOrder: 'v1' }, pinData: {} }
}

// =====================================================================================
// WF-P4: Podcast reply monitor — Replied / Dead (bounced), cancels unsent follow-ups
// =====================================================================================
function buildP4() {
  const c = {}
  const F = "$('Find replies & bounces').item.json"
  const nodes = [
    schedule('Every 30 minutes', [0, 0], { field: 'minutes', minutesInterval: 30 }),
    webhook('Dashboard: Check podcast replies', [0, 200], 'wfp4-podcast-replies'),
    config('Config', [240, 100], { supabase_url: BASE_CONFIG.supabase_url, lookback_days: 3, started_at: '={{ $now.toISO() }}' }),
    node('Gmail: recent inbox', 'n8n-nodes-base.gmail', 2.1, [460, 100], {
      resource: 'message',
      operation: 'getAll',
      returnAll: false,
      limit: 100,
      simple: true,
      filters: { q: "={{ 'in:inbox newer_than:' + $('Config').first().json.lookback_days + 'd -from:me' }}" },
      options: {},
    }, { credentials: CRED.gmail, ...CONTINUE, ...ONCE }),
    http('Sent threads', [680, 100], {
      url: `=${SB}/rest/v1/podcast_outreach?select=podcast_id,thread_id&status=eq.sent&thread_id=not.is.null&order=sent_at.desc&limit=2000`,
      auth: { supabase: true },
    }, ONCE),
    http('Emailed podcasts', [900, 100], {
      url: `=${SB}/rest/v1/podcast_leads?select=id,email&status=eq.Email%20sent&email=not.is.null&limit=5000`,
      auth: { supabase: true },
    }, ONCE),
    code('Find replies & bounces', [1120, 100], 'p4-find-replies.js', 'runOnceForAllItems', { alwaysOutputData: true }),
    ifTrue('Anything found?', [1340, 100], '={{ !!$json.podcast_id }}'),
    http('Update podcast', [1560, 0], {
      method: 'PATCH',
      url: `=${SB}/rest/v1/podcast_leads?id=eq.{{ $json.podcast_id }}&status=eq.Email%20sent`,
      auth: { supabase: true },
      responseFormat: 'text',
      headers: [['Prefer', 'return=minimal']],
      body: "={{ JSON.stringify($json.kind === 'replied' ? { status: 'Replied', replied_at: $json.replied_at } : { status: 'Dead', skip_reason: 'Email bounced' }) }}",
    }),
    http('Cancel follow-ups', [1780, 0], {
      method: 'PATCH',
      url: `=${SB}/rest/v1/podcast_outreach?podcast_id=eq.{{ ${F}.podcast_id }}&status=in.(pending_review,scheduled)`,
      auth: { supabase: true },
      responseFormat: 'text',
      headers: [['Prefer', 'return=minimal']],
      body: "={{ JSON.stringify({ status: 'rejected', rejected_at: new Date().toISOString() }) }}",
    }),
    inline('Run summary', [2000, 100],
      "const cfg = $('Config').first().json\nconst found = $('Find replies & bounces').all().map(i => i.json).filter(f => f && f.podcast_id)\n" +
      "const gmailError = $('Gmail: recent inbox').all().map(i => i.json).find(m => m && m.error)\n" +
      "return [{ json: { workflow_name: 'WF-P4-PodcastReplies', status: gmailError ? 'failed' : 'success', replies_detected: found.filter(f => f.kind === 'replied').length, " +
      "leads_skipped: found.filter(f => f.kind === 'bounced').length, errors: gmailError ? [{ message: 'Gmail: ' + String(gmailError.error.message || gmailError.error).slice(0, 200) }] : null, " +
      'started_at: cfg.started_at, finished_at: new Date().toISOString() } }]\n',
      'runOnceForAllItems', { executeOnce: true }),
    logRun('Write run log', [2220, 100]),
  ]
  link(c, 'Every 30 minutes', 'Config')
  link(c, 'Dashboard: Check podcast replies', 'Config')
  link(c, 'Config', 'Gmail: recent inbox')
  link(c, 'Gmail: recent inbox', 'Sent threads')
  link(c, 'Sent threads', 'Emailed podcasts')
  link(c, 'Emailed podcasts', 'Find replies & bounces')
  link(c, 'Find replies & bounces', 'Anything found?')
  link(c, 'Anything found?', 'Update podcast', 0)
  link(c, 'Anything found?', 'Run summary', 1)
  link(c, 'Update podcast', 'Cancel follow-ups')
  link(c, 'Cancel follow-ups', 'Run summary')
  link(c, 'Run summary', 'Write run log')
  return { name: 'WF-P4: Podcast Reply Monitor', nodes, connections: c, settings: { executionOrder: 'v1' }, pinData: {} }
}

// =====================================================================================
// WF-P5: Google Sheet "Podcast Leads" (SOP section 3) — two-way: rows out, Status back in
// =====================================================================================
function buildP5() {
  const c = {}
  const doc = { __rl: true, mode: 'url', value: "={{ $('Settings').first().json.sheet_url }}" }
  const tab = { __rl: true, mode: 'name', value: 'Podcast Leads' }
  const nodes = [
    schedule('Every hour', [0, 0], { field: 'hours', hoursInterval: 1 }),
    webhook('Dashboard: Sync sheet', [0, 200], 'wfp5-podcast-sheet'),
    config('Config', [240, 100], BASE_CONFIG),
    ifTrue('Sheet set?', [1340, 100], "={{ /docs\\.google\\.com\\/spreadsheets/.test($('Settings').first().json.sheet_url || '') }}"),
    node('Read sheet', 'n8n-nodes-base.googleSheets', 4.5, [1560, 0], {
      operation: 'read',
      documentId: doc,
      sheetName: tab,
      filtersUI: {},
      options: {},
    }, { credentials: CRED.sheets, ...ONCE }),
    http('Qualified podcasts', [1780, 0], {
      url: `=${SB}/rest/v1/podcast_leads?stage=eq.qualified&select=*&order=created_at.asc&limit=5000`,
      auth: { supabase: true },
    }, ONCE),
    code('Plan sync', [2000, 0], 'p5-plan-sync.js'),
    inline('Sheet columns', [2220, 0],
      "// Drop the internal fields so only the sheet's columns are written.\nreturn $input.all().map(i => { const { _id, _status_from_sheet, ...row } = i.json; return { json: row } })\n"),
    node('Write to sheet', 'n8n-nodes-base.googleSheets', 4.5, [2440, 0], {
      operation: 'appendOrUpdate',
      documentId: doc,
      sheetName: tab,
      columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: ['YouTube channel URL'], schema: [] },
      options: { handlingExtraData: 'ignoreIt' },
    }, { credentials: CRED.sheets }),
    inline('Status changes', [2660, -150],
      "// Status values edited in the sheet, to copy into Supabase.\nreturn $('Plan sync').all().map(i => i.json).filter(r => r._status_from_sheet).map(r => ({ json: { id: r._id, status: r._status_from_sheet } }))\n",
      'runOnceForAllItems', { executeOnce: true }),
    http('Save sheet status', [2880, -150], {
      method: 'PATCH',
      url: `=${SB}/rest/v1/podcast_leads?id=eq.{{ $json.id }}`,
      auth: { supabase: true },
      responseFormat: 'text',
      headers: [['Prefer', 'return=minimal']],
      body: '={{ JSON.stringify({ status: $json.status }) }}',
    }, CONTINUE),
    inline('Synced ids', [2660, 150],
      "return [{ json: { ids: $('Plan sync').all().map(i => i.json._id).filter(Boolean) } }]\n", 'runOnceForAllItems', { executeOnce: true }),
    http('Mark synced', [2880, 150], {
      method: 'PATCH',
      url: `=${SB}/rest/v1/podcast_leads?id=in.({{ $json.ids.join(',') }})`,
      auth: { supabase: true },
      responseFormat: 'text',
      headers: [['Prefer', 'return=minimal']],
      body: "={{ JSON.stringify({ sheet_synced_at: new Date(Date.now() + 2000).toISOString() }) }}",
    }),
    logRun('Write run log', [3100, 150],
      "={{ JSON.stringify({ workflow_name: 'WF-P5-PodcastSheet', status: 'success', leads_scored: $('Plan sync').all().length, started_at: $('Config').first().json.started_at, finished_at: new Date().toISOString() }) }}"),
  ]
  link(c, 'Every hour', 'Config')
  link(c, 'Dashboard: Sync sheet', 'Config')
  settingsChain(nodes, c, 'Sheet set?', { gate: false })
  link(c, 'Sheet set?', 'Read sheet', 0)
  link(c, 'Read sheet', 'Qualified podcasts')
  link(c, 'Qualified podcasts', 'Plan sync')
  link(c, 'Plan sync', 'Sheet columns')
  link(c, 'Sheet columns', 'Write to sheet')
  // Both run once after the sheet write; "Status changes" sits higher on the canvas so it runs first.
  link(c, 'Write to sheet', 'Status changes')
  link(c, 'Write to sheet', 'Synced ids')
  link(c, 'Status changes', 'Save sheet status')
  link(c, 'Synced ids', 'Mark synced')
  link(c, 'Mark synced', 'Write run log')
  return { name: 'WF-P5: Podcast Leads Google Sheet', nodes, connections: c, settings: { executionOrder: 'v1' }, pinData: {} }
}

for (const [file, wf] of [
  ['WFP1-podcast-find.json', buildP1()],
  ['WFP2-podcast-qualify.json', buildP2()],
  ['WFP3-podcast-draft.json', buildP3()],
  ['WFP3b-podcast-send.json', buildP3b()],
  ['WFP4-podcast-replies.json', buildP4()],
  ['WFP5-podcast-sheet.json', buildP5()],
]) {
  const names = new Set(wf.nodes.map(n => n.name))
  for (const [from, { main }] of Object.entries(wf.connections)) {
    if (!names.has(from)) throw new Error(`${file}: connection from unknown node "${from}"`)
    for (const out of main) for (const t of out) if (!names.has(t.node)) throw new Error(`${file}: "${from}" -> unknown node "${t.node}"`)
  }
  writeFileSync(out(file), JSON.stringify(wf, null, 2) + '\n')
  console.log(`wrote n8n-workflows/${file} (${wf.nodes.length} nodes)`)
}
