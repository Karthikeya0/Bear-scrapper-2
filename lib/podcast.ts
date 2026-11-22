// Podcast outreach (migration 007): settings, statuses and shared types.
// Settings are saved in Supabase as settings.key = 'podcast'; the WF-P* workflows read that row every run.
import type { SupabaseClient } from '@supabase/supabase-js'

export type PodcastSettings = {
  /** Hard cap on podcast emails per day (dashboard sends included). SaaS has its own cap in Settings. */
  daily_max: number
  min_subscribers: number
  max_subscribers: number
  min_uploads_30d: number
  min_episode_minutes: number
  /** YouTube searches per WF-P1 run (100 quota units each; free quota is 10,000 a day). */
  searches_per_run: number
  follow_up_days: number[]
  draft_dms: boolean
  /** manual: you approve each email. auto: drafts go straight to the send schedule (still max daily_max a day). */
  autopilot: 'manual' | 'auto'
  sheet_url: string
  added_by: string
}

export const DEFAULT_PODCAST_SETTINGS: PodcastSettings = {
  daily_max: 10,
  min_subscribers: 1000,
  max_subscribers: 25000,
  min_uploads_30d: 2,
  min_episode_minutes: 30,
  searches_per_run: 20,
  follow_up_days: [4, 7],
  draft_dms: true,
  autopilot: 'manual',
  sheet_url: '',
  added_by: 'Bear Radar',
}

export const PODCAST_SETTINGS_KEY = 'podcast'

export async function loadPodcastSettings(supabase: SupabaseClient): Promise<{ settings: PodcastSettings; error?: string }> {
  const { data, error } = await supabase.from('settings').select('value').eq('key', PODCAST_SETTINGS_KEY).maybeSingle()
  return { settings: { ...DEFAULT_PODCAST_SETTINGS, ...((data?.value ?? {}) as Partial<PodcastSettings>) }, error: error?.message }
}

export async function savePodcastSettings(supabase: SupabaseClient, patch: Partial<PodcastSettings>) {
  const { data, error: readError } = await supabase.from('settings').select('value').eq('key', PODCAST_SETTINGS_KEY).maybeSingle()
  if (readError) return { error: readError.message }
  const value = { ...DEFAULT_PODCAST_SETTINGS, ...((data?.value ?? {}) as Partial<PodcastSettings>), ...patch }
  const { error } = await supabase.from('settings').upsert({ key: PODCAST_SETTINGS_KEY, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  return { error: error?.message, value }
}

/** SOP column M. "Email sent" is added for shows we emailed (the SOP's flow is IG DM only). */
export const PODCAST_STATUSES = ['New', 'Sample made', 'DM sent', 'Email sent', 'Replied', 'Won', 'Dead'] as const
export type PodcastStatus = (typeof PODCAST_STATUSES)[number]

export const PODCAST_STATUS_TONE: Record<string, 'blue' | 'amber' | 'violet' | 'green' | 'gray' | 'accent'> = {
  New: 'blue', 'Sample made': 'amber', 'DM sent': 'violet', 'Email sent': 'violet', Replied: 'green', Won: 'green', Dead: 'gray',
}

export const PODCAST_NICHES = [
  'business', 'startups', 'finance', 'fitness', 'health', 'mental health', 'tech', 'AI', 'marketing', 'true crime',
  'comedy', 'sports', 'parenting', 'real estate', 'creator economy', 'career', 'faith', 'education',
]

export type PodcastLead = {
  id: string; created_at: string; updated_at: string; stage: 'found' | 'qualified' | 'skipped'; skip_reason: string | null
  niche: string | null; podcast_name: string | null; host_name: string | null; youtube_channel_url: string | null
  instagram_url: string | null; host_other_url: string | null; sample_episode_url: string | null; sample_episode_title: string | null
  sample_clip_url: string | null; subscribers: number | null; uploads_30d: number | null; avg_minutes: number | null
  has_shorts: string | null; shorts_30d: number | null; contact_method: string | null; why_fit: string | null; status: string
  added_by: string; email: string | null; ai_score: number | null; ig_verified: boolean | null; checks_failed: string[] | null
  last_upload_at: string | null; sheet_synced_at: string | null
}

/** Statuses that must never get another email. */
export const PODCAST_DO_NOT_CONTACT = new Set(['Replied', 'Won', 'Dead'])

/** Start of "today" in a timezone, as an ISO string (for daily-limit counts). */
export function startOfDayIso(timeZone: string) {
  const now = new Date()
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(now)
      .map(p => [p.type, p.value]),
  )
  // Wall-clock "now" in that zone, read as UTC, gives the zone's offset from UTC.
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second)
  const offset = asUtc - Math.floor(now.getTime() / 1000) * 1000
  return new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day) - offset).toISOString()
}
