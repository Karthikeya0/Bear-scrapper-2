'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    if (error) {
      setError(error.message)
    } else {
      setSent(true)
    }
    setLoading(false)
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', width: '100%' }}>
      {/* Left Side: Cinematic Branding */}
      <div className="section-dark" style={{ 
        flex: 1, 
        display: 'flex', 
        flexDirection: 'column', 
        justifyContent: 'center',
        padding: '6rem 4rem'
      }}>
        <div className="fade-in" style={{ maxWidth: '600px', margin: '0 auto' }}>
          <span className="micro-label" style={{ marginBottom: '2rem' }}>PORTAL ACCESS</span>
          <h1 style={{ fontSize: 'clamp(4rem, 8vw, 6rem)', lineHeight: 0.9, marginBottom: '2rem' }}>
            BEAR<br/>STUDIOS
          </h1>
          <p className="text-muted" style={{ fontSize: '1.25rem', maxWidth: '400px', marginBottom: '3rem' }}>
            Client management and operational control center.
          </p>
          
          {/* Decorative Ring */}
          <div className="stat-ring-container" style={{ width: '80px', height: '80px', marginBottom: '0' }}>
            <svg className="stat-ring" viewBox="0 0 100 100">
              <circle className="stat-ring-bg" cx="50" cy="50" r="45" />
              <circle className="stat-ring-progress" cx="50" cy="50" r="45" style={{ strokeDasharray: 283, strokeDashoffset: 100 }} />
            </svg>
            <div className="stat-value" style={{ fontSize: '1.5rem' }}>01</div>
          </div>
        </div>
      </div>

      {/* Right Side: Login Form */}
      <div className="section-light" style={{ 
        flex: 1, 
        display: 'flex', 
        flexDirection: 'column', 
        justifyContent: 'center',
        alignItems: 'center',
        padding: '2rem'
      }}>
        <div className="fade-in" style={{ width: '100%', maxWidth: '360px', animationDelay: '0.2s' }}>
          
          {sent ? (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '3rem', marginBottom: '1.5rem' }}>✉️</div>
              <h3 style={{ marginBottom: '1rem', color: 'var(--text-on-light)' }}>Check your email</h3>
              <p className="text-muted" style={{ fontSize: '1rem', lineHeight: 1.6 }}>
                We've sent a magic link to<br/>
                <strong style={{ color: 'var(--text-on-light)' }}>{email}</strong>
              </p>
            </div>
          ) : (
            <form onSubmit={handleLogin}>
              <h3 style={{ marginBottom: '0.5rem', color: 'var(--text-on-light)' }}>Sign In</h3>
              <p className="text-muted" style={{ marginBottom: '3rem', fontSize: '0.875rem' }}>
                Enter your email to receive a secure login link.
              </p>

              <div className="form-group" style={{ marginBottom: '2.5rem' }}>
                <label className="form-label" htmlFor="email">Email address</label>
                <input
                  id="email"
                  type="email"
                  className="form-input"
                  placeholder="you@company.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              {error && (
                <div style={{ color: 'var(--status-negative)', fontSize: '0.875rem', marginBottom: '1.5rem', border: '1px solid currentColor', padding: '0.75rem', borderRadius: '4px' }}>
                  {error}
                </div>
              )}

              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading || !email}
                style={{ width: '100%' }}
              >
                {loading ? 'SENDING...' : 'SEND MAGIC LINK →'}
              </button>
            </form>
          )}

        </div>
      </div>
    </div>
  )
}
