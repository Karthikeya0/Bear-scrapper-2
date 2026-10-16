'use client'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { clearStarted, onStartedChange, readStarted, type StartedMap } from '@/lib/activity'
import { timeAgo } from '@/lib/format'
import { triggerWorkflow, WORKFLOW_LABELS, WORKFLOWS } from '@/lib/workflows'
import { useToast } from './Toast'
import { IconActivity, IconArrowRight, IconX } from './icons'
import { Spinner } from './ui'

type Log = {
  workflow_name: string; status: string; created_at: string; leads_scraped: number | null; leads_scored: number | null
  leads_skipped: number | null; emails_sent: number | null; replies_detected: number | null; errors: { message?: string }[] | null
}
type Counts = { raw: number; scheduled: number; sending: number; failedScores: number }
type Row = { key: string; label: string; state: 'running' | 'stuck' | 'success' | 'failed' | 'never'; when: string | null; text: string }

const RUNNING_TIMEOUT_MS = 10 * 60 * 1000
const SHOWN = [...WORKFLOWS.map(w => w.key), 'WF-3b-SendApproved'] as string[]

/** One line describing what a finished run did. */
function summary(log: Log) {
  const err = Array.isArray(log.errors) ? log.errors.find(e => e?.message)?.message : undefined
  if (log.status === 'failed' && err) return err
  switch (log.workflow_name) {
    case 'WF-1-Scraper': return `${log.leads_scraped ?? 0} new leads found, ${log.leads_skipped ?? 0} already known`
    case 'WF-2-Processor': return `${log.leads_scored ?? 0} qualified and saved, ${log.leads_skipped ?? 0} filtered out`
    case 'WF-3-Outreach': return `${log.leads_scored ?? 0} drafts written${log.leads_skipped ? `, ${log.leads_skipped} failed` : ''}`
    case 'WF-3b-SendApproved': return log.status === 'success' ? 'Email sent' : err ?? 'Not sent'
    case 'WF-4-ReplyMonitor': return `${log.replies_detected ?? 0} new replies, ${log.leads_skipped ?? 0} bounces`
    default: return err ?? (log.status === 'success' ? 'Finished' : 'Failed')
  }
}

