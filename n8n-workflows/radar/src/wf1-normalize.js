// WF-1 "Normalize & pre-filter" (Code node, Run Once for All Items).
// Turns the mixed output of every source into raw_leads rows and drops obvious misses.
// Input: items from Hacker News, YC, BetaList (RSS) and Product Hunt, merged.
// Output: ONE item { rows: [...raw_leads rows], collected, failed_sources: [...] }.

const cfg = $('Config').first().json
const LOOKBACK_DAYS = Number(cfg.lookback_days) || 7
const YC_LOOKBACK_DAYS = Number(cfg.yc_lookback_days) || 120
const MAX_TEAM = Number(cfg.max_team_size) || 3
const cutoff = Date.now() - LOOKBACK_DAYS * 86400000
const ycCutoff = Date.now() - YC_LOOKBACK_DAYS * 86400000

// Hosts that are not a startup's own website (code repos, app stores, social, launch sites).
const NOT_A_SITE = [
  'github.com', 'gitlab.com', 'bitbucket.org', 'youtube.com', 'youtu.be', 'apps.apple.com', 'play.google.com',
  'chromewebstore.google.com', 'chrome.google.com', 'addons.mozilla.org', 'medium.com', 'substack.com',
  'twitter.com', 'x.com', 'linkedin.com', 'reddit.com', 'news.ycombinator.com', 'docs.google.com',
  'huggingface.co', 'npmjs.com', 'pypi.org', 'arxiv.org', 'notion.site', 'itch.io',
]

