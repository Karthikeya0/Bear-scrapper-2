// WF-2 "Free checks & qualify" (Code node, Run Once for All Items).
// Runs only free lookups, so paid Hunter credits are spent on qualified leads only:
//   1. resolve the real website (follows Product Hunt / BetaList redirects)
//   2. homepage: is there a product video? X / LinkedIn links?
//   3. domain age via RDAP (free, public registry data)
//   4. small + new + buying-signal rules from the Config node
// Output: one item per raw lead with `qualified` true/false and `disqualify_reason`.

const cfg = $('Config').first().json
const MAX_TEAM = Number(cfg.max_team_size) || 3
const MAX_DOMAIN_DAYS = Number(cfg.max_domain_age_days) || 730
const MAX_LAUNCH_DAYS = Number(cfg.max_launch_age_days) || 90
const JUST_LAUNCHED_DAYS = Number(cfg.just_launched_days) || 30
const RDAP_BASE = String(cfg.rdap_base || 'https://rdap.org').replace(/\/+$/, '')
const UA = 'Mozilla/5.0 (compatible; BearRadar/1.0; +https://bear.studio)'
const DAY = 86400000

const VIDEO_PATTERNS = [
  /<video[\s>]/i,
  /youtube(?:-nocookie)?\.com\/(?:embed|watch)|youtu\.be\//i,
  /player\.vimeo\.com|vimeo\.com\/\d+/i,
  /fast\.wistia\.(?:net|com)|wistia\.com\/medias/i,
  /loom\.com\/(?:embed|share)/i,
  /vidyard\.com|videoask\.com|mux\.com\/|stream\.cloudflare|cloudflarestream\.com/i,
  /\.(?:mp4|webm)(?:["'?#\s])/i,
]
const NON_SITE = /(?:^|\.)(producthunt\.com|betalist\.com|github\.com|gitlab\.com|apps\.apple\.com|play\.google\.com|youtube\.com|medium\.com)$/i

// n8n's Code-node sandbox has no global URL, so parse URLs with a regex.
const URL_RE = /^(https?):\/\/((?:[^@\/?#]*@)?([^\/?#:]+)(?::\d+)?)([^?#]*)/i
const hostOf = url => {
  const m = String(url || '').match(URL_RE)
  return m ? m[3].toLowerCase().replace(/^www\./, '') : null
}
// Resolve a redirect Location / href against the page it came from.
const resolveUrl = (ref, base) => {
  ref = String(ref || '').trim()
  if (/^https?:\/\//i.test(ref)) return ref
  const m = String(base).match(URL_RE)
  if (!m) return ref
  const [, proto, authority, , path] = m
  if (ref.startsWith('//')) return `${proto}:${ref}`
  if (ref.startsWith('/')) return `${proto}://${authority}${ref}`
  return `${proto}://${authority}${(path || '/').replace(/[^/]*$/, '')}${ref}`
}
// Registrable domain for RDAP (good enough for common TLDs, incl. co.uk-style two-part suffixes).
const registrable = host => {
  const parts = host.split('.')
  const twoPart = /^(co|com|org|net|ac|gov|edu)\.[a-z]{2}$/.test(parts.slice(-2).join('.'))
  return parts.slice(twoPart ? -3 : -2).join('.')
}

async function get(url, extra = {}) {
  return this.helpers.httpRequest({
    url,
    method: 'GET',
    headers: { 'User-Agent': UA, Accept: 'text/html,application/json;q=0.9,*/*;q=0.8' },
    timeout: 12000,
    returnFullResponse: true,
    ignoreHttpStatusErrors: true,
    encoding: 'text',
    json: false,
    ...extra,
  })
}

// Follow redirects ourselves so we know the final URL (Product Hunt /r/ links, BetaList visit links).
async function resolveSite(startUrl) {
  let url = startUrl
  for (let hop = 0; hop < 6; hop++) {
    const res = await get.call(this, url, { disableFollowRedirect: true })
    const status = res.statusCode
    const location = res.headers && (res.headers.location || res.headers.Location)
    if (status >= 300 && status < 400 && location) {
      url = resolveUrl(location, url)
      continue
    }
    const html = typeof res.body === 'string' ? res.body : String(res.body ?? '')
    // BetaList / Product Hunt pages: jump to the startup's outbound link if present.
    const host = hostOf(url)
    if (host && NON_SITE.test(host) && /betalist\.com|producthunt\.com/.test(host)) {
      const out =
        html.match(/href="(\/startups\/[^"]+\/visit)"/i)?.[1] ||
        html.match(/href="(https?:\/\/[^"]+)"[^>]*(?:rel="[^"]*nofollow[^"]*")[^>]*>\s*(?:visit|website)/i)?.[1]
      if (out) {
        url = resolveUrl(out, url)
        continue
      }
    }
    return { url, status, html: html.slice(0, 600000) }
  }
  return { url, status: 0, html: '' }
}

function socials(html) {
  const handles = [...html.matchAll(/https?:\/\/(?:www\.)?(?:twitter|x)\.com\/(@?\w{1,15})(?=["'\/?#\s])/gi)]
    .map(m => m[1].replace(/^@/, ''))
    .filter(h => !/^(share|intent|home|search|hashtag|i|privacy|tos|login|signup)$/i.test(h))
  const linkedin = html.match(/https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/(?:company|in)\/[\w\-%.]+/i)?.[0] || null
  return { x_handle: handles[0] || null, linkedin_url: linkedin }
}

async function domainCreated(domain) {
  try {
    const res = await get.call(this, `${RDAP_BASE}/domain/${domain}`, {
      headers: { 'User-Agent': UA, Accept: 'application/rdap+json, application/json' },
    })
    if (res.statusCode !== 200) return null
    const data = typeof res.body === 'string' ? JSON.parse(res.body) : res.body
    const ev = (data.events || []).find(e => /registration/i.test(e.eventAction))
    return ev && !Number.isNaN(Date.parse(ev.eventDate)) ? new Date(ev.eventDate).toISOString() : null
  } catch {
    return null
  }
}

async function check(lead) {
  const out = { ...lead, has_video: null, domain_created_at: null, signals: [], qualified: false, disqualify_reason: null }
  const age = d => (d ? (Date.now() - Date.parse(d)) / DAY : null)

  // ---- small: team size ----
  if (lead.team_size && lead.team_size > MAX_TEAM) {
    out.disqualify_reason = `team_too_big (${lead.team_size} > ${MAX_TEAM})`
    return out
  }

  // ---- website ----
  if (!lead.website) {
    out.disqualify_reason = 'no_website'
    return out
  }
  let site
  try {
    site = await resolveSite.call(this, lead.website)
  } catch (e) {
    out.disqualify_reason = `site_unreachable (${String(e.message || e).slice(0, 80)})`
    return out
  }
  const host = hostOf(site.url)
  if (!host || NON_SITE.test(host) || site.status >= 400 || !site.html) {
    out.disqualify_reason = !host || NON_SITE.test(host) ? 'website_unresolved' : `site_unreachable (HTTP ${site.status})`
    return out
  }
  out.website = site.url
  out.company_domain = host
  out.has_video = VIDEO_PATTERNS.some(re => re.test(site.html))
  const s = socials(site.html)
  out.x_handle = lead.x_handle || s.x_handle
  out.linkedin_url = lead.linkedin_url || s.linkedin_url

  // ---- new: launch date or young domain ----
  out.domain_created_at = await domainCreated.call(this, registrable(host))
  const launchAge = age(lead.launched_at)
  const domainAge = age(out.domain_created_at)
  const isNew = (launchAge != null && launchAge <= MAX_LAUNCH_DAYS) || (domainAge != null && domainAge <= MAX_DOMAIN_DAYS)
  if (!isNew) {
    out.disqualify_reason = `not_new (launched ${launchAge == null ? '?' : Math.round(launchAge)}d ago, domain ${domainAge == null ? '?' : Math.round(domainAge)}d old)`
    return out
  }

  // ---- signals ----
  if (launchAge != null && launchAge <= JUST_LAUNCHED_DAYS) out.signals.push('just_launched')
  if (domainAge != null && domainAge <= 365) out.signals.push('new_domain')
  if (out.has_video === false) out.signals.push('no_video')
  if (lead.team_size && lead.team_size <= MAX_TEAM) out.signals.push('tiny_team')
  if (out.x_handle) out.signals.push('has_x')
  if (out.linkedin_url) out.signals.push('has_linkedin')

  // ---- buying signal required: just launched, or no video to show their product ----
  if (!out.signals.includes('just_launched') && !out.signals.includes('no_video')) {
    out.disqualify_reason = 'no_buying_signal (already has a video and launched a while ago)'
    return out
  }
  out.qualified = true
  return out
}

const leads = $input.all().map(i => i.json).filter(l => l && l.id)
const results = []
// Small parallel batches: fast, but polite to the sites and RDAP servers we hit.
for (let i = 0; i < leads.length; i += 4) {
  const batch = leads.slice(i, i + 4)
  const checked = await Promise.all(
    batch.map(l =>
      check.call(this, l).catch(e => ({
        ...l,
        qualified: false,
        signals: [],
        disqualify_reason: `check_failed (${String(e.message || e).slice(0, 80)})`,
      })),
    ),
  )
  results.push(...checked)
}
return results.map(json => ({ json }))
