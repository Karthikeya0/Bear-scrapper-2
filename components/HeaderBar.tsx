'use client'
import { useSidebar } from './DashboardShell'
import Link from 'next/link'

export default function HeaderBar() {
  const { isCollapsed, toggleCollapse, toggleMobile } = useSidebar()

  return (
    <div className="top-banner-bar">
      <div className="top-banner-left">
        {/* Mobile hamburger */}
        <button
          type="button"
          onClick={toggleMobile}
          className="header-icon-btn mobile-only"
          aria-label="Open navigation menu"
        >
          <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>

        {/* Desktop expand button if sidebar is collapsed */}
        {isCollapsed && (
          <button
            type="button"
            onClick={toggleCollapse}
            className="header-icon-btn desktop-only expand-quick-btn"
            title="Expand menu (Open)"
            aria-label="Expand menu"
          >
            <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <polyline points="9 18 15 12 9 6" />
            </svg>
            <span className="expand-quick-text">Open Menu</span>
          </button>
        )}
      </div>

      <div className="top-banner-right">
        <div className="top-status-indicator">
          <span className="status-ping-dot" />
          <span className="top-status-text">Live System</span>
        </div>
        <Link href="/runs" className="top-quick-link">
          ⚡ n8n Workflows
        </Link>
      </div>
    </div>
  )
}
