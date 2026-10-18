// Public (browser-safe) configuration. Only NEXT_PUBLIC_* values may be read here.
// Server-only secrets (service role key, n8n secret) are read in lib/n8n.ts and API routes.

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

export function isSupabaseConfigured(): boolean {
  return /^https?:\/\//.test(SUPABASE_URL) && SUPABASE_ANON_KEY.length > 20
}

export type Role = 'owner' | 'editor' | 'client' | 'pending'

/** Unknown or missing roles get no access ('pending') — never escalate by default. */
export function normalizeRole(value: unknown): Role {
  return value === 'owner' || value === 'editor' || value === 'client' ? value : 'pending'
}

/** Landing page for each role after sign-in. */
export function homeForRole(role: Role): string {
  if (role === 'pending') return '/no-access'
  if (role === 'client') return '/portal/dashboard'
  if (role === 'editor') return '/pending'
  return '/dashboard'
}

/** Routes an editor may open. Owners can open everything except the client portal. */
export const EDITOR_ROUTES = ['/dashboard', '/pending']
