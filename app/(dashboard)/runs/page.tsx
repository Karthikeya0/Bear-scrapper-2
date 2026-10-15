'use client'
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/Toast'
import { Alert, EmptyState, PageHeader, SkeletonRows, Spinner, StatusBadge } from '@/components/ui'
import { IconBolt, IconChevronRight, IconRefresh, IconWorkflow } from '@/components/icons'
import { formatDateTime, timeAgo } from '@/lib/format'
import { WORKFLOWS, triggerWorkflow, type WorkflowKey } from '@/lib/workflows'

type LogRow = {
  id: string; workflow_name: string; status: string
  leads_scraped: number | null; leads_skipped: number | null; leads_scored: number | null
  emails_sent: number | null; replies_detected: number | null
  errors: unknown; started_at: string; finished_at: string | null
}

function duration(start: string, end: string | null) {
  if (!end) return 'Running…'
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (!Number.isFinite(ms) || ms < 0) return '—'
  if (ms < 60000) return `${Math.round(ms / 1000)}s`
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
}

function hasErrors(errors: unknown) {
  if (!errors) return false
  if (Array.isArray(errors)) return errors.length > 0
  if (typeof errors === 'object') return Object.keys(errors as object).length > 0
  return true
}

export default function RunsPage() {
  const supabase = useMemo(() => createClient(), [])
  const toast = useToast()
  const [logs, setLogs] = useState<LogRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [triggering, setTriggering] = useState<WorkflowKey | ''>('')
  const [failures24h, setFailures24h] = useState(0)
  const [lastResult, setLastResult] = useState<Record<string, { ok: boolean; at: string; error?: string }>>({})

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.from('workflow_logs').select('*').order('started_at', { ascending: false }).limit(100)
    if (error) setError(error.message)
    else {
      setError('')
      const rows = (data ?? []) as LogRow[]
      const cutoff = Date.now() - 86400000
      setLogs(rows)
      setFailures24h(rows.filter(l => l.status === 'failed' && new Date(l.started_at).getTime() > cutoff).length)
    }
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load
    load()
    const channel = supabase
      .channel('runs-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workflow_logs' }, () => load())
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [load, supabase])

  async function run(key: WorkflowKey, label: string) {
    setTriggering(key)
    const res = await triggerWorkflow(key)
    setTriggering('')
    setLastResult(prev => ({ ...prev, [key]: { ok: res.ok, at: new Date().toISOString(), error: res.error } }))
    if (res.ok) toast.success(`${label} started in n8n.`)
    else toast.error(res.error ?? `Could not start ${label}.`)
  }

  const lastRunByWorkflow = useMemo(() => {
    const map: Record<string, LogRow> = {}
    for (const l of logs) if (!map[l.workflow_name]) map[l.workflow_name] = l
    return map
  }, [logs])

  return (
    <>
      <PageHeader
        title="Workflows"
        description="Trigger your n8n automations on demand and review their run history."
        actions={
          <button className="btn" onClick={load} disabled={loading}>
            <IconRefresh className="icon" /> Refresh
          </button>
        }
      />

      {failures24h > 0 && (
        <Alert tone="warn" title={`${failures24h} failed run${failures24h > 1 ? 's' : ''} in the last 24 hours`}>
          Expand a failed run below to see the error reported by n8n.
        </Alert>
      )}

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="row-between" style={{ marginBottom: 14 }}>
          <div>
            <div className="card-title">Run a workflow</div>
            <div className="card-desc">Sends a signed POST to the workflow&apos;s n8n webhook. Results show up below as n8n logs them.</div>
          </div>
        </div>
        <div className="wf-grid">
          {WORKFLOWS.map(w => {
            const last = lastRunByWorkflow[w.key]
            const result = lastResult[w.key]
            return (
              <div key={w.key} className="wf-card">
                <div className="row-between">
                  <span className="wf-name">{w.label}</span>
                  <span className="tag mono" style={{ fontSize: 11 }}>{w.key.split('-').slice(0, 2).join('-')}</span>
                </div>
                <div className="wf-desc">{w.description}</div>
                <div className="hint">
                  {result && !result.ok ? (
                    <span className="overdue">{result.error}</span>
                  ) : last ? (
                    <>Last logged run {timeAgo(last.started_at)} · <StatusBadge status={last.status} plain /></>
                  ) : (
                    'No runs logged yet'
                  )}
                </div>
                <button className="btn btn-sm" onClick={() => run(w.key, w.label)} disabled={!!triggering}>
                  {triggering === w.key ? <Spinner /> : <IconBolt className="icon" />}
                  {triggering === w.key ? 'Starting…' : 'Run now'}
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {error && <Alert title="Could not load run history">{error}</Alert>}

      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">Run history</div>
            <div className="card-desc">Rows written by n8n to the workflow_logs table</div>
          </div>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 28 }} />
                <th>Workflow</th>
                <th>Status</th>
                <th className="t-right">Scraped</th>
                <th className="t-right">Scored</th>
                <th className="t-right">Sent</th>
                <th className="t-right">Replies</th>
                <th>Duration</th>
                <th className="t-right">Started</th>
              </tr>
            </thead>
            <tbody>
              {loading && logs.length === 0 ? (
                <SkeletonRows rows={6} cols={9} />
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={9}>
                    <EmptyState icon={<IconWorkflow />} title="No runs logged yet" text="Runs appear here once an n8n workflow writes to workflow_logs." />
                  </td>
                </tr>
              ) : (
                logs.map(log => {
                  const errs = hasErrors(log.errors)
                  const open = expanded === log.id
                  return (
                    <Fragment key={log.id}>
                      <tr className={errs ? 'clickable' : ''} onClick={() => errs && setExpanded(open ? null : log.id)}>
                        <td>
                          {errs && (
                            <IconChevronRight width={14} height={14} style={{ transform: open ? 'rotate(90deg)' : undefined, transition: 'transform .15s', color: 'var(--text-tertiary)' }} />
                          )}
                        </td>
                        <td className="cell-title">{log.workflow_name}</td>
                        <td><StatusBadge status={log.status} /></td>
                        <td className="t-right num">{log.leads_scraped ?? 0}</td>
                        <td className="t-right num">{log.leads_scored ?? 0}</td>
                        <td className="t-right num">{log.emails_sent ?? 0}</td>
                        <td className="t-right num">{log.replies_detected ?? 0}</td>
                        <td className="subtle">{duration(log.started_at, log.finished_at)}</td>
                        <td className="t-right subtle" style={{ whiteSpace: 'nowrap' }}>{formatDateTime(log.started_at)}</td>
                      </tr>
                      {open && (
                        <tr>
                          <td colSpan={9} style={{ background: 'var(--bg-subtle)' }}>
                            <pre className="pre">{JSON.stringify(log.errors, null, 2)}</pre>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
