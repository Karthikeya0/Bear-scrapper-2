// WF-2 "Free checks & qualify" (Code node, Run Once for All Items).
// Runs only free lookups, so paid Hunter credits are spent on qualified leads only:
//   1. resolve the real website (follows Product Hunt / BetaList redirects)
//   2. homepage: is there a product video? X / LinkedIn links?
//   3. domain age via RDAP (free, public registry data)
//   4. small + new + buying-signal rules from the Config node
//   5. for qualified leads only: a free email search (site pages + Hacker News profile), so Hunter
//      credits are only spent when the founder's email is not published anywhere
// Output: one item per raw lead with `qualified` true/false and `disqualify_reason`.

const cfg = $('Config').first().json
const MAX_TEAM = Number(cfg.max_team_size) || 3
const MAX_DOMAIN_DAYS = Number(cfg.max_domain_age_days) || 730
const MAX_LAUNCH_DAYS = Number(cfg.max_launch_age_days) || 90
const JUST_LAUNCHED_DAYS = Number(cfg.just_launched_days) || 30
const RDAP_BASE = String(cfg.rdap_base || 'https://rdap.org').replace(/\/+$/, '')
const HN_API = String(cfg.hn_user_api || 'https://hacker-news.firebaseio.com/v0').replace(/\/+$/, '')
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

// ---------- free email search ----------
const FREE_MAIL = /^(gmail|googlemail|outlook|hotmail|live|icloud|me|proton|protonmail|pm|hey|fastmail|yahoo|zoho)\.[a-z.]+$/i
const JUNK_LOCAL = /^(no-?reply|do-?not-?reply|donotreply|privacy|legal|abuse|postmaster|security|dmca|gdpr|dpo|unsubscribe|bounce[s]?|mailer-daemon|example|user|username|email|name|your|yourname|you|test|someone|john|jane|john\.doe|jane\.doe|wordpress|admin|webmaster|careers|jobs|press|billing|invoices?)$/i
const JUNK_DOMAIN = /(example\.(com|org)|domain\.com|email\.com|sentry\.io|wixpress\.com|sentry-next\.wixpress\.com|yourcompany|company\.com|mysite\.com|godaddy\.com|squarespace\.com|w3\.org|schema\.org)$/i
const EMAIL_RE = /[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9.-]+\.[a-z]{2,24}/gi

const decodeEntities = t => String(t || '')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
// Cloudflare hides emails as <a data-cfemail="hex">; the first byte is the XOR key.
const cfDecode = hex => {
  try {
    const key = parseInt(hex.slice(0, 2), 16)
    let out = ''
    for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key)
    return out
  } catch { return '' }
}
// "sam [at] acme [dot] com" / "sam (at) acme.com" style text.
const deobfuscate = t => t
  .replace(/\s*[\[(<{]\s*at\s*[\])>}]\s*/gi, '@')
  .replace(/\s*[\[(<{]\s*dot\s*[\])>}]\s*/gi, '.')
  .replace(/\s+at\s+(?=[a-z0-9-]+\s*(?:\.|\s+dot\s+)[a-z]{2,})/gi, '@')
  .replace(/\s+dot\s+(?=[a-z]{2,}\b)/gi, '.')

function emailsIn(html) {
  const text = decodeEntities(html)
  const found = [...text.matchAll(EMAIL_RE)].map(m => m[0])
  for (const m of html.matchAll(/data-cfemail="([0-9a-f]+)"/gi)) found.push(cfDecode(m[1]))
  for (const m of text.matchAll(/mailto:([^"'?\s>]+)/gi)) found.push(decodeURIComponent(m[1]))
  return found
}

function rankEmails(list, companyHost, personName) {
  const base = registrable(companyHost || '')
  const first = String(personName || '').trim().split(/\s+/)[0]?.toLowerCase() || ''
  const seen = new Set()
  return list
    .map(e => String(e || '').trim().toLowerCase().replace(/^mailto:/, '').replace(/[.,;:)\]]+$/, ''))
    .filter(e => {
      const [local, domain] = e.split('@')
      if (!local || !domain || seen.has(e)) return false
      seen.add(e)
      if (/\.(png|jpe?g|gif|svg|webp|avif|ico|css|js)$/i.test(e) || /\d+x\d*$/.test(local)) return false
      if (JUNK_LOCAL.test(local) || JUNK_DOMAIN.test(domain)) return false
      return registrable(domain) === base || FREE_MAIL.test(domain)
    })
    .map(e => {
      const local = e.split('@')[0]
      let score = 0
      if (first && first.length > 1 && local.includes(first)) score += 60
      if (/^(founder|founders|ceo|cofounder|co-founder)$/.test(local)) score += 50
      else if (/^(hi|hello|hey|yo)$/.test(local)) score += 35
      else if (/^(contact|team|info|mail|inbox|general)$/.test(local)) score += 25
      else if (/^(support|help|sales|feedback|partners?|marketing)$/.test(local)) score += 10
      else score += 40 // looks like a person's own address
      if (FREE_MAIL.test(e.split('@')[1])) score -= 5
      return { email: e, score }
    })
    .sort((a, b) => b.score - a.score)
}

async function hnAbout(user) {
  try {
    const res = await get.call(this, `${HN_API}/user/${encodeURIComponent(user)}.json`, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
    if (res.statusCode !== 200) return ''
    const data = typeof res.body === 'string' ? JSON.parse(res.body) : res.body
    return deobfuscate(decodeEntities(String((data && data.about) || '').replace(/<[^>]+>/g, ' ')))
  } catch { return '' }
}

// Homepage first, then a few likely pages on the same site; stops at the first good address.
async function findEmail(site, lead, host) {
  const person = lead.name
  let ranked = rankEmails(emailsIn(site.html), host, person)
  if (lead.source === 'hackernews' && lead.name && !(ranked[0] && ranked[0].score >= 60)) {
    const about = await hnAbout.call(this, lead.name)
    const fromHn = rankEmails(emailsIn(about), host, person).map(e => ({ ...e, score: e.score + 15 }))
    ranked = [...fromHn, ...ranked].sort((a, b) => b.score - a.score)
  }
  if (ranked[0] && ranked[0].score >= 40) return { email: ranked[0].email, from: 'website' }
  const linked = [...site.html.matchAll(/href="([^"#?]*(?:contact|about|team|founder|imprint|impressum)[^"#?]*)"/gi)]
    .map(m => resolveUrl(m[1], site.url))
    .filter(u => hostOf(u) === host)
  const guesses = ['/contact', '/about', '/team'].map(p => resolveUrl(p, site.url))
  for (const url of [...new Set([...linked, ...guesses])].slice(0, 4)) {
    try {
      const res = await get.call(this, url)
      if (res.statusCode >= 400) continue
      const more = rankEmails(emailsIn(String(res.body ?? '').slice(0, 400000)), host, person)
      ranked = [...ranked, ...more].sort((a, b) => b.score - a.score)
      if (ranked[0] && ranked[0].score >= 40) break
    } catch { /* page missing: try the next one */ }
  }
  return ranked[0] ? { email: ranked[0].email, from: 'website' } : null
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
  try {
    const found = await findEmail.call(this, site, lead, host)
    out.site_email = found ? found.email : null
  } catch {
    out.site_email = null
  }
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
