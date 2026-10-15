// Interactive Supabase client:
// Automatically uses real Supabase if production credentials (e.g. *.supabase.co) are present in .env.local.
// Otherwise, runs in high-fidelity interactive local demo mode where ALL buttons, forms, filters, and drag-and-drop actions WORK in-memory!

import { createBrowserClient } from '@supabase/ssr'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

const isRealSupabase =
  supabaseUrl.includes('supabase.co') &&
  supabaseAnonKey.length > 20 &&
  !supabaseAnonKey.includes('demo')

// --- Initial Mock Data Store ---
const INITIAL_DATA: Record<string, any[]> = {
  user_profiles: [
    { id: 'usr-1', role: 'owner', display_name: 'Sushmita (Owner)', avatar_url: null, created_at: '2026-09-01T00:00:00Z' }
  ],
  leads: [
    { id: '1', name: 'Alex Rivera', company: 'Launchpad AI', email: 'alex@launchpadai.co', source: 'reddit', ai_score: 87, status: 'scored', created_at: '2026-10-10T08:00:00Z', profile_url: 'https://reddit.com/u/alexrivera' },
    { id: '2', name: 'Priya Mehta', company: 'Stackr Inc', email: 'priya@stackr.io', source: 'producthunt', ai_score: 74, status: 'contacted', created_at: '2026-10-09T10:00:00Z', profile_url: 'https://producthunt.com/@priyamehta' },
    { id: '3', name: 'Jordan Kim', company: 'Nebula Labs', email: 'jordan@nebulalabs.dev', source: 'yc', ai_score: 91, status: 'replied', created_at: '2026-10-08T12:00:00Z', profile_url: 'https://ycombinator.com/companies/nebula-labs' },
    { id: '4', name: 'Sam Okafor', company: 'Waveform', email: 'sam@waveform.fm', source: 'reddit', ai_score: 62, status: 'scored', created_at: '2026-10-07T14:00:00Z', profile_url: 'https://reddit.com/u/samokafor' },
    { id: '5', name: 'Mei Chen', company: 'Zephyr Tech', email: 'mei@zephyrtech.com', source: 'twitter', ai_score: 45, status: 'dead', created_at: '2026-10-06T09:00:00Z', profile_url: 'https://x.com/meichen' },
    { id: '6', name: 'Carlos Vega', company: 'Flowstate', email: 'carlos@flowstate.app', source: 'producthunt', ai_score: 79, status: 'converted', created_at: '2026-10-05T11:00:00Z', profile_url: 'https://producthunt.com/@carlosvega' },
  ],
  clients: [
    { id: 'c1', company: 'Nebula Labs', contact_name: 'Jordan Kim', contact_email: 'jordan@nebulalabs.dev', status: 'active', monthly_value: 4500, currency: 'USD', contract_notes: 'Retainer: 4 deliverables/mo. Scope includes motion graphics and short-form video.', created_at: '2026-09-01T00:00:00Z' },
    { id: 'c2', company: 'Flowstate', contact_name: 'Carlos Vega', contact_email: 'carlos@flowstate.app', status: 'active', monthly_value: 2800, currency: 'USD', contract_notes: 'Product launch series. Bi-weekly review calls on Thursdays.', created_at: '2026-09-15T00:00:00Z' },
    { id: 'c3', company: 'Stackr Inc', contact_name: 'Priya Mehta', contact_email: 'priya@stackr.io', status: 'lead', monthly_value: 3200, currency: 'USD', contract_notes: 'Evaluating proposal for Q4 content refresh.', created_at: '2026-10-01T00:00:00Z' },
    { id: 'c4', company: 'Pixel & Co', contact_name: 'Dana Lee', contact_email: 'dana@pixelco.design', status: 'past', monthly_value: 1500, currency: 'USD', contract_notes: 'Completed brand identity package in September.', created_at: '2026-06-01T00:00:00Z' },
  ],
  projects: [
    { id: 'p1', client_id: 'c1', title: 'Brand Identity Redesign', description: 'Full brand overhaul, guidelines and Figma design tokens', status: 'in_progress', priority: 'high', deadline: '2026-11-01', created_at: '2026-09-10T00:00:00Z', clients: { company: 'Nebula Labs' } },
    { id: 'p2', client_id: 'c2', title: 'Launch Video Package', description: '3x hero videos, 9x cutdowns + animated thumbnails', status: 'review', priority: 'urgent', deadline: '2026-10-20', created_at: '2026-09-20T00:00:00Z', clients: { company: 'Flowstate' } },
    { id: 'p3', client_id: 'c1', title: 'Social Content Q4', description: '20 motion posts per month for LinkedIn and X', status: 'todo', priority: 'medium', deadline: '2026-12-01', created_at: '2026-10-01T00:00:00Z', clients: { company: 'Nebula Labs' } },
    { id: 'p4', client_id: 'c4', title: 'Explainer Animation', description: '90s 3D motion graphic explainer', status: 'delivered', priority: 'low', deadline: '2026-09-15', created_at: '2026-08-01T00:00:00Z', clients: { company: 'Pixel & Co' } },
  ],
  tasks: [
    { id: 't1', project_id: 'p1', title: 'Moodboard & direction deck', status: 'delivered', priority: 'high', deadline: '2026-10-12', created_at: '2026-09-12T00:00:00Z', projects: { title: 'Brand Identity Redesign', clients: { company: 'Nebula Labs' } } },
    { id: 't2', project_id: 'p1', title: 'Logo variants (3 concepts)', status: 'in_progress', priority: 'high', deadline: '2026-10-25', created_at: '2026-09-14T00:00:00Z', projects: { title: 'Brand Identity Redesign', clients: { company: 'Nebula Labs' } } },
    { id: 't3', project_id: 'p2', title: 'Hero video rough cut', status: 'review', priority: 'urgent', deadline: '2026-10-18', created_at: '2026-09-22T00:00:00Z', projects: { title: 'Launch Video Package', clients: { company: 'Flowstate' } } },
    { id: 't4', project_id: 'p2', title: 'Thumbnail grid (20 options)', status: 'todo', priority: 'medium', deadline: '2026-10-22', created_at: '2026-09-24T00:00:00Z', projects: { title: 'Launch Video Package', clients: { company: 'Flowstate' } } },
    { id: 't5', project_id: 'p3', title: 'October content calendar', status: 'todo', priority: 'medium', deadline: '2026-10-30', created_at: '2026-10-02T00:00:00Z', projects: { title: 'Social Content Q4', clients: { company: 'Nebula Labs' } } },
  ],
  outreach_queue: [
    {
      id: 'o1', lead_id: '1',
      subject: 'Quick idea for Launchpad AI launch strategy',
      body: 'Hi Alex,\n\nI came across Launchpad AI on Reddit and was impressed by the traction you are getting. We help early-stage AI companies cut through the noise with video content that actually converts — no stock footage, no generic talking heads.\n\nWould love to share a 2-min concept we put together for a similar product last month. Worth a look?\n\nBest,\nBear Studios',
      status: 'pending_review', sequence_step: 1, created_at: '2026-10-13T09:00:00Z',
      lead: { name: 'Alex Rivera', company: 'Launchpad AI', email: 'alex@launchpadai.co', ai_score: 87 }
    },
    {
      id: 'o2', lead_id: '4',
      subject: 'Waveform + Bear Studios — a thought',
      body: 'Hey Sam,\n\nNoticed Waveform just dropped on Product Hunt — congrats on the launch!\n\nWe specialise in creative assets for audio-tech startups and have a strong track record with launches at your stage. Our last client went from 200 to 4,000 signups in 10 days post-video.\n\nOpen to a quick 15-min call this week?\n\nCheers,\nBear Studios',
      status: 'pending_review', sequence_step: 1, created_at: '2026-10-13T10:00:00Z',
      lead: { name: 'Sam Okafor', company: 'Waveform', email: 'sam@waveform.fm', ai_score: 62 }
    },
    {
      id: 'o3', lead_id: '3',
      subject: 'Follow-up: brand shoot ideas for Nebula Labs',
      body: 'Hey Jordan,\n\nFollowing up on my note from last week. Wanted to share a quick case study from a YC W24 company we worked with — their landing page bounce rate dropped 40% after we rebuilt their hero video.\n\nLet me know if Tuesday works for a 20-min chat.\n\nBest,\nBear Studios',
      status: 'approved', sequence_step: 2, created_at: '2026-10-11T08:00:00Z',
      lead: { name: 'Jordan Kim', company: 'Nebula Labs', email: 'jordan@nebulalabs.dev', ai_score: 91 }
    },
    {
      id: 'o4', lead_id: '2',
      subject: 'Creative assets for Stackr Series A push',
      body: 'Hi Priya,\n\nCongrats on the Stackr momentum! We have helped 3 companies in the dev tools space build their Series A decks and investor video one-pagers.\n\nWorth a quick chat before your next fundraising push?',
      status: 'sent', sequence_step: 1, created_at: '2026-10-09T11:00:00Z',
      lead: { name: 'Priya Mehta', company: 'Stackr Inc', email: 'priya@stackr.io', ai_score: 74 }
    },
  ],
  workflow_logs: [
    { id: 'l1', workflow_name: 'WF-1-Scraper', status: 'success', leads_scraped: 42, leads_skipped: 18, leads_scored: 0, emails_sent: 0, replies_detected: 0, errors: null, started_at: '2026-10-14T06:00:00Z', finished_at: '2026-10-14T06:03:12Z' },
    { id: 'l2', workflow_name: 'WF-2-Processor', status: 'success', leads_scraped: 0, leads_skipped: 0, leads_scored: 38, emails_sent: 0, replies_detected: 0, errors: null, started_at: '2026-10-14T06:05:00Z', finished_at: '2026-10-14T06:09:45Z' },
    { id: 'l3', workflow_name: 'WF-3-Outreach', status: 'success', leads_scraped: 0, leads_skipped: 0, leads_scored: 0, emails_sent: 24, replies_detected: 0, errors: null, started_at: '2026-10-14T09:00:00Z', finished_at: '2026-10-14T09:01:30Z' },
    { id: 'l4', workflow_name: 'WF-4-ReplyMonitor', status: 'success', leads_scraped: 0, leads_skipped: 0, leads_scored: 0, emails_sent: 0, replies_detected: 3, errors: null, started_at: '2026-10-14T12:00:00Z', finished_at: '2026-10-14T12:00:48Z' },
    { id: 'l5', workflow_name: 'WF-1-Scraper', status: 'failed', leads_scraped: 5, leads_skipped: 0, leads_scored: 0, emails_sent: 0, replies_detected: 0, errors: [{ code: 'RATE_LIMIT', message: 'Reddit API rate limit exceeded' }], started_at: '2026-10-13T06:00:00Z', finished_at: '2026-10-13T06:01:05Z' },
    { id: 'l6', workflow_name: 'WF-5-Feedback', status: 'success', leads_scraped: 0, leads_skipped: 0, leads_scored: 0, emails_sent: 0, replies_detected: 0, errors: null, started_at: '2026-10-13T20:00:00Z', finished_at: '2026-10-13T20:00:22Z' },
  ],
  settings: [
    { key: 'icp_filter', value: { min_score: 60, sources: ['reddit', 'producthunt', 'yc'], exclude_domains: ['gmail.com', 'yahoo.com'], keywords_include: ['saas', 'startup', 'founder', 'launch', 'product'], keywords_exclude: ['hiring', 'job', 'agency'] } },
    { key: 'sending_limits', value: { daily_max: 25, hourly_max: 3, min_gap_minutes: 5, send_window_start_hour: 9, send_window_end_hour: 17, send_on_weekends: false, follow_up_days: [7, 14, 21] } },
  ],
  email_templates: [
    { id: 'tpl1', key: 'initial_outreach', name: 'Initial Outreach', subject_template: 'Quick idea for {{company}} content strategy', body_template: 'Hi {{name}},\n\nI came across {{company}} on {{source}} and was really impressed by {{hook}}.\n\nWe help early-stage founders like you build content that converts — no generic stock footage, just sharp creative.\n\nWould love to share a quick concept we built for a similar company last month.\n\nBest,\nBear Studios', active: true, created_at: '2026-09-01T00:00:00Z' },
    { id: 'tpl2', key: 'follow_up_1', name: 'Follow-up #1 (Day 7)', subject_template: 'Re: content strategy for {{company}}', body_template: 'Hey {{name}},\n\nFollowing up on my last note. Wanted to share a quick case study that might be relevant.\n\nOpen to a 15-min chat this week?\n\nCheers,\nBear Studios', active: true, created_at: '2026-09-01T00:00:00Z' },
    { id: 'tpl3', key: 'follow_up_2', name: 'Follow-up #2 (Day 14)', subject_template: 'Last note — {{company}} + Bear Studios', body_template: 'Hi {{name}},\n\nI will keep this short — if timing is not right, no worries at all. Just wanted to leave the door open.\n\nWe would love to help {{company}} with creative that moves the needle. Here is our portfolio: bear.studio/work\n\nBest,\nBear Studios', active: true, created_at: '2026-09-01T00:00:00Z' },
  ],
  communications: [
    { id: 'cm1', client_id: 'c1', channel: 'portal', direction: 'inbound', body: 'Loving the initial moodboards! Can we see darker color palette variations?', created_at: '2026-10-12T14:30:00Z' },
    { id: 'cm2', client_id: 'c1', channel: 'email', direction: 'outbound', body: 'Sure thing, Jordan! We will prepare 2 dark mode variants by Friday.', created_at: '2026-10-12T15:10:00Z' },
    { id: 'cm3', client_id: 'c2', channel: 'portal', direction: 'inbound', body: 'Review complete on hero cut 1 — notes added in Figma.', created_at: '2026-10-13T10:00:00Z' },
  ],
  deliverables: [
    { id: 'del1', project_id: 'p1', client_id: 'c1', title: 'Brand Guidelines v1.0.pdf', file_url: '#', status: 'approved', created_at: '2026-10-05T00:00:00Z' },
    { id: 'del2', project_id: 'p2', client_id: 'c2', title: 'Flowstate_Hero_1080p.mp4', file_url: '#', status: 'review', created_at: '2026-10-14T00:00:00Z' },
  ]
}

