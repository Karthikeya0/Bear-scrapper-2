'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Role } from '@/lib/env'
import ActivityMenu from './ActivityMenu'
import { ToastProvider } from './Toast'
import {
  IconBolt, IconChart, IconGrid, IconKanban, IconLogout, IconMail, IconMenu, IconPanel, IconSettings, IconTarget, IconUsers,
} from './icons'

type NavItem = { href: string; label: string; icon: ReactNode; roles: Role[]; countKey?: 'outreach' }

const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: 'Studio',
    items: [
      { href: '/dashboard', label: 'Overview', icon: <IconGrid className="nav-icon" />, roles: ['owner', 'editor'] },
      { href: '/clients', label: 'Clients', icon: <IconUsers className="nav-icon" />, roles: ['owner'] },
      { href: '/pending', label: 'Production board', icon: <IconKanban className="nav-icon" />, roles: ['owner', 'editor'] },
    ],
  },
  {
    section: 'Lead engine',
    items: [
      { href: '/leads', label: 'Leads', icon: <IconTarget className="nav-icon" />, roles: ['owner'] },
      { href: '/outreach', label: 'Outreach queue', icon: <IconMail className="nav-icon" />, roles: ['owner'], countKey: 'outreach' },
      { href: '/results', label: 'Results', icon: <IconChart className="nav-icon" />, roles: ['owner'] },
      { href: '/runs', label: 'Workflows', icon: <IconBolt className="nav-icon" />, roles: ['owner'] },
    ],
  },
  {
    section: 'System',
    items: [{ href: '/settings', label: 'Settings', icon: <IconSettings className="nav-icon" />, roles: ['owner'] }],
  },
]

const RoleContext = createContext<Role>('pending')

/** Role of the signed-in user (resolved server-side in the dashboard layout). */
export const useRole = () => useContext(RoleContext)

const COLLAPSE_KEY = 'bear_sidebar_collapsed'
const collapseListeners = new Set<() => void>()

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === 'true'
  } catch {
    return false
  }
}

function useCollapsed(): [boolean, () => void] {
  const collapsed = useSyncExternalStore(
    cb => {
      collapseListeners.add(cb)
      return () => collapseListeners.delete(cb)
    },
    readCollapsed,
    () => false,
  )
  const toggle = useCallback(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, String(!readCollapsed()))
    } catch {}
    collapseListeners.forEach(l => l())
  }, [])
  return [collapsed, toggle]
}

type Health = { state: 'ok' | 'warn' | 'bad' | 'loading'; label: string; detail?: string }

function useIntegrationHealth(enabled: boolean): Health {
  const [health, setHealth] = useState<Health>({ state: 'loading', label: 'Checking n8n…' })
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    fetch('/api/integrations/status', { cache: 'no-store' })
      .then(r => r.json())
      .then(data => {
        if (cancelled) return
        const n8n = data?.n8n
        if (!n8n?.baseUrlConfigured) setHealth({ state: 'warn', label: 'n8n not configured', detail: 'Set N8N_BASE_URL' })
        else if (!n8n.secretConfigured) setHealth({ state: 'warn', label: 'n8n secret missing', detail: 'Set N8N_WEBHOOK_SECRET' })
        else if (!n8n.reachable) setHealth({ state: 'bad', label: 'n8n unreachable', detail: n8n.error })
        else {
          const notReady = ((n8n.webhooks ?? []) as { path: string; state: string; required?: boolean }[]).filter(
            w => w.required !== false && w.state !== 'ready',
          )
          setHealth(
            notReady.length
              ? { state: 'warn', label: `n8n: ${notReady.length} webhook${notReady.length > 1 ? 's' : ''} not ready`, detail: notReady.map(w => w.path).join(', ') }
              : { state: 'ok', label: 'n8n connected' },
          )
        }
      })
      .catch(() => !cancelled && setHealth({ state: 'bad', label: 'Status unavailable' }))
    return () => {
      cancelled = true
    }
  }, [enabled])
  return health
}

