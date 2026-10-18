import { redirect } from 'next/navigation'
import SignOutButton from '@/components/SignOutButton'
import { ToastProvider } from '@/components/Toast'
import { createClient } from '@/lib/supabase/server'

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <ToastProvider>
      <header className="portal-top">
        <div className="row">
          <div className="brand-mark">B</div>
          <div>
            <div style={{ fontWeight: 650, letterSpacing: '-0.01em' }}>Bear Studios</div>
            <div className="subtle" style={{ fontSize: 12 }}>Client portal</div>
          </div>
        </div>
        <div className="row">
          <span className="subtle desktop-only" style={{ fontSize: 13 }}>{user.email}</span>
          <SignOutButton />
        </div>
      </header>
      <main className="portal-content">{children}</main>
    </ToastProvider>
  )
}