// n8n's Code-node sandbox has no global URL, so parse the host with a regex.
function hostOf(url) {
  const m = String(url || '').match(/^https?:\/\/(?:[^@\/?#]*@)?([^\/?#:]+)/i)
  return m ? m[1].toLowerCase().replace(/^www\./, '') : null
}
const isOwnSite = host => !!host && !NOT_A_SITE.some(d => host === d || host.endsWith('.' + d))
const clean = (s, max = 2000) => (s == null ? null : String(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) || null)
const toIso = v => {
  if (v == null || v === '') return null
  const d = typeof v === 'number' ? new Date(v < 1e12 ? v * 1000 : v) : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
const handleOf = v => {
  if (!v) return null
  const m = String(v).match(/(?:twitter\.com|x\.com)\/(@?\w{1,15})/i)
  const h = (m ? m[1] : String(v)).replace(/^@/, '').trim()
  return /^\w{1,15}$/.test(h) ? h : null
}
const redacted = v => !v || /redacted/i.test(String(v))

const rows = []
const failed = []
const seen = new Set()

function push(row) {
  const domain = row.website && !/producthunt\.com|betalist\.com/.test(row.website) ? hostOf(row.website) : null
  if (row.website && domain && !isOwnSite(domain)) return // e.g. a GitHub repo, not a company
  const dedup_key = domain || `${row.source}:${row.source_id}`
  if (seen.has(dedup_key)) return
  seen.add(dedup_key)
  rows.push({
    source: row.source,
    source_id: String(row.source_id),
    name: row.name ?? null,
    email: null,
    company: row.company ?? null,
    company_domain: domain,
    website: row.website ?? null,
    profile_url: row.profile_url ?? null,
    bio: row.bio ?? null,
    post_content: row.post_content ?? null,
    x_handle: row.x_handle ?? null,
    linkedin_url: row.linkedin_url ?? null,
    launched_at: row.launched_at ?? null,
    team_size: row.team_size ?? null,
    source_score: row.source_score ?? null,
    raw_json: row.raw_json ?? null,
    status: 'raw',
    dedup_key,
  })
}

for (const item of $input.all()) {
  const d = item.json || {}

  // A source node that failed (On Error = Continue) passes its error through.
  if (d.error) {
    failed.push(String(d.error?.message || d.error).slice(0, 300))
    continue
  }

  // ---- Hacker News "Show HN" (Algolia API) ----
  if (Array.isArray(d.hits)) {
    for (const h of d.hits) {
      if (!h.url) continue // text-only posts have no product site
      const ts = (h.created_at_i || 0) * 1000
      if (ts && ts < cutoff) continue
      const title = clean(h.title, 300) || ''
      const product = title.replace(/^show hn:\s*/i, '')
      const company = clean(product.split(/\s[–—\-:|]\s|:\s/)[0], 120)
      push({
        source: 'hackernews',
        source_id: h.objectID,
        name: h.author || null,
        company,
        website: h.url,
        profile_url: `https://news.ycombinator.com/item?id=${h.objectID}`,
        bio: h.author ? `HN: ${h.author}` : null,
        post_content: clean(`${title}\n\n${h.story_text || ''}`),
        launched_at: toIso(h.created_at || h.created_at_i),
        source_score: Number.isFinite(h.points) ? h.points : null,
        raw_json: { title: h.title, points: h.points, comments: h.num_comments },
      })
    }
    continue
  }

  // ---- Product Hunt (GraphQL API v2) ----
  if (d.data && d.data.posts) {
    for (const edge of d.data.posts.edges || []) {
      const p = edge.node || {}
      const ts = Date.parse(p.createdAt || '')
      if (ts && ts < cutoff) continue
      const makers = (p.makers || []).filter(m => !redacted(m.name) || !redacted(m.username))
      const first = makers[0] || {}
      push({
        source: 'producthunt',
        source_id: p.id,
        name: redacted(first.name) ? null : first.name,
        company: clean(p.name, 120),
        website: p.website || null, // usually a producthunt.com/r/... redirect; WF-2 resolves it
        profile_url: p.url || null,
        bio: first.twitterUsername ? `@${first.twitterUsername}` : null,
        post_content: clean(`${p.name}: ${p.tagline || ''}\n\n${p.description || ''}`),
        x_handle: handleOf(first.twitterUsername),
        launched_at: toIso(p.createdAt),
        team_size: makers.length || null,
        source_score: Number.isFinite(p.votesCount) ? p.votesCount : null,
        raw_json: { tagline: p.tagline, votes: p.votesCount, makers: makers.length },
      })
    }
    continue
  }

  // ---- YC companies (yc-oss API: one item per company) ----
  if (d.slug && ('batch' in d || 'one_liner' in d)) {
    const launched = toIso(d.launched_at)
    if (!launched || Date.parse(launched) < ycCutoff) continue
    const team = Number(d.team_size) || null
    if (team && team > MAX_TEAM) continue
    if (d.status && !/active/i.test(d.status)) continue
    push({
      source: 'yc',
      source_id: d.slug,
      company: clean(d.name, 120),
      website: d.website || null,
      profile_url: d.url || `https://www.ycombinator.com/companies/${d.slug}`,
      bio: d.batch ? `YC ${d.batch}` : null,
      post_content: clean(`${d.name}: ${d.one_liner || ''}\n\n${d.long_description || ''}`),
      launched_at: launched,
      team_size: team,
      raw_json: { batch: d.batch, industries: d.industries, regions: d.regions, stage: d.stage },
    })
    continue
  }

  // ---- BetaList (RSS Read node: one item per entry) ----
  if (d.link && /betalist\.com/i.test(d.link)) {
    const ts = Date.parse(d.isoDate || d.pubDate || '')
    if (ts && ts < cutoff) continue
    const title = clean(d.title, 300) || ''
    push({
      source: 'betalist',
      source_id: d.guid || d.link,
      company: clean(title.split(/\s[–—\-:|]\s/)[0], 120),
      website: d.link, // BetaList page; WF-2 follows its "visit" link to the real site
      profile_url: d.link,
      post_content: clean(`${title}\n\n${d.contentSnippet || d.content || ''}`),
      launched_at: toIso(d.isoDate || d.pubDate),
      raw_json: { title: d.title },
    })
  }
}

return [{ json: { rows, collected: rows.length, failed_sources: failed } }]
