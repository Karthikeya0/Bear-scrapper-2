'use client'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/Toast'
import { Alert, Badge, EmptyState, PageHeader, ScoreBadge, Spinner, StatusBadge } from '@/components/ui'
import { IconBolt, IconCheck, IconExternal, IconMail, IconMessage, IconRefresh, IconSend, IconX } from '@/components/icons'
import { formatDateTime, timeAgo } from '@/lib/format'
import { MIN_SCORE, scoringFailed } from '@/lib/outreach'
import { triggerWorkflow } from '@/lib/workflows'
import { markStarted } from '@/lib/activity'

type Tab = 'pending_review' | 'scheduled' | 'approved' | 'sent' | 'rejected'
type QueueItem = {
  id: string; lead_id: string; subject: string; body: string; status: Tab; sequence_step: number | null
  channel: 'email' | 'dm' | null; created_at: string; approved_at: string | null; sent_at: string | null
  lead: {
    name: string | null; company: string | null; email: string | null; ai_score: number | null
    status: string | null; x_handle: string | null; linkedin_url: string | null
  } | null
}

type DraftRun =
  | { phase: 'idle' }
  | { phase: 'running'; startedAt: number; pendingBefore: number }
  | { phase: 'done'; tone: 'success' | 'warn' | 'error'; title: string; text: string }

type RunLog = { status: string; leads_scored: number | null; errors: { message?: string }[] | null; created_at: string }

type Pipeline = {
  waiting: number; total: number; failed: number; failReason: string | null; low: number; good: number; drafted: number
  readyEmail: number; readyDm: number; noContact: number; other: number
}

const POLL_MS = 3000
const RUN_TIMEOUT_MS = 4 * 60 * 1000

const TABS: { key: Tab; label: string }[] = [
  { key: 'pending_review', label: 'Needs review' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'approved', label: 'Sending' },
  { key: 'sent', label: 'Sent' },
  { key: 'rejected', label: 'Rejected' },
]

const isDm = (item: QueueItem) => item.channel === 'dm'

function kindLabel(item: QueueItem) {
  if (isDm(item)) return <Badge tone="violet" plain>DM</Badge>
  if ((item.sequence_step ?? 1) > 1) return <Badge tone="blue" plain>Follow-up {item.sequence_step}</Badge>
  return <Badge tone="accent" plain>Email</Badge>
}

function safeHttpUrl(value: string | null | undefined) {
  if (!value) return null
  try {
    const u = new URL(value)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null
  } catch {
    return null
  }
}

