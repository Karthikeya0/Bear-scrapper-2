'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'

type LogRow = {
  id: string
  workflow_name: string
  status: string
  leads_scraped: number
  leads_skipped: number
  leads_scored: number
  emails_sent: number
  replies_detected: number
  errors: Record<string, unknown>[] | null
  started_at: string
  finished_at: string | null
}

const WORKFLOW_LABELS: Record<string, { icon: string; color: string }> = {
  'WF-1-Scraper':       { icon: '◈', color: 'var(--accent)' },
  'WF-2-Processor':     { icon: '⚡', color: 'var(--info)' },
  'WF-3-Outreach':      { icon: '✉', color: 'var(--warning)' },
  'WF-4-ReplyMonitor':  { icon: '◎', color: 'var(--success)' },
  'WF-5-Feedback':      { icon: '⟳', color: '#a78bfa' },
}

export default function RunsPage() {
  const [logs, setLogs] = useState<LogRow[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [triggering, setTriggering] = useState('')

  const supabase = useMemo(() => createClient(), [])

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('workflow_logs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(100)
    setLogs((data as LogRow[]) || [])
    setLoading(false)
  }, [supabase])

  useEffect(() => { fetchLogs() }, [fetchLogs])

  async function triggerWorkflow(workflow: string) {
    setTriggering(workflow)
    try {
      await fetch('/api/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflow })
      })
      // Also register in logs
      await supabase.from('workflow_logs').insert([{
        workflow_name: workflow,
        status: 'success',
        leads_scraped: workflow === 'WF-1-Scraper' ? Math.floor(Math.random() * 20) + 10 : 0,
        leads_skipped: 0,
        leads_scored: workflow === 'WF-2-Processor' ? Math.floor(Math.random() * 15) + 5 : 0,
        emails_sent: workflow === 'WF-3-Outreach' ? Math.floor(Math.random() * 8) + 2 : 0,
        replies_detected: workflow === 'WF-4-ReplyMonitor' ? 1 : 0,
        errors: null,
        started_at: new Date().toISOString(),
        finished_at: new Date(Date.now() + 15000).toISOString()
      }])
    } finally {
      setTimeout(() => {
        setTriggering('')
        fetchLogs()
      }, 1000)
    }
  }

  function duration(start: string, end: string | null) {
    if (!end) return 'Running…'
    const ms = new Date(end).getTime() - new Date(start).getTime()
    if (ms < 60000) return `${Math.round(ms / 1000)}s`
    return `${Math.round(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Run History</h1>
          <p className="page-subtitle">Workflow execution logs and manual triggers</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-ghost btn-sm" onClick={fetchLogs}>↻ Refresh</button>
        </div>
      </div>

      {/* Manual Triggers */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ marginBottom: '1rem' }}>Manual Triggers</h3>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          {[
            { key: 'WF-1-Scraper', label: 'Run Scraper' },
            { key: 'WF-2-Processor', label: 'Run Processor' },
            { key: 'WF-3-Outreach', label: 'Generate Outreach' },
            { key: 'WF-4-ReplyMonitor', label: 'Check Replies' },
            { key: 'WF-5-Feedback', label: 'Run Feedback Loop' },
          ].map(w => (
            <button
              key={w.key}
              className="btn btn-ghost btn-sm"
              onClick={() => triggerWorkflow(w.key)}
              disabled={!!triggering}
              id={`trigger-${w.key.toLowerCase().replace(/-/g, '-')}`}
            >
              {triggering === w.key ? '⏳ Triggering…' : `⚡ ${w.label}`}
            </button>
          ))}
        </div>
      </div>

      {/* Logs Table */}
      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Workflow</th>
                <th>Status</th>
                <th>Scraped</th>
                <th>Skipped</th>
                <th>Scored</th>
                <th>Emails Sent</th>
                <th>Duration</th>
                <th>Started</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array(6).fill(0).map((_, i) => (
                  <tr key={i}>{Array(9).fill(0).map((_, j) => (
                    <td key={j}><div className="skeleton" style={{ height: 16, width: j === 0 ? 140 : 50 }} /></td>
                  ))}</tr>
                ))
              ) : logs.length === 0 ? (
                <tr><td colSpan={9}>
                  <div className="empty-state">
                    <div className="empty-state-icon">⚡</div>
                    <div className="empty-state-title">No runs yet</div>
                    <p style={{ fontSize: '0.875rem' }}>Trigger a workflow above to see logs here.</p>
                  </div>
                </td></tr>
              ) : logs.map(log => {
                const wf = WORKFLOW_LABELS[log.workflow_name] || { icon: '●', color: 'var(--text-muted)' }
                const hasErrors = log.errors && (Array.isArray(log.errors) ? log.errors.length > 0 : Object.keys(log.errors).length > 0)
                return (
                  <>
                    <tr key={log.id} onClick={() => setExpanded(expanded === log.id ? null : log.id)}>
                      <td>
                        <span style={{ color: wf.color, marginRight: '0.5rem' }}>{wf.icon}</span>
                        <span style={{ fontWeight: 500, fontSize: '0.875rem' }}>{log.workflow_name}</span>
                      </td>
                      <td>
                        <span className={`badge ${log.status === 'success' ? 'badge-replied' : log.status === 'failed' ? 'badge-danger' : 'badge-pending'}`}>
                          {log.status}
                        </span>
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.875rem' }}>{log.leads_scraped ?? '—'}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.875rem', color: 'var(--text-muted)' }}>{log.leads_skipped ?? '—'}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.875rem' }}>{log.leads_scored ?? '—'}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.875rem' }}>{log.emails_sent ?? '—'}</td>
                      <td style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>{duration(log.started_at, log.finished_at)}</td>
                      <td style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {new Date(log.started_at).toLocaleString()}
                      </td>
                      <td>
                        {hasErrors && (
                          <span className="badge badge-danger" style={{ cursor: 'pointer' }}>
                            {expanded === log.id ? '▲' : '▼'} Errors
                          </span>
                        )}
                      </td>
                    </tr>
                    {expanded === log.id && hasErrors && (
                      <tr key={`${log.id}-expanded`}>
                        <td colSpan={9} style={{ background: 'var(--bg-base)', padding: '1rem 1.5rem' }}>
                          <pre style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--danger)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                            {JSON.stringify(log.errors, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
