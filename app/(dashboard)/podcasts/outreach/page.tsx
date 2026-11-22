'use client'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/Toast'
import { Alert, Badge, EmptyState, PageHeader, ScoreBadge, Spinner, StatusBadge } from '@/components/ui'
import { IconArrowLeft, IconBolt, IconCheck, IconExternal, IconMail, IconMessage, IconRefresh, IconSend, IconX } from '@/components/icons'
import { formatDateTime, timeAgo } from '@/lib/format'
import { triggerWorkflow } from '@/lib/workflows'
import { DEFAULT_PODCAST_SETTINGS, loadPodcastSettings, startOfDayIso } from '@/lib/podcast'
import { loadSettings } from '@/lib/settings'

type Tab = 'pending_review' | 'scheduled' | 'approved' | 'sent' | 'rejected'
type Item = {
  id: string; podcast_id: string; subject: string; body: string; status: Tab; sequence_step: number | null
  channel: 'email' | 'dm'; created_at: string; approved_at: string | null; sent_at: string | null; error: string | null
  podcast: {
    podcast_name: string | null; host_name: string | null; email: string | null; instagram_url: string | null
    sample_episode_url: string | null; ai_score: number | null; status: string
  } | null
}

const TABS: { key: Tab; label: string }[] = [
  { key: 'pending_review', label: 'Needs review' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'approved', label: 'Sending' },
  { key: 'sent', label: 'Sent' },
  { key: 'rejected', label: 'Rejected' },
]

function safeUrl(v: string | null | undefined) {
  if (!v) return null
  try {
    const u = new URL(v)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null
  } catch {
    return null
  }
}

const nameOf = (i: Item) => i.podcast?.podcast_name || i.podcast?.host_name || i.podcast?.email?.split('@')[0] || 'Podcast'

function kind(i: Item) {
  if (i.channel === 'dm') return <Badge tone="violet" plain>IG DM</Badge>
  if ((i.sequence_step ?? 1) > 1) return <Badge tone="blue" plain>Follow-up {i.sequence_step}</Badge>
  return <Badge tone="accent" plain>Email</Badge>
}

