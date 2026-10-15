import SignOutButton from '@/components/SignOutButton'
import { createClient } from '@/lib/supabase/server'

export const metadata = { title: 'Access pending' }

export default async function NoAccessPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { reason } = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return (
    <div className="center-screen">
      <div className="card card-pad center-card">
        <div className="row" style={{ marginBottom: 16 }}>
          <div className="brand-mark">B</div>
          <div style={{ fontWeight: 650 }}>Bear Studios</div>
        </div>
        {reason ? (
          <>
            <h1 className="page-title" style={{ fontSize: 20 }}>We couldn&apos;t load your account</h1>
            <p className="page-desc">Your profile could not be read from the database:</p>
            <pre className="pre" style={{ margin: '12px 0' }}>{reason}</pre>
            <p className="hint">
              If this mentions &quot;infinite recursion&quot; or a missing table, the database migrations in{' '}
              <code>supabase/migrations</code> (002 and 003) have not been applied yet.
            </p>
          </>
        ) : (
          <>
            <h1 className="page-title" style={{ fontSize: 20 }}>Your access is pending</h1>
            <p className="page-desc">
              {user?.email ? <strong>{user.email}</strong> : 'This account'} is signed in but hasn&apos;t been assigned a
              role yet. Ask a Bear Studios owner to grant you access, then sign in again.
            </p>
          </>
        )}
        <div style={{ marginTop: 20 }}>
          <SignOutButton />
        </div>
      </div>
    </div>
  )
}
