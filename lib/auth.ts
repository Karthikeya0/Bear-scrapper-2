import 'server-only'
import { NextResponse } from 'next/server'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured, normalizeRole, type Role } from '@/lib/env'

type Authorized = { ok: true; user: User; role: Role; supabase: SupabaseClient }
type Denied = { ok: false; response: NextResponse }

/**
 * Verifies the caller of an API route has a valid Supabase session and one of the allowed roles.
 * The session is validated against Supabase Auth (getUser), not just decoded from the cookie.
 */
export async function requireRole(allowed: Role[]): Promise<Authorized | Denied> {
  if (!isSupabaseConfigured()) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: 'Supabase is not configured on the server.' }, { status: 503 }),
    }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { ok: false, response: NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 }) }
  }

  const { data: profile } = await supabase.from('user_profiles').select('role').eq('id', user.id).maybeSingle()
  const role = normalizeRole(profile?.role)

  if (!allowed.includes(role)) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: 'You do not have permission to do this.' }, { status: 403 }),
    }
  }

  return { ok: true, user, role, supabase }
}