export default function PodcastOutreachPage() {
  const supabase = useMemo(() => createClient(), [])
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('pending_review')
  const [items, setItems] = useState<Item[]>([])
  const [counts, setCounts] = useState<Record<Tab, number>>({ pending_review: 0, scheduled: 0, approved: 0, sent: 0, rejected: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState('')
  const [sentToday, setSentToday] = useState(0)
  const [dailyMax, setDailyMax] = useState(DEFAULT_PODCAST_SETTINGS.daily_max)

  const selected = items.find(i => i.id === selectedId) ?? null
  const dirty = !!selected && (subject !== selected.subject || body !== selected.body)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ settings }, { settings: ps }] = await Promise.all([loadSettings(supabase), loadPodcastSettings(supabase)])
    setDailyMax(ps.daily_max)
    const [list, sent, ...countResults] = await Promise.all([
      supabase
        .from('podcast_outreach')
        .select('*, podcast:podcast_leads(podcast_name, host_name, email, instagram_url, sample_episode_url, ai_score, status)')
        .eq('status', tab)
        .order(tab === 'sent' ? 'sent_at' : 'created_at', { ascending: tab === 'pending_review' || tab === 'scheduled' })
        .limit(200),
      supabase.from('podcast_outreach').select('id', { count: 'exact', head: true }).eq('status', 'sent').eq('channel', 'email').gte('sent_at', startOfDayIso(settings.timezone)),
      ...TABS.map(t => supabase.from('podcast_outreach').select('id', { count: 'exact', head: true }).eq('status', t.key)),
    ])
    if (list.error) setError(list.error.message)
    else {
      setError('')
      setItems((list.data ?? []) as Item[])
    }
    setSentToday(sent.count ?? 0)
    setCounts(Object.fromEntries(TABS.map((t, i) => [t.key, countResults[i].count ?? 0])) as Record<Tab, number>)
    setLoading(false)
  }, [supabase, tab])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data load on tab change, then realtime
    load()
    const channel = supabase
      .channel(`podcast-outreach-${tab}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'podcast_outreach' }, () => load())
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [load, supabase, tab])

  function select(item: Item | null) {
    setSelectedId(item?.id ?? null)
    setSubject(item?.subject ?? '')
    setBody(item?.body ?? '')
  }

  useEffect(() => {
    if (selected || !items.length) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- default selection once data arrives
    select(items[0])
  }, [items, selected])

  function removeAndAdvance(id: string) {
    const idx = items.findIndex(i => i.id === id)
    const rest = items.filter(i => i.id !== id)
    setItems(rest)
    select(rest[idx] ?? rest[idx - 1] ?? null)
  }

  async function post(url: string, payload?: unknown) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload ? JSON.stringify(payload) : undefined })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.ok) throw new Error(data.error ?? `Request failed (HTTP ${res.status}).`)
    return data
  }

  async function send() {
    if (!selected) return
    setBusy('send')
    try {
      await post('/api/podcasts/send', { outreach_id: selected.id, subject, body })
      toast.success(`Sending to ${selected.podcast?.email ?? 'the show'}.`)
      removeAndAdvance(selected.id)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('')
      load()
    }
  }

  async function approveAll() {
    setBusy('all')
    try {
      const data = await post('/api/podcasts/schedule-all')
      if (!data.count) toast.info('No email drafts to schedule (IG DMs are sent by hand).')
      else toast.success(`${data.count} scheduled. WF-P3b sends one every 10 minutes, at most ${dailyMax} a day.`)
      select(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('')
      load()
    }
  }

  async function setStatus(status: Tab, message: string) {
    if (!selected) return
    setBusy(status)
    const fields = status === 'rejected' ? { status, rejected_at: new Date().toISOString() } : { status, approved_at: null }
    const { error } = await supabase.from('podcast_outreach').update(fields).eq('id', selected.id)
    setBusy('')
    if (error) return toast.error(error.message)
    toast.success(message)
    removeAndAdvance(selected.id)
    load()
  }

  async function saveDraft() {
    if (!selected) return
    setBusy('save')
    const { error } = await supabase.from('podcast_outreach').update({ subject, body }).eq('id', selected.id)
    setBusy('')
    if (error) return toast.error(error.message)
    setItems(prev => prev.map(i => (i.id === selected.id ? { ...i, subject, body } : i)))
    toast.success('Draft saved.')
  }

  async function copyDm() {
    try {
      await navigator.clipboard.writeText(body)
      toast.success('Copied. Paste it into the Instagram DM.')
    } catch {
      toast.error('Could not copy automatically — select the text and copy it.')
    }
  }

  async function markDmSent() {
    if (!selected) return
    setBusy('dm')
    const now = new Date().toISOString()
    const { error } = await supabase.from('podcast_outreach').update({ status: 'sent', sent_at: now, body }).eq('id', selected.id)
    if (!error) await supabase.from('podcast_leads').update({ status: 'DM sent', first_contacted_at: now }).eq('id', selected.podcast_id).in('status', ['New', 'Sample made'])
    setBusy('')
    if (error) return toast.error(error.message)
    toast.success('Marked as sent (status: DM sent).')
    removeAndAdvance(selected.id)
    load()
  }

  async function draft() {
    setBusy('draft')
    const res = await triggerWorkflow('WF-P3-PodcastDraft')
    setBusy('')
    if (res.ok) toast.success('WF-P3 is writing drafts. They appear here one by one.')
    else toast.error(res.error ?? 'Could not start WF-P3.')
  }

  const editable = selected?.status === 'pending_review' || selected?.status === 'scheduled'
  const emailDrafts = items.filter(i => i.status === 'pending_review' && i.channel === 'email' && i.podcast?.email).length
  const atLimit = sentToday >= dailyMax
  const igUrl = safeUrl(selected?.podcast?.instagram_url)

  return (
    <>
      <PageHeader
        back={<Link href="/podcasts" className="link" style={{ display: 'inline-flex', gap: 4, alignItems: 'center', marginBottom: 6 }}><IconArrowLeft width={14} height={14} /> Podcasts</Link>}
        title="Podcast outreach"
        description={`Emails go out from your Gmail, at most ${dailyMax} a day (startups have their own limit). Instagram DMs you send yourself.`}
        actions={
          <>
            <button className="btn" onClick={load} disabled={loading}><IconRefresh className="icon" /> Refresh</button>
            {tab === 'pending_review' && emailDrafts > 0 && (
              <button className="btn btn-success" onClick={approveAll} disabled={!!busy}>
                {busy === 'all' ? <Spinner /> : <IconCheck className="icon" />} Approve all ({emailDrafts})
              </button>
            )}
            <button className="btn btn-primary" onClick={draft} disabled={!!busy}>
              {busy === 'draft' ? <Spinner /> : <IconBolt className="icon" />} Draft now
            </button>
          </>
        }
      />

      <Alert tone={atLimit ? 'warn' : 'info'} title={`Podcast emails today: ${sentToday} / ${dailyMax}`}>
        {atLimit
          ? 'Today’s limit is reached. Scheduled emails wait for the next sending day.'
          : 'Approve all schedules the drafts; WF-P3b sends one every 10 minutes inside your send window (Settings).'}
      </Alert>

      <div className="tabs" role="tablist">
        {TABS.map(t => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => { setTab(t.key); select(null) }}>
            {t.label}<span className="tab-count">{counts[t.key]}</span>
          </button>
        ))}
      </div>

      {error && <Alert title="Could not load the queue">{error}{/podcast_outreach/.test(error) && ' Run supabase/migrations/007_podcasts.sql first.'}</Alert>}

      {!loading && items.length === 0 ? (
        <div className="card review-empty">
          <EmptyState icon={<IconMail />} title={tab === 'pending_review' ? 'Nothing waiting for review' : 'Nothing here yet'}
            text={tab === 'pending_review' ? 'Qualified podcasts with an email or Instagram get a draft here. Click Draft now, or wait for the next run (every 3 hours).' : undefined} />
        </div>
      ) : (
        <div className="review">
          <div className="queue" role="listbox">
            {items.map(item => (
              <button key={item.id} role="option" aria-selected={selectedId === item.id} className={`qcard ${selectedId === item.id ? 'selected' : ''}`} onClick={() => select(item)}>
                <span className="qcard-avatar" style={{ background: '#8b5cf6' }} aria-hidden>{nameOf(item).slice(0, 1).toUpperCase()}</span>
                <span className="qcard-main">
                  <span className="qcard-top">
                    <span className="qcard-name truncate">{nameOf(item)}</span>
                    <span className="qcard-time">{timeAgo(item.sent_at ?? item.approved_at ?? item.created_at)}</span>
                  </span>
                  <span className="qcard-subject truncate">{item.channel === 'dm' ? 'Instagram DM' : item.subject}</span>
                  <span className="qcard-tags">{kind(item)}<ScoreBadge score={item.podcast?.ai_score} /></span>
                </span>
              </button>
            ))}
          </div>

          <section className="card reader" aria-label="Selected message">
            {!selected ? (
              <EmptyState icon={<IconMail />} title="Pick a message" />
            ) : (
              <>
                <header className="reader-head">
                  <span className="qcard-avatar lg" style={{ background: '#8b5cf6' }} aria-hidden>{nameOf(selected).slice(0, 1).toUpperCase()}</span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="reader-name truncate">{nameOf(selected)}{selected.podcast?.host_name && <span className="subtle" style={{ fontWeight: 500 }}> · {selected.podcast.host_name}</span>}</div>
                    <div className="reader-sub">
                      {selected.channel === 'dm'
                        ? igUrl ? <a className="link" href={igUrl} target="_blank" rel="noopener noreferrer">Open their Instagram <IconExternal width={12} height={12} /></a> : 'No Instagram link'
                        : <span className="mono">{selected.podcast?.email ?? 'No email'}</span>}
                    </div>
                  </div>
                </header>
                <div className="reader-meta">
                  <StatusBadge status={selected.status} />
                  {kind(selected)}
                  {selected.podcast?.status && <span className="subtle">Show status: {selected.podcast.status}</span>}
                  {safeUrl(selected.podcast?.sample_episode_url) && <a className="link" href={safeUrl(selected.podcast?.sample_episode_url)!} target="_blank" rel="noopener noreferrer">Sample episode <IconExternal width={12} height={12} /></a>}
                  {selected.sent_at && <span className="subtle">Sent {formatDateTime(selected.sent_at)}</span>}
                </div>
                {selected.error && selected.status !== 'sent' && <Alert tone="warn">{selected.error}</Alert>}
                <div className="reader-body">
                  {selected.channel === 'email' && (
                    <input aria-label="Subject" className="reader-subject" value={subject} onChange={e => setSubject(e.target.value)} disabled={!editable || (selected.sequence_step ?? 1) > 1} maxLength={300} />
                  )}
                  <textarea aria-label="Message" className="reader-text" value={body} onChange={e => setBody(e.target.value)} disabled={!editable} />
                </div>
                {editable && selected.channel === 'dm' && (
                  <footer className="reader-foot">
                    <button className="btn btn-danger" onClick={() => setStatus('rejected', 'Draft rejected.')} disabled={!!busy}><IconX className="icon" /> Reject</button>
                    <div className="row">
                      <button className="btn" onClick={copyDm}><IconMessage className="icon" /> Copy</button>
                      <button className="btn btn-primary" onClick={markDmSent} disabled={!!busy}>{busy === 'dm' ? <Spinner /> : <IconCheck className="icon" />} I sent it</button>
                    </div>
                  </footer>
                )}
                {editable && selected.channel === 'email' && (
                  <footer className="reader-foot">
                    {selected.status === 'scheduled'
                      ? <button className="btn" onClick={() => setStatus('pending_review', 'Moved back to review.')} disabled={!!busy}>Back to review</button>
                      : <button className="btn btn-danger" onClick={() => setStatus('rejected', 'Draft rejected.')} disabled={!!busy}><IconX className="icon" /> Reject</button>}
                    <div className="row">
                      {dirty && <button className="btn" onClick={saveDraft} disabled={!!busy}>{busy === 'save' && <Spinner />} Save edits</button>}
                      <button className="btn btn-primary" onClick={send} disabled={!!busy || atLimit || !subject.trim() || !body.trim() || !selected.podcast?.email}
                        title={atLimit ? 'Today’s podcast limit is reached' : undefined}>
                        {busy === 'send' ? <Spinner /> : <IconSend className="icon" />} {selected.status === 'scheduled' ? 'Send now' : 'Approve & send'}
                      </button>
                    </div>
                  </footer>
                )}
                {(selected.status === 'approved' || selected.status === 'rejected') && (
                  <footer className="reader-foot">
                    <span />
                    <button className="btn" onClick={() => setStatus('pending_review', 'Moved back to review.')} disabled={!!busy}>Return to review</button>
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