export default function ActivityMenu() {
  const supabase = useMemo(() => createClient(), [])
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [logs, setLogs] = useState<Record<string, Log>>({})
  const [counts, setCounts] = useState<Counts | null>(null)
  const [started, setStarted] = useState<StartedMap>({})
  const [now, setNow] = useState(0)
  const [scoring, setScoring] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    const [logRes, raw, scheduled, sending, failed] = await Promise.all([
      supabase
        .from('workflow_logs')
        .select('workflow_name, status, created_at, leads_scraped, leads_scored, leads_skipped, emails_sent, replies_detected, errors')
        .order('created_at', { ascending: false })
        .limit(60),
      supabase.from('raw_leads').select('id', { count: 'exact', head: true }).eq('status', 'raw'),
      supabase.from('outreach_queue').select('id', { count: 'exact', head: true }).eq('status', 'scheduled'),
      supabase.from('outreach_queue').select('id', { count: 'exact', head: true }).eq('status', 'approved'),
      supabase.from('leads').select('id', { count: 'exact', head: true }).ilike('ai_reasoning', 'Groq error:%'),
    ])
    const latest: Record<string, Log> = {}
    for (const l of (logRes.data ?? []) as Log[]) latest[l.workflow_name] ??= l
    setLogs(latest)
    setCounts({ raw: raw.count ?? 0, scheduled: scheduled.count ?? 0, sending: sending.count ?? 0, failedScores: failed.count ?? 0 })
    setNow(Date.now())

    // A workflow this browser started has finished once a log newer than the start time exists.
    const marks = readStarted()
    for (const [key, ts] of Object.entries(marks)) {
      const log = latest[key]
      if (log && Date.parse(log.created_at) >= ts - 5000) {
        clearStarted(key)
        const label = WORKFLOW_LABELS[key] ?? key
        if (log.status === 'failed') toast.error(`${label} failed: ${summary(log)}`)
        else toast.success(`${label} finished — ${summary(log)}.`)
      }
    }
    setStarted(readStarted())
  }, [supabase, toast])

  // Poll fast while something runs, slowly otherwise; also refresh on any new run log.
  const anyRunning = Object.values(started).some(ts => now - ts < RUNNING_TIMEOUT_MS)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load
    load()
    const timer = setInterval(load, anyRunning ? 4000 : 30000)
    return () => clearInterval(timer)
  }, [load, anyRunning])

  useEffect(() => {
    const off = onStartedChange(() => {
      setStarted(readStarted())
      setNow(Date.now())
    })
    const channel = supabase
      .channel('activity-logs')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'workflow_logs' }, () => load())
      .subscribe()
    return () => {
      off()
      supabase.removeChannel(channel)
    }
  }, [supabase, load])

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  const rows: Row[] = SHOWN.map(key => {
    const log = logs[key]
    const ts = started[key]
    const label = WORKFLOW_LABELS[key] ?? key
    if (ts && now - ts < RUNNING_TIMEOUT_MS) return { key, label, state: 'running', when: new Date(ts).toISOString(), text: 'Running in n8n…' }
    if (ts) return { key, label, state: 'stuck', when: new Date(ts).toISOString(), text: 'Started but n8n never reported back — open its Executions in n8n to see why.' }
    if (!log) return { key, label, state: 'never', when: null, text: 'No runs yet' }
    return { key, label, state: log.status === 'failed' ? 'failed' : 'success', when: log.created_at, text: summary(log) }
  })

  const running = rows.filter(r => r.state === 'running')
  const problems = rows.filter(r => r.state === 'failed' || r.state === 'stuck').length + (counts?.failedScores ? 1 : 0)
  const busy = running.length > 0 || (counts?.sending ?? 0) > 0

  async function scoreNow() {
    setScoring(true)
    const res = await triggerWorkflow('WF-2-Processor')
    setScoring(false)
    if (!res.ok) toast.error(res.error ?? 'Could not start WF-2.')
    load()
  }

  return (
    <div className="activity" ref={ref}>
      <button
        className={`activity-btn ${busy ? 'busy' : problems ? 'bad' : 'ok'}`}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="What your workflows are doing"
      >
        {busy ? <Spinner /> : <IconActivity className="icon" />}
        <span className="activity-label">
          {running.length ? `${running[0].label}${running.length > 1 ? ` +${running.length - 1}` : ''}…` : busy ? 'Sending…' : problems ? `${problems} issue${problems > 1 ? 's' : ''}` : 'Activity'}
        </span>
      </button>

      {open && (
        <div className="activity-panel fade-in" role="dialog" aria-label="Workflow activity">
          <div className="row-between activity-head">
            <strong>Activity</strong>
            <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close"><IconX /></button>
          </div>

          {counts && (counts.raw > 0 || counts.scheduled > 0 || counts.sending > 0 || counts.failedScores > 0) && (
            <div className="activity-queue">
              {counts.raw > 0 && (
                <div className="activity-q">
                  <span><strong>{counts.raw}</strong> {counts.raw === 1 ? 'lead' : 'leads'} waiting to be scored <span className="subtle">· WF-2 does 25 per run, every hour</span></span>
                  <button className="btn btn-sm" onClick={scoreNow} disabled={scoring || rows.find(r => r.key === 'WF-2-Processor')?.state === 'running'}>
                    {scoring && <Spinner />} Score now
                  </button>
                </div>
              )}
              {counts.scheduled > 0 && <div className="activity-q"><span><strong>{counts.scheduled}</strong> {counts.scheduled === 1 ? 'email' : 'emails'} scheduled <span className="subtle">· one every 10 min in your send window</span></span></div>}
              {counts.sending > 0 && <div className="activity-q"><span><strong>{counts.sending}</strong> {counts.sending === 1 ? 'email' : 'emails'} being sent by Gmail</span></div>}
              {counts.failedScores > 0 && (
                <div className="activity-q bad">
                  <span><strong>{counts.failedScores}</strong> {counts.failedScores === 1 ? 'lead' : 'leads'} failed AI scoring</span>
                  <Link className="link" href="/outreach" onClick={() => setOpen(false)}>Fix</Link>
                </div>
              )}
            </div>
          )}

          <ul className="activity-list">
            {rows.map(r => (
              <li key={r.key} className={`activity-item ${r.state}`}>
                <span className="activity-dot" aria-hidden>{r.state === 'running' ? <Spinner /> : null}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="row-between" style={{ gap: 8 }}>
                    <span className="activity-name">{r.label}</span>
                    <span className="subtle activity-when">
                      {r.state === 'running' ? `started ${timeAgo(r.when)}` : r.when ? timeAgo(r.when) : ''}
                    </span>
                  </div>
                  <div className="activity-text">{r.text}</div>
                </div>
              </li>
            ))}
          </ul>
          <Link className="activity-foot" href="/runs" onClick={() => setOpen(false)}>
            Full run history <IconArrowRight className="icon" />
          </Link>
        </div>
      )}
    </div>
  )
}
