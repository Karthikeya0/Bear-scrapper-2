import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

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
        .single()
        
      const role = profile?.role || 'editor'
      
      let redirectPath = '/dashboard'
      if (role === 'editor') redirectPath = '/pending'
      if (role === 'client') redirectPath = '/portal/dashboard'
      
      // If next param is provided and valid for the role, use it (we just use role defaults for now)
      return NextResponse.redirect(`${origin}${redirectPath}`)
    }
  }

  // Fallback
  return NextResponse.redirect(`${origin}/login`)
}