// Global in-memory reactive store
let memoryStore = { ...INITIAL_DATA }

// Helper to reset store if needed
export function resetMockData() {
  memoryStore = JSON.parse(JSON.stringify(INITIAL_DATA))
}

class ReactiveQueryBuilder {
  private table: string
  private filters: ((row: any) => boolean)[] = []
  private sortFn: ((a: any, b: any) => number) | null = null
  private limitCount: number | null = null
  private isSingle = false
  private isHeadOnly = false

  constructor(table: string) {
    this.table = table
    if (!memoryStore[table]) memoryStore[table] = []
  }

  select(fields?: string, options?: { count?: string; head?: boolean }) {
    if (options?.head) this.isHeadOnly = true
    return this
  }

  eq(column: string, value: any) {
    this.filters.push(row => String(row[column]) === String(value))
    return this
  }

  neq(column: string, value: any) {
    this.filters.push(row => String(row[column]) !== String(value))
    return this
  }

  ilike(column: string, pattern: string) {
    const raw = pattern.replace(/%/g, '').toLowerCase()
    this.filters.push(row => {
      const val = row[column]
      return val ? String(val).toLowerCase().includes(raw) : false
    })
    return this
  }

  or(expression: string) {
    // Basic parser for expressions like "name.ilike.%foo%,company.ilike.%foo%"
    const parts = expression.split(',').map(p => p.trim())
    this.filters.push(row => {
      return parts.some(part => {
        const [col, op, pat] = part.split('.')
        const val = row[col]
        if (!val) return false
        if (op === 'ilike') {
          const raw = (pat || '').replace(/%/g, '').toLowerCase()
          return String(val).toLowerCase().includes(raw)
        }
        return false
      })
    })
    return this
  }

