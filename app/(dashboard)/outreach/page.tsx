'use client'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/Toast'
import { Alert, EmptyState, PageHeader, ScoreBadge, Spinner, StatusBadge } from '@/components/ui'
import { IconBolt, IconMail, IconRefresh, IconSend, IconX } from '@/components/icons'
import { formatDateTime, timeAgo } from '@/lib/format'
import { triggerWorkflow } from '@/lib/workflows'

type Tab = 'pending_review' | 'approved' | 'sent' | 'rejected'
type QueueItem = {
  id: string; lead_id: string; subject: string; body: string; status: Tab; sequence_step: number | null
  created_at: string; approved_at: string | null; sent_at: string | null
  lead: { name: string | null; company: string | null; email: string | null; ai_score: number | null } | null
}

const TABS: { key: Tab; label: string }[] = [
  { key: 'pending_review', label: 'Needs review' },
  { key: 'approved', label: 'Sending' },
  { key: 'sent', label: 'Sent' },
  { key: 'rejected', label: 'Rejected' },
]

function OutreachInner() {
  const params = useSearchParams()
  const initialTab = (TABS.find(t => t.key === params.get('tab'))?.key ?? 'pending_review') as Tab
  const supabase = useMemo(() => createClient(), [])
  const toast = useToast()

  const [tab, setTab] = useState<Tab>(initialTab)
  const [items, setItems] = useState<QueueItem[]>([])
  const [counts, setCounts] = useState<Record<Tab, number>>({ pending_review: 0, approved: 0, sent: 0, rejected: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState<'' | 'approve' | 'reject' | 'save' | 'requeue'>('')
  const [generating, setGenerating] = useState(false)

  const selected = items.find(i => i.id === selectedId) ?? null
  const dirty = !!selected && (subject !== selected.subject || body !== selected.body)

  const load = useCallback(async () => {
    setLoading(true)
    const [list, ...countResults] = await Promise.all([
      supabase
        .from('outreach_queue')
        .select('*, lead:leads(name, company, email, ai_score)')
        .eq('status', tab)
        .order('created_at', { ascending: tab === 'pending_review' })
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

  function nextAfter(id: string) {
    const idx = items.findIndex(i => i.id === id)
    return items.filter(i => i.id !== id)[idx] ?? null
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
      toast.success(`Approved — n8n is sending the email to ${selected.lead?.email ?? 'the lead'}.`)
      const next = nextAfter(selected.id)
      setItems(prev => prev.filter(i => i.id !== selected.id))
      select(next)
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
    const next = nextAfter(selected.id)
    setItems(prev => prev.filter(i => i.id !== selected.id))
    select(next)
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

  async function generate() {
    setGenerating(true)
    const res = await triggerWorkflow('WF-3-Outreach')
    setGenerating(false)
    if (res.ok) toast.success('Outreach generator started. New drafts will appear here automatically.')
    else toast.error(res.error ?? 'Could not start the outreach generator.')
  }

  const editable = selected?.status === 'pending_review'

  return (
    <>
      <PageHeader
        title="Outreach queue"
        description="Review AI-drafted emails before n8n sends them from your Gmail."
        actions={
          <>
            <button className="btn" onClick={load} disabled={loading}>
              <IconRefresh className="icon" /> Refresh
            </button>
            <button className="btn btn-primary" onClick={generate} disabled={generating}>
              {generating ? <Spinner /> : <IconBolt className="icon" />}
              {generating ? 'Starting…' : 'Draft new emails'}
            </button>
          </>
        }
      />

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
      {tab === 'approved' && items.length > 0 && (
        <Alert tone="info">
          These emails were handed to n8n and are waiting for the Gmail send to finish. If one stays here, check the WF-3b
          execution log in n8n — you can return it to review and approve it again.
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
              text={tab === 'pending_review' ? 'No drafts are waiting for review. Draft new emails to keep the pipeline moving.' : 'No emails in this view yet.'}
            />
          ) : (
            <div className="list">
              {items.map(item => (
                <button key={item.id} className={`list-item ${selectedId === item.id ? 'selected' : ''}`} onClick={() => select(item)}>
                  <div className="row-between">
                    <div className="cell-title truncate">{item.lead?.name || 'Unknown lead'}</div>
                    <span className="subtle" style={{ fontSize: 12, flexShrink: 0 }}>{timeAgo(item.sent_at ?? item.created_at)}</span>
                  </div>
                  <div className="row" style={{ marginTop: 2 }}>
                    <span className="cell-sub truncate" style={{ flex: 1 }}>{item.lead?.company || '—'}</span>
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
            <EmptyState icon={<IconMail />} title="Select an email" text="Pick a draft on the left to read, edit and approve it." />
          ) : (
            <div className="fade-in">
              <div className="card-head">
                <div style={{ minWidth: 0 }}>
                  <div className="card-title">{editable ? 'Review & approve' : 'Email'}</div>
                  <div className="card-desc">
                    {selected.sequence_step && selected.sequence_step > 1 ? `Follow-up · step ${selected.sequence_step}` : 'First touch'}
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
                  {selected.lead?.email ? (
                    <span className="mono">{selected.lead.email}</span>
                  ) : (
                    <span className="overdue">No email address on this lead — n8n cannot send it.</span>
                  )}
                </dd>
                <dt>Lead</dt>
                <dd>
                  <Link href={`/leads/${selected.lead_id}`} className="link">{selected.lead?.name || 'View lead'}</Link>
                  {selected.lead?.company ? <span className="subtle"> · {selected.lead.company}</span> : null}
                </dd>
                {selected.sent_at && (<><dt>Sent</dt><dd>{formatDateTime(selected.sent_at)}</dd></>)}
              </dl>
              <div className="card-pad">
                <div className="field">
                  <label className="label" htmlFor="subject">Subject</label>
                  <input id="subject" className="input" value={subject} onChange={e => setSubject(e.target.value)} disabled={!editable} maxLength={300} />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label className="label" htmlFor="body">Message</label>
                  <textarea id="body" className="textarea" value={body} onChange={e => setBody(e.target.value)} disabled={!editable} style={{ minHeight: 300 }} />
                  {editable && <span className="hint">{body.trim().split(/\s+/).filter(Boolean).length} words</span>}
                </div>
              </div>
              {editable && (
                <div className="drawer-foot" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                  <button className="btn btn-danger" onClick={() => setStatus('rejected', 'reject', 'Draft rejected.')} disabled={!!busy}>
                    {busy === 'reject' ? <Spinner /> : <IconX className="icon" />} Reject
                  </button>
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
                      {busy === 'approve' ? 'Sending…' : 'Approve & send'}
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
