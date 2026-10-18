import type { Metadata, Viewport } from 'next'
import './globals.css'
import { isSupabaseConfigured } from '@/lib/env'

export const metadata: Metadata = {
  title: { default: 'Bear Studios', template: '%s · Bear Studios' },
  description: 'Lead generation, outreach and client operations for Bear Studios.',
  // Opens full-screen like an app after "Add to Home Screen" on iPhone.
  appleWebApp: { capable: true, title: 'Bear Radar', statusBarStyle: 'black-translucent' },
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f7f8' },
    { media: '(prefers-color-scheme: dark)', color: '#09090b' },
  ],
}

function SetupRequired() {
  return (
    <div className="center-screen">
      <div className="card card-pad center-card">
        <div className="row" style={{ marginBottom: 14 }}>
          <div className="brand-mark">B</div>
          <div>
            <div style={{ fontWeight: 650 }}>Bear Studios</div>
            <div className="subtle" style={{ fontSize: 12.5 }}>Configuration required</div>
          </div>
        </div>
        <h1 className="page-title" style={{ fontSize: 20 }}>Supabase is not configured</h1>
        <p className="page-desc" style={{ marginBottom: 16 }}>
          The app needs these environment variables before it can load real data. No demo or mock data is used.
        </p>
        <pre className="pre" style={{ color: 'var(--text)' }}>
{`NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon public key>
N8N_BASE_URL=https://<your-n8n-host>
N8N_WEBHOOK_SECRET=<same secret as in n8n>`}
        </pre>
        <p className="hint" style={{ marginTop: 12 }}>
          Locally: copy <code>.env.example</code> to <code>.env.local</code> and restart <code>npm run dev</code>. On Vercel:
          Project → Settings → Environment Variables, then redeploy.
        </p>
      </div>
    </div>
  )
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{isSupabaseConfigured() ? children : <SetupRequired />}</body>
    </html>
  )
}