  gte(column: string, value: number) {
    this.filters.push(row => (row[column] ?? 0) >= value)
    return this
  }

  lte(column: string, value: number) {
    this.filters.push(row => (row[column] ?? 0) <= value)
    return this
  }

  in(column: string, values: any[]) {
    this.filters.push(row => values.includes(row[column]))
    return this
  }

  order(column: string, { ascending = true }: { ascending?: boolean } = {}) {
    this.sortFn = (a, b) => {
      const valA = a[column]
      const valB = b[column]
      if (valA === valB) return 0
      if (valA === null || valA === undefined) return 1
      if (valB === null || valB === undefined) return -1
      return ascending ? (valA > valB ? 1 : -1) : (valA < valB ? 1 : -1)
    }
    return this
  }

  limit(count: number) {
    this.limitCount = count
    return this
  }

  single() {
    this.isSingle = true
    return this
  }

  maybeSingle() {
    this.isSingle = true
    return this
  }

  async insert(records: any | any[]) {
    const arr = Array.isArray(records) ? records : [records]
    const created = arr.map((item, idx) => ({
      id: item.id || `gen-${Date.now()}-${idx}`,
      created_at: item.created_at || new Date().toISOString(),
      ...item
    }))
    memoryStore[this.table] = [...created, ...(memoryStore[this.table] || [])]
    return { data: Array.isArray(records) ? created : created[0], error: null }
  }

