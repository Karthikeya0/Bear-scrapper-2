import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

function base(props: IconProps) {
  return {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    ...props,
  }
}

export const IconGrid = (p: IconProps) => (
  <svg {...base(p)}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>
)
export const IconUsers = (p: IconProps) => (
  <svg {...base(p)}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
)
export const IconKanban = (p: IconProps) => (
  <svg {...base(p)}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M8 7v7M12 7v4M16 7v9" /></svg>
)
export const IconTarget = (p: IconProps) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></svg>
)
export const IconMail = (p: IconProps) => (
  <svg {...base(p)}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>
)
export const IconBolt = (p: IconProps) => (
  <svg {...base(p)}><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" /></svg>
)
export const IconSettings = (p: IconProps) => (
  <svg {...base(p)}><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></svg>
)
export const IconLogout = (p: IconProps) => (
  <svg {...base(p)}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></svg>
)
export const IconMenu = (p: IconProps) => (
  <svg {...base(p)}><path d="M4 6h16M4 12h16M4 18h16" /></svg>
)
export const IconPanel = (p: IconProps) => (
  <svg {...base(p)}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" /></svg>
)
export const IconRefresh = (p: IconProps) => (
  <svg {...base(p)}><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" /><path d="M3 21v-5h5" /></svg>
)
export const IconPlus = (p: IconProps) => (
  <svg {...base(p)}><path d="M12 5v14M5 12h14" /></svg>
)
export const IconSearch = (p: IconProps) => (
  <svg {...base(p)}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
)
export const IconArrowLeft = (p: IconProps) => (
  <svg {...base(p)}><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
)
export const IconArrowRight = (p: IconProps) => (
  <svg {...base(p)}><path d="M5 12h14M12 5l7 7-7 7" /></svg>
)
export const IconChevronLeft = (p: IconProps) => (
  <svg {...base(p)}><path d="m15 18-6-6 6-6" /></svg>
)
export const IconChevronRight = (p: IconProps) => (
  <svg {...base(p)}><path d="m9 18 6-6-6-6" /></svg>
)
export const IconX = (p: IconProps) => (
  <svg {...base(p)}><path d="M18 6 6 18M6 6l12 12" /></svg>
)
export const IconCheck = (p: IconProps) => (
  <svg {...base(p)}><path d="M20 6 9 17l-5-5" /></svg>
)
export const IconCheckCircle = (p: IconProps) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" /></svg>
)
export const IconAlert = (p: IconProps) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></svg>
)
export const IconInfo = (p: IconProps) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
)
export const IconExternal = (p: IconProps) => (
  <svg {...base(p)}><path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></svg>
)
export const IconDatabase = (p: IconProps) => (
  <svg {...base(p)}><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3" /></svg>
)
export const IconWorkflow = (p: IconProps) => (
  <svg {...base(p)}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /><path d="M10 6.5h4a2.5 2.5 0 0 1 2.5 2.5v5" /></svg>
)
export const IconSend = (p: IconProps) => (
  <svg {...base(p)}><path d="m22 2-7 20-4-9-9-4z" /><path d="M22 2 11 13" /></svg>
)
export const IconDownload = (p: IconProps) => (
  <svg {...base(p)}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5" /><path d="M12 15V3" /></svg>
)
export const IconFile = (p: IconProps) => (
  <svg {...base(p)}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>
)
export const IconMessage = (p: IconProps) => (
  <svg {...base(p)}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
)
export const IconLock = (p: IconProps) => (
  <svg {...base(p)}><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
)
export const IconSparkle = (p: IconProps) => (
  <svg {...base(p)}><path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z" /><path d="M19 17l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" /></svg>
)
