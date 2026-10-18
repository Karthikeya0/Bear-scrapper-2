import { redirect } from 'next/navigation'
import AppShell from '@/components/AppShell'
import { createClient } from '@/lib/supabase/server'
import { homeForRole, normalizeRole } from '@/lib/env'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('user_profiles').select('role').eq('id', user.id).maybeSingle()
  const role = normalizeRole(profile?.role)
  if (role !== 'owner' && role !== 'editor') redirect(homeForRole(role))

  return (
    <AppShell email={user.email ?? ''} role={role}>
      {children}
    </AppShell>
  )
}
