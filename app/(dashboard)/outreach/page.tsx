'use client'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/Toast'
import { Alert, Badge, EmptyState, PageHeader, ScoreBadge, Spinner, StatusBadge } from '@/components/ui'
import { IconBolt, IconCheck, IconChevronLeft, IconChevronRight, IconExternal, IconMail, IconMessage, IconRefresh, IconSend, IconX } from '@/components/icons'
import { formatDateTime, timeAgo } from '@/lib/format'
import { scoringFailed } from '@/lib/outreach'
import { DEFAULT_SETTINGS, loadSettings } from '@/lib/settings'
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
const RUN_TIMEOUT_MS = 15 * 60 * 1000

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

/** Best human label for a draft's lead: name, else company, else the email's local part. */
function leadName(item: QueueItem) {
  return item.lead?.name || item.lead?.company || item.lead?.email?.split('@')[0] || 'Unknown lead'
}

const AVATAR_COLORS = ['#6366f1', '#0ea5e9', '#14b8a6', '#f59e0b', '#ec4899', '#8b5cf6', '#22c55e', '#ef4444']
function avatarColor(name: string) {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
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
  const [minScore, setMinScore] = useState(DEFAULT_SETTINGS.min_score)

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
    const { settings } = await loadSettings(supabase)
    const MIN_SCORE = settings.min_score
    setMinScore(MIN_SCORE)
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
        // Drafts arrived but the final "Write run log" step did not: the drafting itself worked.
        const { count } = await supabase.from('outreach_queue').select('id', { count: 'exact', head: true }).eq('status', 'pending_review')
        const added = (count ?? 0) - run.pendingBefore
        if (added > 0) {
          setRun({ phase: 'done', tone: 'warn', title: `${added} new ${added === 1 ? 'draft' : 'drafts'} ready for review`, text: 'WF-3 wrote the drafts but its last step (Write run log) did not finish. Open that node in n8n and check it uses the Supabase account credential.' })
          load()
          loadPipeline()
          return
        }
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
    // On phones the editor sits below the list: bring it into view.
    if (item && window.matchMedia('(max-width: 1000px)').matches) {
      requestAnimationFrame(() => document.getElementById('draft-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    }
  }

  const position = selected ? items.findIndex(i => i.id === selected.id) : -1

  const step = useCallback(
    (delta: number) => {
      if (!items.length) return
      const next = items[Math.min(items.length - 1, Math.max(0, (position < 0 ? 0 : position + delta)))]
      if (!next) return
      setSelectedId(next.id)
      setSubject(next.subject)
      setBody(next.body)
      document.querySelector(`[data-id="${next.id}"]`)?.scrollIntoView({ block: 'nearest' })
    },
    [items, position],
  )

  // Open the first draft automatically on wide screens, so the editor is never an empty box.
  useEffect(() => {
    // (checks `selected`, not the id: after a tab switch the old id is not in the new list)
    if (selected || !items.length || !window.matchMedia('(min-width: 1001px)').matches) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- pick a default selection once data arrives
    setSelectedId(items[0].id)
    setSubject(items[0].subject)
    setBody(items[0].body)
  }, [items, selected])

  // J / K (or ↓ / ↑) move between drafts when you are not typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.metaKey || e.ctrlKey || e.altKey || t.closest('input, textarea, select, [contenteditable="true"]')) return
      if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); step(1) }
      if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); step(-1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step])

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
          Groq writes one message at a time and each one appears below as soon as it is ready —{' '}
          <strong>{Math.max(0, counts.pending_review - run.pendingBefore)}</strong> so far. Usually a few seconds each; longer when Groq is busy.
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
                  <Spinner /> <strong>{pipeline.waiting}</strong> <span className="muted">new leads queued for scoring (WF-2 does a batch each run)</span>
                </span>
              )}
              <span><strong>{pipeline.total}</strong> <span className="muted">leads</span></span>
              <span><strong>{pipeline.readyEmail}</strong> <span className="muted">ready to email</span></span>
              <span><strong>{pipeline.readyDm}</strong> <span className="muted">ready for a DM</span></span>
              <span><strong>{pipeline.drafted}</strong> <span className="muted">already drafted</span></span>
              <span><strong>{pipeline.low}</strong> <span className="muted">scored under {minScore}</span></span>
              {pipeline.failed > 0 && <span><strong style={{ color: 'var(--red-text)' }}>{pipeline.failed}</strong> <span className="muted">scoring failed</span></span>}
              {pipeline.noContact > 0 && (
                <span>
                  <strong>{pipeline.noContact}</strong> <span className="muted">skipped — no email, X or LinkedIn found</span> · <Link className="link" href="/leads?needs=email">add one (optional)</Link>
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
                      : /timeout|timed out/i.test(pipeline.failReason ?? '')
                        ? 'Groq took too long to answer (it was busy). Import the latest WF-2 (it now waits up to 60 seconds), then click Re-score.'
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
                    ? `Nothing to draft: none of your leads scored ${minScore}+. Run the scraper for fresh leads, or lower the minimum score in Settings.`
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
          WF-3b sends one of these every 10 minutes during your send window, up to your daily limit (both set in Settings).
          Open one to edit it, send it right now, or move it back to review.
        </Alert>
      )}
      {tab === 'approved' && items.length > 0 && (
        <Alert tone="info">
          These were handed to n8n and are waiting for Gmail to finish. If one stays here, check the WF-3b execution log in n8n — you can
          return it to review and approve it again.
        </Alert>
      )}

      {!loading && items.length === 0 ? (
        <div className="card review-empty">
          <EmptyState
            icon={<IconMail />}
            title={tab === 'pending_review' ? 'Nothing waiting for review' : `No ${TABS.find(t => t.key === tab)?.label.toLowerCase()} messages`}
            text={
              tab === 'pending_review'
                ? readyTotal > 0
                  ? `${readyTotal} ${readyTotal === 1 ? 'lead is' : 'leads are'} ready. Draft emails and they will show up here, one card per lead.`
                  : 'New drafts show up here, one card per lead. Follow-ups are drafted automatically when they are due.'
                : 'Messages move here as you approve, send or reject them.'
            }
            action={
              tab === 'pending_review' && readyTotal > 0 ? (
                <button className="btn btn-primary" onClick={generate} disabled={generating || drafting}>
                  {generating || drafting ? <Spinner /> : <IconBolt className="icon" />} {drafting ? 'Drafting…' : 'Draft new emails'}
                </button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="review">
          <div className="queue" role="listbox" aria-label={TABS.find(t => t.key === tab)?.label}>
            {loading && items.length === 0
              ? [0, 1, 2].map(i => <div key={i} className="qcard"><div className="skeleton" style={{ height: 64 }} /></div>)
              : items.map(item => (
                  <button
                    key={item.id}
                    role="option"
                    aria-selected={selectedId === item.id}
                    data-id={item.id}
                    className={`qcard ${selectedId === item.id ? 'selected' : ''}`}
                    onClick={() => select(item)}
                  >
                    <span className="qcard-avatar" style={{ background: avatarColor(leadName(item)) }} aria-hidden>{leadName(item).slice(0, 1).toUpperCase()}</span>
                    <span className="qcard-main">
                      <span className="qcard-top">
                        <span className="qcard-name truncate">{leadName(item)}</span>
                        <span className="qcard-time">{timeAgo(item.sent_at ?? item.approved_at ?? item.created_at)}</span>
                      </span>
                      <span className="qcard-subject truncate">{isDm(item) ? 'Direct message on X / LinkedIn' : item.subject}</span>
                      <span className="qcard-tags">
                        {kindLabel(item)}
                        <ScoreBadge score={item.lead?.ai_score} />
                        {item.lead?.company && item.lead?.company !== leadName(item) && <span className="qcard-company truncate">{item.lead.company}</span>}
                      </span>
                    </span>
                  </button>
                ))}
          </div>

          <section className="card reader" id="draft-editor" aria-label="Selected message">
            {!selected ? (
              <EmptyState icon={<IconMail />} title="Pick a message" text="Choose a card on the left to read, edit and approve it." />
            ) : (
              <>
                <header className="reader-head">
                  <span className="qcard-avatar lg" style={{ background: avatarColor(leadName(selected)) }} aria-hidden>{leadName(selected).slice(0, 1).toUpperCase()}</span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="reader-name truncate">
                      {leadName(selected)}
                      {selected.lead?.company && selected.lead.company !== leadName(selected) && <span className="subtle" style={{ fontWeight: 500 }}> · {selected.lead.company}</span>}
                    </div>
                    <div className="reader-sub">
                      {isDm(selected) ? (
                        <span className="row" style={{ gap: 10, flexWrap: 'wrap', display: 'inline-flex' }}>
                          <span>DM — send it yourself:</span>
                          {selected.lead?.x_handle && (
                            <a className="link" href={`https://x.com/${encodeURIComponent(selected.lead.x_handle)}`} target="_blank" rel="noopener noreferrer">
                              @{selected.lead.x_handle} on X <IconExternal width={12} height={12} />
                            </a>
                          )}
                          {safeHttpUrl(selected.lead?.linkedin_url) && (
                            <a className="link" href={safeHttpUrl(selected.lead?.linkedin_url)!} target="_blank" rel="noopener noreferrer">
                              LinkedIn <IconExternal width={12} height={12} />
                            </a>
                          )}
                        </span>
                      ) : selected.lead?.email ? (
                        <span className="mono">{selected.lead.email}</span>
                      ) : (
                        <span className="overdue">No email address — add one on the lead page.</span>
                      )}
                    </div>
                  </div>
                  <div className="pager" role="group" aria-label="Move between messages">
                    <button className="icon-btn" onClick={() => step(-1)} disabled={position <= 0} aria-label="Previous" title="Previous (K)"><IconChevronLeft /></button>
                    <span className="pager-count">{position + 1} / {items.length}</span>
                    <button className="icon-btn" onClick={() => step(1)} disabled={position >= items.length - 1} aria-label="Next" title="Next (J)"><IconChevronRight /></button>
                  </div>
                </header>

                <div className="reader-meta">
                  <StatusBadge status={selected.status} />
                  {kindLabel(selected)}
                  {(selected.sequence_step ?? 1) > 1 && !isDm(selected) && <span className="subtle">Goes out as a reply in the same Gmail thread</span>}
                  {(selected.sequence_step ?? 1) === 1 && !isDm(selected) && editable && <span className="subtle">One-pager PDF attached automatically</span>}
                  {selected.status === 'scheduled' && selected.approved_at && <span className="subtle">Approved {formatDateTime(selected.approved_at)} · waiting for its send slot</span>}
                  {selected.sent_at && <span className="subtle">Sent {formatDateTime(selected.sent_at)}</span>}
                  <Link href={`/leads/${selected.lead_id}`} className="link reader-profile">Lead profile{selected.lead?.ai_score != null && ` · score ${selected.lead.ai_score}`}</Link>
                </div>

                <div className="reader-body">
                  {!isDm(selected) && (
                    <input
                      aria-label="Subject"
                      className="reader-subject"
                      value={subject}
                      onChange={e => setSubject(e.target.value)}
                      disabled={!editable || (selected.sequence_step ?? 1) > 1}
                      maxLength={300}
                      placeholder="Subject"
                    />
                  )}
                  <textarea aria-label="Message" className="reader-text" value={body} onChange={e => setBody(e.target.value)} disabled={!editable} />
                  {editable && <div className="hint reader-hint">{body.trim().split(/\s+/).filter(Boolean).length} words · click the text to edit<span className="kbd-hint"> · J / K for next / previous</span></div>}
                </div>

                {editable && isDm(selected) && (
                  <footer className="reader-foot">
                    <button className="btn btn-danger" onClick={() => setStatus('rejected', 'reject', 'Draft rejected.')} disabled={!!busy}>
                      {busy === 'reject' ? <Spinner /> : <IconX className="icon" />} Reject
                    </button>
                    <div className="row">
                      <button className="btn" onClick={copyDm} disabled={!body.trim()}><IconMessage className="icon" /> Copy</button>
                      <button className="btn btn-primary" onClick={markDmSent} disabled={!!busy || !body.trim()}>
                        {busy === 'dm' ? <Spinner /> : <IconCheck className="icon" />} I sent it
                      </button>
                    </div>
                  </footer>
                )}
                {editable && !isDm(selected) && (
                  <footer className="reader-foot">
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
                      {dirty && (
                        <button className="btn" onClick={saveDraft} disabled={!!busy}>
                          {busy === 'save' && <Spinner />} Save edits
                        </button>
                      )}
                      <button className="btn btn-primary" onClick={approve} disabled={!!busy || !subject.trim() || !body.trim() || !selected.lead?.email}>
                        {busy === 'approve' ? <Spinner /> : <IconSend className="icon" />}
                        {busy === 'approve' ? 'Sending…' : selected.status === 'scheduled' ? 'Send now' : 'Approve & send'}
                      </button>
                    </div>
                  </footer>
                )}
                {(selected.status === 'approved' || selected.status === 'rejected') && (
                  <footer className="reader-foot">
                    <span />
                    <button className="btn" onClick={() => setStatus('pending_review', 'requeue', 'Moved back to review.')} disabled={!!busy}>
                      {busy === 'requeue' && <Spinner />} Return to review
                    </button>
                  </footer>
                )}
              </>
            )}
          </section>
        </div>
      )}
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