  async update(updates: any) {
    const list = memoryStore[this.table] || []
    let updatedCount = 0
    memoryStore[this.table] = list.map(row => {
      const matches = this.filters.every(fn => fn(row))
      if (matches) {
        updatedCount++
        return { ...row, ...updates, updated_at: new Date().toISOString() }
      }
      return row
    })
    return { data: updates, count: updatedCount, error: null }
  }

  async upsert(records: any | any[]) {
    const arr = Array.isArray(records) ? records : [records]
    for (const item of arr) {
      const keyCol = item.key !== undefined ? 'key' : 'id'
      const keyVal = item[keyCol]
      const idx = (memoryStore[this.table] || []).findIndex(r => r[keyCol] === keyVal)
      if (idx >= 0) {
        memoryStore[this.table][idx] = { ...memoryStore[this.table][idx], ...item, updated_at: new Date().toISOString() }
      } else {
        memoryStore[this.table].push({ id: `gen-${Date.now()}`, ...item, created_at: new Date().toISOString() })
      }
    }
    return { data: records, error: null }
  }

  async delete() {
    const list = memoryStore[this.table] || []
    memoryStore[this.table] = list.filter(row => !this.filters.every(fn => fn(row)))
    return { data: null, error: null }
  }

  private execute() {
    let list = [...(memoryStore[this.table] || [])]
    for (const filter of this.filters) {
      list = list.filter(filter)
    }
    const count = list.length
    if (this.sortFn) {
      list.sort(this.sortFn)
    }
    if (this.limitCount !== null) {
      list = list.slice(0, this.limitCount)
    }
    if (this.isHeadOnly) {
      return { data: null, count, error: null }
    }
    if (this.isSingle) {
      return { data: list[0] || null, count, error: null }
    }
    return { data: list, count, error: null }
  }

