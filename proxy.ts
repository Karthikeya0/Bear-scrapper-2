import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import {
  EDITOR_ROUTES,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
  homeForRole,
  isSupabaseConfigured,
  normalizeRole,
} from '@/lib/env'

const PUBLIC_PREFIXES = ['/login', '/auth']
const NO_ACCESS = '/no-access'

function redirectTo(request: NextRequest, pathname: string, from?: NextResponse) {
  const url = request.nextUrl.clone()
  url.pathname = pathname
  url.search = ''
  const res = NextResponse.redirect(url)
  // Carry over any refreshed auth cookies.
  from?.cookies.getAll().forEach(c => res.cookies.set(c))
  return res
}

export async function proxy(request: NextRequest) {
  // Without Supabase config the root layout renders a setup screen and API routes return 503.
  if (!isSupabaseConfigured()) return NextResponse.next({ request })

  let response = NextResponse.next({ request })

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
      },
    },
  })

  // Refreshes the session cookie if needed. Must run before any routing decision.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl
  const isPublic = PUBLIC_PREFIXES.some(p => pathname.startsWith(p))

  // API routes enforce auth themselves and must answer with JSON, never a redirect.
  if (pathname.startsWith('/api')) return response

  if (!user) {
    if (isPublic) return response
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = pathname !== '/' ? `?next=${encodeURIComponent(pathname)}` : ''
    return NextResponse.redirect(url)
  }

  const { data: profile, error: profileError } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  if (pathname.startsWith('/auth')) return response

  // A failing profile lookup (e.g. un-migrated RLS policies) must not grant access.
  if (profileError) {
    if (pathname === NO_ACCESS) return response
    const url = request.nextUrl.clone()
    url.pathname = NO_ACCESS
    url.search = `?reason=${encodeURIComponent(profileError.message)}`
    return NextResponse.redirect(url)
  }

  const role = normalizeRole(profile?.role)
  const home = homeForRole(role)

  if (pathname === '/' || pathname.startsWith('/login')) return redirectTo(request, home, response)
  if (pathname === NO_ACCESS) return role === 'pending' ? response : redirectTo(request, home, response)
  if (role === 'pending') return redirectTo(request, NO_ACCESS, response)

  if (role === 'client' && !pathname.startsWith('/portal')) return redirectTo(request, home, response)
  if (role !== 'client' && pathname.startsWith('/portal')) return redirectTo(request, home, response)
  if (role === 'editor' && !EDITOR_ROUTES.some(r => pathname === r || pathname.startsWith(`${r}/`))) {
    return redirectTo(request, home, response)
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|pdf)$).*)'],
}
