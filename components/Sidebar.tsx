'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useEffect, useState } from 'react'
import { useSidebar } from './DashboardShell'

const MAIN_NAV_ITEMS = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    icon: (
      <svg className="sidebar-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    )
  },
  {
    href: '/clients',
    label: 'Clients',
    icon: (
      <svg className="sidebar-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    )
  },
  {
    href: '/pending',
    label: 'Pending Works',
    badge: 'Kanban',
    icon: (
      <svg className="sidebar-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M7 8h10M7 12h7M7 16h4" strokeLinecap="round" />
      </svg>
    )
  },
  {
    href: '/leads',
    label: 'Leads Pipeline',
    icon: (
      <svg className="sidebar-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="5" />
        <circle cx="12" cy="12" r="1.5" fill="currentColor" />
      </svg>
    )
  },
  {
    href: '/outreach',
    label: 'Outreach Queue',
    icon: (
      <svg className="sidebar-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <polyline points="3 7 12 13 21 7" />
      </svg>
    )
  },
]

const SYSTEM_NAV_ITEMS = [
  {
    href: '/runs',
    label: 'Run History',
    icon: (
      <svg className="sidebar-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
    )
  },
  {
    href: '/settings',
    label: 'Settings',
    icon: (
      <svg className="sidebar-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    )
  },
  {
    href: '/portal/dashboard',
    label: 'Client Portal',
    badge: 'Live Preview',
    icon: (
      <svg className="sidebar-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <circle cx="12" cy="12" r="10" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
    )
  }
]

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { isCollapsed, toggleCollapse, isMobileOpen, closeMobile } = useSidebar()
  const [role, setRole] = useState<string>('owner')
  const [email, setEmail] = useState<string>('sushmita@bearstudios.co')

  useEffect(() => {
    const fetchProfile = async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        setEmail(user.email || 'sushmita@bearstudios.co')
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('role')
          .eq('id', user.id)
          .maybeSingle()
        if (profile?.role) setRole(profile.role)
      }
    }
    fetchProfile()
  }, [])

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  // Filter items based on user role (defaulting to owner for full capability)
  const filterItems = (items: typeof MAIN_NAV_ITEMS) => {
    return items.filter(item => {
      if (role === 'owner') return true
      if (role === 'editor') return item.href === '/pending' || item.href === '/dashboard'
      return true
    })
  }

  const visibleMain = filterItems(MAIN_NAV_ITEMS)
  const visibleSystem = filterItems(SYSTEM_NAV_ITEMS)
  const initials = email ? email.slice(0, 2).toUpperCase() : 'BS'

  return (
    <>
      {/* Mobile backdrop */}
      {isMobileOpen && (
        <div
          className="sidebar-mobile-backdrop"
          onClick={closeMobile}
          aria-label="Close sidebar"
        />
      )}

      <aside className={`sidebar ${isCollapsed ? 'collapsed' : ''} ${isMobileOpen ? 'mobile-visible' : ''}`}>
        {/* Header / Brand */}
        <div className="sidebar-header">
          <div className="sidebar-brand-wrapper">
            <div className="sidebar-logo">B</div>
            <Link href="/dashboard" className="sidebar-brand" onClick={closeMobile}>
              Bear Studios
            </Link>
          </div>

          {/* Open / Close Toggle Button */}
          <button
            type="button"
            className="sidebar-toggle-btn"
            onClick={toggleCollapse}
            title={isCollapsed ? 'Expand menu (Open)' : 'Collapse menu (Close)'}
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <svg
              className={`toggle-icon ${isCollapsed ? 'icon-collapsed' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        </div>

        {/* Navigation body */}
        <nav className="sidebar-nav">
          <div className="sidebar-section-label">Operations</div>
          {visibleMain.map(item => {
            const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href))
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={closeMobile}
                className={`sidebar-link ${isActive ? 'active' : ''}`}
                title={isCollapsed ? item.label : undefined}
              >
                <div className="sidebar-icon-wrap">{item.icon}</div>
                <span className="sidebar-link-text">{item.label}</span>
                {item.badge && !isCollapsed && (
                  <span className="sidebar-badge">{item.badge}</span>
                )}
              </Link>
            )
          })}

          <div className="sidebar-section-label" style={{ marginTop: '16px' }}>System</div>
          {visibleSystem.map(item => {
            const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href))
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={closeMobile}
                className={`sidebar-link ${isActive ? 'active' : ''}`}
                title={isCollapsed ? item.label : undefined}
              >
                <div className="sidebar-icon-wrap">{item.icon}</div>
                <span className="sidebar-link-text">{item.label}</span>
                {item.badge && !isCollapsed && (
                  <span className="sidebar-badge-accent">{item.badge}</span>
                )}
              </Link>
            )
          })}
        </nav>

        {/* Footer */}
        <div className="sidebar-footer">
          <div className="user-info">
            <div className="user-avatar" title={email}>{initials}</div>
            {!isCollapsed && (
              <div className="user-meta min-w-0">
                <div className="user-email truncate">{email}</div>
                <div className="role-badge">{role}</div>
              </div>
            )}
          </div>
          <button
            onClick={handleSignOut}
            className="sidebar-link btn-signout"
            title={isCollapsed ? 'Sign out' : undefined}
          >
            <div className="sidebar-icon-wrap">
              <svg className="sidebar-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </div>
            {!isCollapsed && <span className="sidebar-link-text">Sign out</span>}
          </button>
        </div>
      </aside>
    </>
  )
}
