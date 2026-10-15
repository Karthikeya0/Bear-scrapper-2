import Sidebar from '@/components/Sidebar'
import { DashboardShell } from '@/components/DashboardShell'
import HeaderBar from '@/components/HeaderBar'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardShell>
      <Sidebar />
      <div className="main-content">
        <HeaderBar />
        <div className="main-scrollable">
          {children}
        </div>
      </div>
    </DashboardShell>
  )
}