function usePendingOutreach(enabled: boolean) {
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (!enabled) return
    const supabase = createClient()
    const load = () =>
      supabase
        .from('outreach_queue')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending_review')
        .then(({ count }) => setCount(count ?? 0))
    load()
    const channel = supabase
      .channel('nav-outreach-count')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'outreach_queue' }, load)
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [enabled])
  return count
}

export default function AppShell({ email, role, children }: { email: string; role: Role; children: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [collapsed, toggleCollapsed] = useCollapsed()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const isOwner = role === 'owner'
  const health = useIntegrationHealth(isOwner)
  const pendingOutreach = usePendingOutreach(isOwner)

  const sections = NAV.map(s => ({ ...s, items: s.items.filter(i => i.roles.includes(role)) })).filter(
    s => s.items.length > 0,
  )
  const current = NAV.flatMap(s => s.items).find(i => pathname === i.href || pathname.startsWith(`${i.href}/`))

  async function signOut() {
    setSigningOut(true)
    await createClient().auth.signOut()
    router.replace('/login')
    router.refresh()
  }

  return (
    <RoleContext.Provider value={role}>
    <ToastProvider>
      <div className={`app-shell ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}>
        {mobileOpen && <div className="backdrop" onClick={() => setMobileOpen(false)} aria-hidden />}

        <aside className="sidebar" aria-label="Main navigation">
          <div className="sidebar-head">
            <div className="brand-mark">B</div>
            <div className="brand-text">
              <div className="brand-name">Bear Studios</div>
              <div className="brand-sub">Operations</div>
            </div>
          </div>

          <nav className="sidebar-nav">
            {sections.map(section => (
              <div key={section.section}>
                <div className="nav-section">{section.section}</div>
                {section.items.map(item => {
                  const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
                  const count = item.countKey === 'outreach' ? pendingOutreach : 0
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`nav-link ${active ? 'active' : ''}`}
                      title={collapsed ? item.label : undefined}
                      aria-current={active ? 'page' : undefined}
                      onClick={() => setMobileOpen(false)}
                    >
                      {item.icon}
                      <span className="nav-label">{item.label}</span>
                      {count > 0 && <span className="nav-count">{count > 99 ? '99+' : count}</span>}
                    </Link>
                  )
                })}
              </div>
            ))}
          </nav>

          <div className="sidebar-foot">
            <div className="user-chip" title={email}>
              <div className="avatar">{(email || '?').slice(0, 2).toUpperCase()}</div>
              <div className="user-meta">
                <div className="user-email truncate">{email}</div>
                <div className="user-role">{role}</div>
              </div>
            </div>
            <button className="nav-link" onClick={signOut} disabled={signingOut} title="Sign out">
              <IconLogout className="nav-icon" />
              <span className="nav-label">{signingOut ? 'Signing out…' : 'Sign out'}</span>
            </button>
          </div>
        </aside>

        <div className="main">
          <header className="topbar">
            <button className="icon-btn mobile-only" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
              <IconMenu />
            </button>
            <button
              className="icon-btn desktop-only"
              onClick={toggleCollapsed}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <IconPanel />
            </button>
            <div className="crumb">
              <span className="crumb-root">Bear Studios <span className="subtle">/</span> </span><strong>{current?.label ?? 'Overview'}</strong>
            </div>
            <div className="topbar-spacer" />
            {isOwner && <ActivityMenu />}
            {isOwner && (
              <Link href="/settings?tab=integrations" className="health-pill" title={health.detail ?? health.label}>
                <span className={`dot ${health.state === 'loading' ? '' : health.state}`} />
                <span className="health-label">{health.label}</span>
              </Link>
            )}
          </header>
          <main className="content">{children}</main>
        </div>
      </div>
    </ToastProvider>
    </RoleContext.Provider>
  )
}
