'use client'
import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Alert, Spinner } from '@/components/ui'
import { IconArrowRight, IconCheck, IconMail } from '@/components/icons'

function LoginForm() {
  const params = useSearchParams()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState(params.get('error') ?? '')

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const next = params.get('next')
    const callback = new URL('/auth/callback', window.location.origin)
    if (next && next.startsWith('/') && !next.startsWith('//')) callback.searchParams.set('next', next)

    const { error } = await createClient().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: callback.toString() },
    })

    if (error) setError(error.message)
    else setSent(true)
    setLoading(false)
  }

  if (sent) {
    return (
      <div className="fade-in">
        <div className="stat-icon" style={{ width: 44, height: 44, marginBottom: 18 }}>
          <IconMail />
        </div>
        <h2>Check your inbox</h2>
        <p className="page-desc" style={{ marginTop: 8 }}>
          We sent a sign-in link to <strong style={{ color: 'var(--text)' }}>{email}</strong>. It expires in one hour.
        </p>
        <button className="btn btn-block" style={{ marginTop: 24 }} onClick={() => setSent(false)}>
          Use a different email
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleLogin} className="fade-in">
      <div className="brand-mark" style={{ marginBottom: 22 }}>B</div>
      <h2>Sign in to Bear Studios</h2>
      <p className="page-desc" style={{ marginTop: 6, marginBottom: 26 }}>
        Enter your work email and we&apos;ll send you a secure magic link.
      </p>

      {error && <Alert tone="error">{error}</Alert>}

      <div className="field">
        <label className="label" htmlFor="email">Email address</label>
        <input
          id="email"
          type="email"
          className="input"
          placeholder="you@company.com"
          autoComplete="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          autoFocus
        />
      </div>

      <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={loading || !email.trim()}>
        {loading ? <Spinner /> : null}
        {loading ? 'Sending link…' : 'Continue with email'}
        {!loading && <IconArrowRight className="icon" />}
      </button>
      <p className="hint" style={{ marginTop: 16, textAlign: 'center' }}>
        New accounts need to be approved by a studio owner.
      </p>
    </form>
  )
}

export default function LoginPage() {
  return (
    <div className="auth">
      <aside className="auth-aside">
        <div className="row">
          <div className="brand-mark">B</div>
          <span style={{ fontWeight: 600, color: '#fafafa' }}>Bear Studios</span>
        </div>
        <div>
          <h1>The operating system for your studio.</h1>
          <p>Find and qualify leads, review AI-written outreach, and keep every client project on track — in one place.</p>
          <div className="auth-points">
            {[
              'Automated lead scraping & AI scoring via n8n',
              'Human-in-the-loop email approval',
              'Client portal & production board',
            ].map(t => (
              <div key={t} className="auth-point">
                <IconCheck />
                {t}
              </div>
            ))}
          </div>
        </div>
        <div style={{ fontSize: 12.5, color: '#71717a' }}>© {new Date().getFullYear()} Bear Studios</div>
      </aside>
      <main className="auth-main">
        <div className="auth-card">
          <Suspense fallback={<div className="skeleton" style={{ height: 280 }} />}>
            <LoginForm />
          </Suspense>
        </div>
      </main>
    </div>
  )
}
