'use client'
import { useEffect, type ReactNode } from 'react'
import { humanize } from '@/lib/format'
import { IconAlert, IconCheckCircle, IconInfo, IconX } from './icons'

type Tone = 'green' | 'amber' | 'red' | 'blue' | 'violet' | 'accent' | 'gray'

const STATUS_TONES: Record<string, Tone> = {
  // leads
  scored: 'blue', contacted: 'violet', replied: 'green', converted: 'green',
  dead: 'gray', unsubscribed: 'gray', disqualified: 'gray', bounced: 'red',
  // outreach
  pending_review: 'amber', approved: 'blue', sent: 'green', rejected: 'gray',
  // projects / tasks
  todo: 'gray', in_progress: 'blue', review: 'amber', delivered: 'green',
  // clients
  active: 'green', lead: 'amber', past: 'gray',
  // runs
  success: 'green', failed: 'red', running: 'blue',
  // deliverables
  revision_requested: 'red',
  // priority
  urgent: 'red', high: 'amber', medium: 'blue', low: 'gray',
}

export function Badge({ tone = 'gray', children, plain }: { tone?: Tone; children: ReactNode; plain?: boolean }) {
  return <span className={`badge ${tone === 'gray' ? '' : tone} ${plain ? 'plain' : ''}`}>{children}</span>
}

export function StatusBadge({ status, plain }: { status?: string | null; plain?: boolean }) {
  if (!status) return <span className="subtle">—</span>
  return (
    <Badge tone={STATUS_TONES[status] ?? 'gray'} plain={plain}>
      {humanize(status)}
    </Badge>
  )
}

export function ScoreBadge({ score, large }: { score?: number | null; large?: boolean }) {
  const s = Number(score) || 0
  const cls = s >= 70 ? 'high' : s >= 40 ? 'mid' : 'low'
  return (
    <span className={`score ${cls} ${large ? 'lg' : ''}`} title="AI fit score (0–100)">
      {s}
    </span>
  )
}

export function PageHeader({
  title,
  description,
  actions,
  back,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  back?: ReactNode
}) {
  return (
    <div className="page-head">
      <div style={{ minWidth: 0 }}>
        {back}
        <h1 className="page-title">{title}</h1>
        {description && <p className="page-desc">{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  text,
  action,
}: {
  icon?: ReactNode
  title: string
  text?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon">{icon}</div>}
      <div className="empty-title">{title}</div>
      {text && <div className="empty-text">{text}</div>}
      {action}
    </div>
  )
}

export function Alert({
  tone = 'error',
  title,
  children,
  action,
}: {
  tone?: 'error' | 'warn' | 'info' | 'success'
  title?: string
  children?: ReactNode
  action?: ReactNode
}) {
  const Icon = tone === 'success' ? IconCheckCircle : tone === 'info' ? IconInfo : IconAlert
  return (
    <div className={`alert ${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon />
      <div style={{ minWidth: 0 }}>
        {title && <div className="alert-title">{title}</div>}
        {children && <div>{children}</div>}
      </div>
      {action}
    </div>
  )
}

export function Spinner() {
  return <span className="spinner" aria-hidden />
}

export function SkeletonRows({ rows = 5, cols }: { rows?: number; cols: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i}>
          {Array.from({ length: cols }).map((__, j) => (
            <td key={j}>
              <div className="skeleton" style={{ height: 14, width: j === 0 ? '70%' : '50%' }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="drawer" role="dialog" aria-modal="true" aria-label={title}>
        <div className="drawer-head">
          <div>
            <div className="drawer-title">{title}</div>
            {description && <div className="drawer-desc">{description}</div>}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <IconX />
          </button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </div>
    </div>
  )
}