function OutreachInner() {
  const params = useSearchParams()
  const initialTab = (TABS.find(t => t.key === params.get('tab'))?.key ?? 'pending_review') as Tab
  const supabase = useMemo(() => createClient(), [])
  const toast = useToast()

  const [tab, setTab] = useState<Tab>(initialTab)
  const [items, setItems] = useState<QueueItem[]>([])
  const [counts, setCounts] = useState<Record<Tab, number>>({ pending_review: 0, scheduled: 0, approved: 0, sent: 0, rejected: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState<'' | 'approve' | 'reject' | 'save' | 'requeue' | 'dm'>('')
  const [generating, setGenerating] = useState(false)
  const [run, setRun] = useState<DraftRun>({ phase: 'idle' })
  const [pipeline, setPipeline] = useState<Pipeline | null>(null)
  const [pipelineError, setPipelineError] = useState('')
  const [lastRun, setLastRun] = useState<RunLog | null>(null)
  const [bulk, setBulk] = useState<'' | 'schedule' | 'rescore'>('')

  const selected = items.find(i => i.id === selectedId) ?? null
  const dirty = !!selected && (subject !== selected.subject || body !== selected.body)

  const load = useCallback(async () => {
    setLoading(true)
    const [list, ...countResults] = await Promise.all([
      supabase
        .from('outreach_queue')
        .select('*, lead:leads(name, company, email, ai_score, status, x_handle, linkedin_url)')
        .eq('status', tab)
        .order(tab === 'scheduled' ? 'approved_at' : 'created_at', { ascending: tab === 'pending_review' || tab === 'scheduled' })
        .limit(200),
      ...TABS.map(t => supabase.from('outreach_queue').select('id', { count: 'exact', head: true }).eq('status', t.key)),
    ])
    if (list.error) setError(list.error.message)
    else {
      setError('')
      setItems((list.data ?? []) as QueueItem[])
    }
    setCounts(Object.fromEntries(TABS.map((t, i) => [t.key, countResults[i].count ?? 0])) as Record<Tab, number>)
    setLoading(false)
  }, [supabase, tab])

  // Where every lead stands, so the page can say exactly why nothing (or how much) can be drafted.
  const loadPipeline = useCallback(async () => {
    type Row = {
      email: string | null; ai_score: number | null; status: string | null; outreach_eligible: boolean | null
      x_handle: string | null; linkedin_url: string | null; ai_reasoning: string | null; outreach_queue: { id: string }[] | null
    }
    const rows: Row[] = []
    for (let from = 0; from < 5000; from += 1000) {
      const { data, error } = await supabase
        .from('leads')
        .select('email, ai_score, status, outreach_eligible, x_handle, linkedin_url, ai_reasoning, outreach_queue(id)')
        .range(from, from + 999)
      if (error) {
        setPipelineError(error.message)
        return
      }
      rows.push(...((data ?? []) as Row[]))
      if (!data || data.length < 1000) break
    }
    const reasons = new Map<string, number>()
    const { count: waiting } = await supabase.from('raw_leads').select('id', { count: 'exact', head: true }).eq('status', 'raw')
    const p: Pipeline = { waiting: waiting ?? 0, total: rows.length, failed: 0, failReason: null, low: 0, good: 0, drafted: 0, readyEmail: 0, readyDm: 0, noContact: 0, other: 0 }
    for (const l of rows) {
      if (scoringFailed(l.ai_reasoning)) {
        p.failed++
        const reason = String(l.ai_reasoning).replace(/^Groq error:\s*/, '').split('\n')[0]
        reasons.set(reason, (reasons.get(reason) ?? 0) + 1)
        continue
      }
      if ((l.ai_score ?? 0) < MIN_SCORE) { p.low++; continue }
      p.good++
      if ((l.outreach_queue ?? []).length) { p.drafted++; continue }
      if (l.status !== 'scored') { p.other++; continue }
      if (l.email) {
        if (l.outreach_eligible === false) p.other++
        else p.readyEmail++
      } else if (l.x_handle || l.linkedin_url) p.readyDm++
      else p.noContact++
    }
    p.failReason = [...reasons.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
    setPipelineError('')
    setPipeline(p)
    const { data: logs } = await supabase
      .from('workflow_logs')
      .select('status, leads_scored, errors, created_at')
      .eq('workflow_name', 'WF-3-Outreach')
      .order('created_at', { ascending: false })
      .limit(1)
    setLastRun((logs?.[0] ?? null) as RunLog | null)
  }, [supabase])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load
    loadPipeline()
  }, [loadPipeline])

  // While WF-3 runs, poll for its run log so the page can say when it finished and what it did.
  useEffect(() => {
    if (run.phase !== 'running') return
    const timer = setInterval(async () => {
      const since = new Date(run.startedAt - 5000).toISOString()
      const { data } = await supabase
        .from('workflow_logs')
        .select('status, leads_scored, errors, created_at')
        .eq('workflow_name', 'WF-3-Outreach')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(1)
      const log = (data?.[0] ?? null) as RunLog | null
      if (log) {
        const drafted = log.leads_scored ?? 0
        const firstError = Array.isArray(log.errors) ? log.errors.find(e => e?.message)?.message : undefined
        if (drafted > 0) {
          setRun({ phase: 'done', tone: 'success', title: `${drafted} new ${drafted === 1 ? 'draft' : 'drafts'} ready for review`, text: firstError ? `Some could not be drafted: ${firstError}` : 'Open each one below, edit if you like, then approve it — or use Approve all.' })
        } else if (firstError) {
          setRun({ phase: 'done', tone: 'error', title: 'No drafts were written', text: firstError })
        } else {
          setRun({ phase: 'done', tone: 'warn', title: 'Nothing to draft right now', text: 'See “Pipeline” below for why: every lead is either drafted already, scored under the threshold, or missing contact details.' })
        }
        setTab('pending_review')
        load()
        loadPipeline()
      } else if (Date.now() - run.startedAt > RUN_TIMEOUT_MS) {
        setRun({ phase: 'done', tone: 'error', title: 'WF-3 has not reported back', text: 'It stopped before writing its run log. Open n8n → WF-3: Draft Outreach → Executions, click the newest run and look for the red node. Make sure you imported the latest WF3-draft-outreach.json and published it.' })
      }
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [run, supabase, load, loadPipeline])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data load on tab change
    load()
    const channel = supabase
      .channel(`outreach-${tab}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'outreach_queue' }, () => load())
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [load, supabase, tab])

  function select(item: QueueItem | null) {
    setSelectedId(item?.id ?? null)
    setSubject(item?.subject ?? '')
    setBody(item?.body ?? '')
  }

  function removeAndAdvance(id: string) {
    const idx = items.findIndex(i => i.id === id)
    const rest = items.filter(i => i.id !== id)
    setItems(rest)
    select(rest[idx] ?? null)
  }

  async function approve() {
    if (!selected) return
    setBusy('approve')
    try {
      const res = await fetch('/api/approve-outreach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outreach_id: selected.id, subject, body }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) throw new Error(data.error ?? `Request failed (HTTP ${res.status}).`)
      toast.success(`Sending now to ${selected.lead?.email ?? 'the lead'}.`)
      removeAndAdvance(selected.id)
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
      load()
    } finally {
      setBusy('')
    }
  }

  async function setStatus(status: Tab, kind: 'reject' | 'requeue', message: string) {
    if (!selected) return
    setBusy(kind)
    const fields: Record<string, unknown> =
      status === 'rejected' ? { status, rejected_at: new Date().toISOString() } : { status, approved_at: null }
    const { error } = await supabase.from('outreach_queue').update(fields).eq('id', selected.id)
    setBusy('')
    if (error) return toast.error(error.message)
    toast.success(message)
    removeAndAdvance(selected.id)
    load()
  }

  async function saveDraft() {
    if (!selected) return
    setBusy('save')
    const { error } = await supabase.from('outreach_queue').update({ subject, body }).eq('id', selected.id)
    setBusy('')
    if (error) return toast.error(error.message)
    setItems(prev => prev.map(i => (i.id === selected.id ? { ...i, subject, body } : i)))
    toast.success('Draft saved.')
  }

  // DMs are sent by hand: copy the text, open their profile, then mark it sent here.
  async function copyDm() {
    try {
      await navigator.clipboard.writeText(body)
      toast.success('Message copied. Paste it into the DM.')
    } catch {
      toast.error('Could not copy automatically — select the text and copy it.')
    }
  }

  async function markDmSent() {
    if (!selected) return
    setBusy('dm')
    const now = new Date().toISOString()
    const { error } = await supabase.from('outreach_queue').update({ status: 'sent', sent_at: now, body, subject }).eq('id', selected.id)
    if (!error && selected.lead?.status === 'scored') {
      await supabase.from('leads').update({ status: 'contacted', first_contacted_at: now }).eq('id', selected.lead_id).eq('status', 'scored')
    }
    setBusy('')
    if (error) return toast.error(error.message)
    toast.success('Marked as sent.')
    removeAndAdvance(selected.id)
    load()
  }

  async function generate() {
    setGenerating(true)
    const startedAt = Date.now()
    const res = await triggerWorkflow('WF-3-Outreach')
    setGenerating(false)
    if (res.ok) setRun({ phase: 'running', startedAt, pendingBefore: counts.pending_review })
    else setRun({ phase: 'done', tone: 'error', title: 'Could not start WF-3', text: res.error ?? 'The outreach workflow did not start.' })
  }

  async function post(url: string, kind: 'schedule' | 'rescore') {
    setBulk(kind)
    try {
      const res = await fetch(url, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) throw new Error(data.error ?? `Request failed (HTTP ${res.status}).`)
      return data as { count: number; warning?: string }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
      return null
    } finally {
      setBulk('')
    }
  }

  async function approveAll() {
    const data = await post('/api/outreach/schedule-all', 'schedule')
    if (!data) return
    if (!data.count) toast.info('No email drafts to schedule (DMs are sent by hand).')
    else toast.success(`${data.count} ${data.count === 1 ? 'email' : 'emails'} scheduled. WF-3b sends them one at a time within your daily limit.`)
    select(null)
    load()
  }

  async function rescore() {
    const data = await post('/api/leads/rescore', 'rescore')
    if (!data) return
    if (data.warning) toast.error(data.warning)
    else if (data.count) {
      markStarted('WF-2-Processor')
      toast.success(`${data.count} leads sent back to WF-2. Follow progress under Activity (top right).`)
    } else toast.success('No failed scores to retry.')
    loadPipeline()
  }

  const drafting = run.phase === 'running'
  const editable = selected?.status === 'pending_review' || selected?.status === 'scheduled'
  const emailDraftsWaiting = items.filter(i => i.status === 'pending_review' && !isDm(i) && i.lead?.email).length
  const readyTotal = pipeline ? pipeline.readyEmail + pipeline.readyDm : 0

  return (
    <>
      <PageHeader
        title="Outreach queue"
        description="Review AI-drafted emails and DMs. Emails go out from your Gmail only after you approve them."
        actions={
          <>
            <button className="btn" onClick={() => { load(); loadPipeline() }} disabled={loading}>
              <IconRefresh className="icon" /> Refresh
            </button>
            {tab === 'pending_review' && emailDraftsWaiting > 0 && (
              <button className="btn btn-success" onClick={approveAll} disabled={!!bulk} title="Schedule every email draft; WF-3b sends them gradually within your daily limit">
                {bulk === 'schedule' ? <Spinner /> : <IconCheck className="icon" />} Approve all ({emailDraftsWaiting})
              </button>
            )}
            <button className="btn btn-primary" onClick={generate} disabled={generating || drafting}>
              {generating || drafting ? <Spinner /> : <IconBolt className="icon" />}
              {generating ? 'Starting…' : drafting ? 'Drafting…' : 'Draft new emails'}
            </button>
          </>
        }
      />

      {run.phase === 'running' && (
        <Alert tone="info" title="n8n is writing personalised messages…">
          Groq writes one message per lead (about 3 seconds each). {Math.max(0, counts.pending_review - run.pendingBefore)} new so far — they appear in
          “Needs review” as soon as the run finishes.
        </Alert>
      )}
      {run.phase === 'done' && (
        <Alert
          tone={run.tone}
          title={run.title}
          action={<button className="icon-btn" onClick={() => setRun({ phase: 'idle' })} aria-label="Dismiss"><IconX /></button>}
        >
          {run.text}
        </Alert>
      )}

      <div className="card card-pad pipeline">
        <div className="row-between" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          <div className="section-title" style={{ margin: 0 }}>Pipeline</div>
          {lastRun && (
            <span className="hint">
              Last draft run {timeAgo(lastRun.created_at)} · <StatusBadge status={lastRun.status} plain /> · {lastRun.leads_scored ?? 0} drafted
            </span>
          )}
        </div>
        {pipelineError ? (
          <Alert title="Could not read your leads">{pipelineError}</Alert>
        ) : !pipeline ? (
          <div className="skeleton" style={{ height: 40 }} />
        ) : (
          <>
            <div className="pipeline-stats">
              {pipeline.waiting > 0 && (
                <span className="row" style={{ gap: 6, display: 'inline-flex' }}>
                  <Spinner /> <strong>{pipeline.waiting}</strong> <span className="muted">waiting to be scored by WF-2</span>
                </span>
              )}
              <span><strong>{pipeline.total}</strong> <span className="muted">leads</span></span>
              <span><strong>{pipeline.readyEmail}</strong> <span className="muted">ready to email</span></span>
              <span><strong>{pipeline.readyDm}</strong> <span className="muted">ready for a DM</span></span>
              <span><strong>{pipeline.drafted}</strong> <span className="muted">already drafted</span></span>
              <span><strong>{pipeline.low}</strong> <span className="muted">scored under {MIN_SCORE}</span></span>
              {pipeline.failed > 0 && <span><strong style={{ color: 'var(--red-text)' }}>{pipeline.failed}</strong> <span className="muted">scoring failed</span></span>}
              {pipeline.noContact > 0 && (
                <span>
                  <strong>{pipeline.noContact}</strong> <span className="muted">good leads with no contact</span> · <Link className="link" href="/leads?needs=email">add emails</Link>
                </span>
              )}
            </div>
            {pipeline.failed > 0 && (
              <div className="pipeline-note">
                <Alert
                  tone="warn"
                  title={`${pipeline.failed} ${pipeline.failed === 1 ? 'lead' : 'leads'} could not be scored by the AI`}
                  action={
                    <button className="btn btn-sm" onClick={rescore} disabled={!!bulk}>
                      {bulk === 'rescore' && <Spinner />} Re-score them
                    </button>
                  }
                >
                  {pipeline.failReason && <div className="mono" style={{ fontSize: 12.5, margin: '2px 0 4px' }}>Groq said: {pipeline.failReason}</div>}
                  {/invalid api key|authorization|401/i.test(pipeline.failReason ?? '')
                    ? 'Groq rejected your API key. In n8n → Credentials → “Groq API key”: Name must be Authorization and Value must be “Bearer ” followed by a key from console.groq.com/keys. Save, then click Re-score.'
                    : /decommissioned|model/i.test(pipeline.failReason ?? '')
                      ? 'That model was retired. Import the latest WF-2 and WF-3 (they use openai/gpt-oss-120b), then click Re-score.'
                      : /rate limit|too many|busy/i.test(pipeline.failReason ?? '')
                        ? 'Groq was busy. Wait a minute, then click Re-score (the latest WF-2 also retries automatically).'
                        : 'Fix the problem above in n8n, then click Re-score.'}
                </Alert>
              </div>
            )}
            {readyTotal === 0 && pipeline.failed === 0 && (
              <p className="hint pipeline-note">
                {pipeline.total === 0 && pipeline.waiting > 0
                  ? `WF-2 is working through ${pipeline.waiting} leads (25 per run). Scored leads appear here as they finish — watch Activity in the top bar.`
                  : pipeline.total === 0
                  ? 'No leads yet — run Scrape leads, then Score & enrich on the Workflows page.'
                  : pipeline.good === 0
                    ? `Nothing to draft: none of your leads scored ${MIN_SCORE}+. Run the scraper for fresh leads, or lower min_score in the WF-2 and WF-3 Config nodes.`
                    : 'Nothing new to draft. Follow-ups for emailed leads are drafted automatically once they are due.'}
              </p>
            )}
          </>
        )}
      </div>

      <div className="tabs" role="tablist">
        {TABS.map(t => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={`tab ${tab === t.key ? 'active' : ''}`}
            onClick={() => { setTab(t.key); select(null) }}
          >
            {t.label}
            <span className="tab-count">{counts[t.key]}</span>
          </button>
        ))}
      </div>

      {error && <Alert title="Could not load the queue">{error}</Alert>}
      {tab === 'scheduled' && items.length > 0 && (
        <Alert tone="info">
          WF-3b sends one of these every 10 minutes during your send window, up to your daily limit (set both in the WF-3b Config node).
          Open one to edit it, send it right now, or move it back to review.
        </Alert>
      )}
      {tab === 'approved' && items.length > 0 && (
        <Alert tone="info">
          These were handed to n8n and are waiting for Gmail to finish. If one stays here, check the WF-3b execution log in n8n — you can
          return it to review and approve it again.
        </Alert>
      )}

      <div className="split">
        <div className="card">
          {loading && items.length === 0 ? (
            <div className="list">
              {[0, 1, 2, 3].map(i => (
                <div key={i} className="list-item"><div className="skeleton" style={{ height: 44 }} /></div>
              ))}
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              icon={<IconMail />}
              title={tab === 'pending_review' ? 'Inbox zero' : 'Nothing here'}
              text={tab === 'pending_review' ? 'No drafts are waiting for review. Draft new emails to keep the pipeline moving.' : 'Nothing in this view yet.'}
            />
          ) : (
            <div className="list">
              {items.map(item => (
                <button key={item.id} className={`list-item ${selectedId === item.id ? 'selected' : ''}`} onClick={() => select(item)}>
                  <div className="row-between">
                    <div className="cell-title truncate">{item.lead?.name || 'Unknown lead'}</div>
                    <span className="subtle" style={{ fontSize: 12, flexShrink: 0 }}>{timeAgo(item.sent_at ?? item.approved_at ?? item.created_at)}</span>
                  </div>
                  <div className="row" style={{ marginTop: 2 }}>
                    <span className="cell-sub truncate" style={{ flex: 1 }}>{item.lead?.company || '—'}</span>
                    {kindLabel(item)}
                    <ScoreBadge score={item.lead?.ai_score} />
                  </div>
                  <div style={{ fontWeight: 550, fontSize: 13, marginTop: 8 }} className="truncate">{item.subject}</div>
                  <div className="list-preview">{item.body}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="card sticky">
          {!selected ? (
            <EmptyState icon={<IconMail />} title="Select a draft" text="Pick one on the left to read, edit and approve it." />
          ) : (
            <div className="fade-in">
              <div className="card-head">
                <div style={{ minWidth: 0 }}>
                  <div className="card-title">{isDm(selected) ? 'Direct message' : editable ? 'Review & approve' : 'Email'}</div>
                  <div className="card-desc">
                    {isDm(selected)
                      ? 'No email found — send this yourself on X or LinkedIn.'
                      : (selected.sequence_step ?? 1) > 1
                        ? `Follow-up ${selected.sequence_step} · sent as a reply in the same Gmail thread`
                        : 'First email'}
                  </div>
                </div>
                <div className="row">
                  <StatusBadge status={selected.status} />
                  <button className="icon-btn" onClick={() => select(null)} aria-label="Close"><IconX /></button>
                </div>
              </div>
              <dl className="email-meta">
                <dt>To</dt>
                <dd>
                  {isDm(selected) ? (
                    <span className="row" style={{ gap: 12, flexWrap: 'wrap', display: 'inline-flex' }}>
                      {selected.lead?.x_handle && (
                        <a className="link row" style={{ display: 'inline-flex' }} href={`https://x.com/${encodeURIComponent(selected.lead.x_handle)}`} target="_blank" rel="noopener noreferrer">
                          @{selected.lead.x_handle} on X <IconExternal width={13} height={13} />
                        </a>
                      )}
                      {safeHttpUrl(selected.lead?.linkedin_url) && (
                        <a className="link row" style={{ display: 'inline-flex' }} href={safeHttpUrl(selected.lead?.linkedin_url)!} target="_blank" rel="noopener noreferrer">
                          LinkedIn <IconExternal width={13} height={13} />
                        </a>
                      )}
                    </span>
                  ) : selected.lead?.email ? (
                    <span className="mono">{selected.lead.email}</span>
                  ) : (
                    <span className="overdue">No email address on this lead — add one on the lead page.</span>
                  )}
                </dd>
                <dt>Lead</dt>
                <dd>
                  <Link href={`/leads/${selected.lead_id}`} className="link">{selected.lead?.name || 'View lead'}</Link>
                  {selected.lead?.company ? <span className="subtle"> · {selected.lead.company}</span> : null}
                </dd>
                {selected.status === 'scheduled' && selected.approved_at && (<><dt>Approved</dt><dd>{formatDateTime(selected.approved_at)} · waiting for its send slot</dd></>)}
                {selected.sent_at && (<><dt>Sent</dt><dd>{formatDateTime(selected.sent_at)}</dd></>)}
              </dl>
              <div className="card-pad">
                {!isDm(selected) && (
                  <div className="field">
                    <label className="label" htmlFor="subject">Subject</label>
                    <input id="subject" className="input" value={subject} onChange={e => setSubject(e.target.value)} disabled={!editable || (selected.sequence_step ?? 1) > 1} maxLength={300} />
                  </div>
                )}
                <div className="field" style={{ marginBottom: 0 }}>
                  <label className="label" htmlFor="body">Message</label>
                  <textarea id="body" className="textarea" value={body} onChange={e => setBody(e.target.value)} disabled={!editable} style={{ minHeight: isDm(selected) ? 180 : 300 }} />
                  {editable && <span className="hint">{body.trim().split(/\s+/).filter(Boolean).length} words</span>}
                </div>
              </div>
              {editable && isDm(selected) && (
                <div className="drawer-foot" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                  <button className="btn btn-danger" onClick={() => setStatus('rejected', 'reject', 'Draft rejected.')} disabled={!!busy}>
                    {busy === 'reject' ? <Spinner /> : <IconX className="icon" />} Reject
                  </button>
                  <div className="row">
                    <button className="btn" onClick={copyDm} disabled={!body.trim()}>
                      <IconMessage className="icon" /> Copy message
                    </button>
                    <button className="btn btn-primary" onClick={markDmSent} disabled={!!busy || !body.trim()}>
                      {busy === 'dm' ? <Spinner /> : <IconCheck className="icon" />} I sent it
                    </button>
                  </div>
                </div>
              )}
              {editable && !isDm(selected) && (
                <div className="drawer-foot" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                  {selected.status === 'scheduled' ? (
                    <button className="btn" onClick={() => setStatus('pending_review', 'requeue', 'Moved back to review.')} disabled={!!busy}>
                      {busy === 'requeue' && <Spinner />} Back to review
                    </button>
                  ) : (
                    <button className="btn btn-danger" onClick={() => setStatus('rejected', 'reject', 'Draft rejected.')} disabled={!!busy}>
                      {busy === 'reject' ? <Spinner /> : <IconX className="icon" />} Reject
                    </button>
                  )}
                  <div className="row">
                    <button className="btn" onClick={saveDraft} disabled={!!busy || !dirty}>
                      {busy === 'save' && <Spinner />} Save draft
                    </button>
                    <button
                      className="btn btn-primary"
                      onClick={approve}
                      disabled={!!busy || !subject.trim() || !body.trim() || !selected.lead?.email}
                    >
                      {busy === 'approve' ? <Spinner /> : <IconSend className="icon" />}
                      {busy === 'approve' ? 'Sending…' : selected.status === 'scheduled' ? 'Send now' : 'Approve & send'}
                    </button>
                  </div>
                </div>
              )}
              {(selected.status === 'approved' || selected.status === 'rejected') && (
                <div className="drawer-foot">
                  <button className="btn" onClick={() => setStatus('pending_review', 'requeue', 'Moved back to review.')} disabled={!!busy}>
                    {busy === 'requeue' && <Spinner />} Return to review
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

export default function OutreachPage() {
  return (
    <Suspense fallback={<div className="skeleton" style={{ height: 400, borderRadius: 14 }} />}>
      <OutreachInner />
    </Suspense>
  )
}