  then(resolve: (value: any) => any, reject?: (reason: any) => any) {
    try {
      const result = this.execute()
      return Promise.resolve(result).then(resolve)
    } catch (err) {
      if (reject) return Promise.reject(err).catch(reject)
      throw err
    }
  }
}

function buildInteractiveClient() {
  return {
    from: (table: string) => new ReactiveQueryBuilder(table),
    auth: {
      getUser: async () => ({
        data: {
          user: {
            id: 'usr-1',
            email: 'sushmita@bearstudios.co',
            user_metadata: { name: 'Sushmita' }
          }
        },
        error: null
      }),
      getSession: async () => ({
        data: {
          session: {
            user: { id: 'usr-1', email: 'sushmita@bearstudios.co' },
            access_token: 'mock-token'
          }
        },
        error: null
      }),
      signInWithOtp: async () => ({ error: null }),
      signOut: async () => ({ error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    channel: () => ({
      on: function(this: any) { return this },
      subscribe: () => ({ unsubscribe: () => {} }),
    }),
    removeChannel: () => {},
    rpc: async (fn: string, params: any) => {
      if (fn === 'fuzzy_lead_exists') return { data: [{ exists: false }], error: null }
      return { data: null, error: null }
    },
  }
}

let _clientInstance: any = null

export function createClient(): any {
  if (isRealSupabase) {
    return createBrowserClient(supabaseUrl, supabaseAnonKey)
  }
  if (!_clientInstance) {
    _clientInstance = buildInteractiveClient()
  }
  return _clientInstance
}
