// Dashboard settings that n8n actually uses. Saved in Supabase as settings.key = 'outreach'; WF-2, WF-3 and WF-3b read
// that row on every run ("Load dashboard settings" -> "Settings" nodes). Defaults match the workflows' Config nodes.
import type { SupabaseClient } from '@supabase/supabase-js'

export type OutreachSettings = {
  min_score: number
  drafts_per_run: number
  follow_up_days: number[]
  draft_dms: boolean
  daily_max: number
  send_window_start: number
  send_window_end: number
  send_on_weekends: boolean
  timezone: string
  from_name: string
  sign_off: string
  signature_name: string
  company_name: string
  website: string
}

export const DEFAULT_SETTINGS: OutreachSettings = {
  min_score: 60,
  drafts_per_run: 10,
  follow_up_days: [4, 7],
  draft_dms: true,
  daily_max: 20,
  send_window_start: 9,
  send_window_end: 18,
  send_on_weekends: false,
  timezone: 'Asia/Kolkata',
  from_name: 'Karthikeya | Bear Studios',
  sign_off: 'Cheers,',
  signature_name: 'Karthikeya Popuri',
  company_name: 'Bear Studios',
  website: 'bearstudios.in',
}

export const SETTINGS_KEY = 'outreach'

export async function loadSettings(supabase: SupabaseClient): Promise<{ settings: OutreachSettings; error?: string }> {
  const { data, error } = await supabase.from('settings').select('value').eq('key', SETTINGS_KEY).maybeSingle()
  const saved = (data?.value ?? {}) as Partial<OutreachSettings>
  return { settings: { ...DEFAULT_SETTINGS, ...saved }, error: error?.message }
}
