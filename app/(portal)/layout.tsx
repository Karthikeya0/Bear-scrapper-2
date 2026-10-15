import Link from 'next/link'

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="layout">
      {/* Super minimal portal header */}
      <header style={{ 
        padding: '1.5rem 2rem', 
        display: 'flex', 
        justifyContent: 'space-between',
        alignItems: 'center',
        position: 'absolute',
        top: 0, left: 0, right: 0,
        zIndex: 10
      }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', letterSpacing: '0.05em', color: 'var(--text-on-dark)' }}>
          BEAR STUDIOS
        </div>
      </header>

      <main className="fade-in" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {children}
      </main>
    </div>
  )
}
