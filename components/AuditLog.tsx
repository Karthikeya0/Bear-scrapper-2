'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatDateTime } from '@/lib/format'
import { EmptyState } from './ui'
import { IconRefresh, IconWorkflow } from './icons'

type Entry = { id: string; created_at: string; actor: string; action: string; details: Record<string, unknown> | null }

const ACTOR: Record<string, string> = {
  dashboard: 'You (dashboard)', 'owner-email': 'You (email reply)', 'n8n:WF-3': 'Draft outreach', 'n8n:WF-3b': 'Send approved',
  'n8n:WF-4': 'Check replies', 'n8n:WF-6': 'Daily digest',
}

/** One readable line per audit_log row. */
function describe(e: Entry) {
  const d = e.details ?? {}
  const count = (d.count as number | undefined) ?? (Array.isArray(d.outreach_ids) ? d.outreach_ids.length : undefined)
  switch (e.action) {
    case 'sent': return `Sent “${String(d.subject ?? '')}” to ${String(d.to ?? '')}`
    case 'approved': return 'Approved one email to send now'
    case 'approved_all': return `Approved ${count ?? ''} email${count === 1 ? '' : 's'} to send through the day`
    case 'auto_scheduled': return `Autopilot scheduled “${String(d.subject ?? '')}” without review`
    case 'digest_sent': return `Daily email sent to ${String(d.to ?? '')} with ${count ?? 0} draft${count === 1 ? '' : 's'} (#${String(d.code ?? '')})`
    case 'owner_command': return `Read your reply “${String(d.text ?? '')}” → ${String(d.command ?? '')}`
    case 'paused': return 'STOP ALL: paused everything'
    case 'resumed': return 'Resumed'
    case 'settings_saved': return `Changed settings: ${Array.isArray(d.changed) ? d.changed.join(', ') : ''}`
    case 'workflow_started': return `Started ${String(d.workflow ?? '')}`
    default: return e.action
  }
}

/** The append-only trail of everything the system and you did (migration 006). */
export default function AuditLog() {
  const supabase = useMemo(() => createClient(), [])
  const [rows, setRows] = useState<Entry[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.from('audit_log').select('id, created_at, actor, action, details').order('created_at', { ascending: false }).limit(100)
    setError(error ? (/audit_log/.test(error.message) ? 'Run supabase/migrations/006_autopilot.sql in Supabase to turn on the audit log.' : error.message) : '')
    setRows((data ?? []) as Entry[])
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load
    load()
  }, [load])

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">Audit log</div>
          <div className="card-desc">Every send, approval, pause and autopilot decision, newest first</div>
        </div>
        <button className="btn btn-sm" onClick={load} disabled={loading}><IconRefresh className="icon" /> Refresh</button>
      </div>
      {error ? (
        <div className="card-pad hint">{error}</div>
      ) : rows.length === 0 && !loading ? (
        <EmptyState icon={<IconWorkflow />} title="Nothing logged yet" text="Approvals, sends and autopilot decisions will appear here." />
      ) : (
        <ul className="audit-list">
          {rows.map(r => (
            <li key={r.id} className="audit-item">
              <span className="audit-time">{formatDateTime(r.created_at)}</span>
              <span className="audit-actor">{ACTOR[r.actor] ?? r.actor}</span>
              <span className="audit-text">{describe(r)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
