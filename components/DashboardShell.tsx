'use client'
import React, { createContext, useContext, useState, useEffect } from 'react'

interface SidebarContextType {
  isCollapsed: boolean
  isMobileOpen: boolean
  toggleCollapse: () => void
  toggleMobile: () => void
  closeMobile: () => void
}

const SidebarContext = createContext<SidebarContextType>({
  isCollapsed: false,
  isMobileOpen: false,
  toggleCollapse: () => {},
  toggleMobile: () => {},
  closeMobile: () => {},
})

export const useSidebar = () => useContext(SidebarContext)

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [isMobileOpen, setIsMobileOpen] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const saved = localStorage.getItem('bear_sidebar_collapsed')
    if (saved !== null) {
      setIsCollapsed(saved === 'true')
    }
  }, [])

  const toggleCollapse = () => {
    setIsCollapsed(prev => {
      const next = !prev
      localStorage.setItem('bear_sidebar_collapsed', String(next))
      return next
    })
  }

  const toggleMobile = () => setIsMobileOpen(prev => !prev)
  const closeMobile = () => setIsMobileOpen(false)

  return (
    <SidebarContext.Provider
      value={{
        isCollapsed,
        isMobileOpen,
        toggleCollapse,
        toggleMobile,
        closeMobile,
      }}
    >
      <div
        className={`app-shell ${mounted && isCollapsed ? 'sidebar-collapsed' : ''} ${
          isMobileOpen ? 'mobile-open' : ''
        }`}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  )
}
