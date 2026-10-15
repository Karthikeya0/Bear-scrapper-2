import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/env'

let browserClient: SupabaseClient | null = null

/**
 * Browser Supabase client (anon key + the signed-in user's session cookie).
 * The root layout refuses to render the app when Supabase env vars are missing,
 * so this is only ever called with a real configuration.
 */
export function createClient(): SupabaseClient {
  if (!browserClient) {
    browserClient = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  }
  return browserClient
}
