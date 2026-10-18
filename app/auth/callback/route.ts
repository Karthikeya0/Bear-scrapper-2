import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { homeForRole, normalizeRole } from '@/lib/env'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next')

  if (code) {
    const supabase = await createClient()
    const { error, data } = await supabase.auth.exchangeCodeForSession(code)

    if (!error && data.user) {
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('role')
        .eq('id', data.user.id)
        .maybeSingle()

      // Only honour same-origin relative paths; the proxy re-checks role access on arrival.
      const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : null
      return NextResponse.redirect(`${origin}${safeNext ?? homeForRole(normalizeRole(profile?.role))}`)
    }
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error?.message ?? 'Sign-in failed')}`)
  }

  return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent('The sign-in link is invalid or has expired.')}`)
}
