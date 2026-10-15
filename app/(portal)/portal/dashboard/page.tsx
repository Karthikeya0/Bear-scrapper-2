'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/Toast'
import { Alert, EmptyState, Spinner, StatusBadge } from '@/components/ui'
import { IconExternal, IconFile, IconKanban, IconMessage, IconSend } from '@/components/icons'
import { formatDate, formatDateTime, formatDay } from '@/lib/format'

type Client = { id: string; company: string; contact_name: string | null }
type Project = { id: string; title: string; description: string | null; status: string; deadline: string | null }
type Deliverable = { id: string; title: string; file_url: string; status: string; notes: string | null; created_at: string }
type Message = { id: string; direction: string; body: string; created_at: string }

const STAGES = ['todo', 'in_progress', 'review', 'delivered']
const STAGE_LABEL: Record<string, string> = { todo: 'Planned', in_progress: 'In production', review: 'Ready for your review', delivered: 'Delivered' }

function safeUrl(value: string) {
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null
  } catch {
    return null
  }
}

export default function ClientPortalPage() {
  const supabase = useMemo(() => createClient(), [])
  const toast = useToast()
  const [client, setClient] = useState<Client | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [deliverables, setDeliverables] = useState<Deliverable[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [reviewing, setReviewing] = useState('')

  const load = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    const { data: c, error: cErr } = await supabase.from('clients').select('id, company, contact_name').eq('portal_user_id', user.id).maybeSingle()
    if (cErr) setError(cErr.message)
    if (c) {
      setClient(c as Client)
      const [p, d, m] = await Promise.all([
        supabase.from('projects').select('id, title, description, status, deadline').eq('client_id', c.id).order('created_at', { ascending: false }),
        supabase.from('deliverables').select('id, title, file_url, status, notes, created_at').eq('client_id', c.id).order('created_at', { ascending: false }),
        supabase.from('communications').select('id, direction, body, created_at').eq('client_id', c.id).neq('direction', 'internal').order('created_at', { ascending: false }).limit(20),
      ])
      setProjects((p.data ?? []) as Project[])
      setDeliverables((d.data ?? []) as Deliverable[])
      setMessages(((m.data ?? []) as Message[]).reverse())
    }
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load
    load()
  }, [load])

  async function send(e: React.FormEvent) {
    e.preventDefault()
    if (!client || !message.trim()) return
    setSending(true)
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const { error } = await supabase.from('communications').insert({
      client_id: client.id,
      author_id: user?.id,
      direction: 'inbound',
      channel: 'portal',
      body: message.trim(),
    })
    setSending(false)
    if (error) return toast.error(`Message not sent: ${error.message}`)
    setMessage('')
    toast.success('Message sent to the Bear Studios team.')
    load()
  }

  async function review(d: Deliverable, status: 'approved' | 'revision_requested') {
    setReviewing(d.id)
    const { error } = await supabase.from('deliverables').update({ status, updated_at: new Date().toISOString() }).eq('id', d.id)
    setReviewing('')
    if (error) return toast.error(error.message)
    toast.success(status === 'approved' ? 'Approved — thank you!' : 'Revision requested. Add details in a message below.')
    setDeliverables(prev => prev.map(x => (x.id === d.id ? { ...x, status } : x)))
  }

  if (loading) {
    return (
      <div className="stack">
        <div className="skeleton" style={{ height: 140, borderRadius: 14 }} />
        <div className="skeleton" style={{ height: 220, borderRadius: 14 }} />
      </div>
    )
  }

  if (!client) {
    return (
      <div className="card">
        {error && <div className="card-pad"><Alert>{error}</Alert></div>}
        <EmptyState icon={<IconKanban />} title="Your account isn't linked yet" text="Please contact Bear Studios so we can connect your login to your company profile." />
      </div>
    )
  }

  const pendingReview = deliverables.filter(d => d.status === 'review').length

  return (
    <div className="stack fade-in">
      <section className="portal-hero">
        <h1>Welcome back{client.contact_name ? `, ${client.contact_name.split(' ')[0]}` : ''}</h1>
        <p>
          {client.company} · {projects.filter(p => p.status !== 'delivered').length} active project(s)
          {pendingReview ? ` · ${pendingReview} file(s) awaiting your review` : ''}
        </p>
      </section>

      <div className="card">
        <div className="card-head"><div className="card-title">Projects</div></div>
        {projects.length === 0 ? (
          <EmptyState icon={<IconKanban />} title="No projects yet" text="Your projects will appear here once kicked off." />
        ) : (
          projects.map(p => {
            const step = Math.max(0, STAGES.indexOf(p.status))
            return (
              <div key={p.id} className="integration" style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 10 }}>
                <div className="row-between" style={{ width: '100%' }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="cell-title">{p.title}</div>
                    {p.description && <div className="cell-sub">{p.description}</div>}
                  </div>
                  <StatusBadge status={p.status} />
                </div>
                <div style={{ width: '100%' }}>
                  <div className="progress"><span style={{ width: `${((step + 1) / STAGES.length) * 100}%` }} /></div>
                  <div className="row-between hint" style={{ marginTop: 6 }}>
                    <span>{STAGE_LABEL[p.status] ?? p.status}</span>
                    <span>{p.deadline ? `Target ${formatDay(p.deadline)}` : ''}</span>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">Deliverables</div>
            <div className="card-desc">Review files and approve or request changes.</div>
          </div>
        </div>
        {deliverables.length === 0 ? (
          <EmptyState icon={<IconFile />} title="No files yet" text="We'll share files here as soon as they're ready for review." />
        ) : (
          deliverables.map(d => {
            const url = safeUrl(d.file_url)
            return (
              <div key={d.id} className="integration" style={{ flexWrap: 'wrap' }}>
                <div className="integration-icon"><IconFile /></div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div className="cell-title">{d.title}</div>
                  <div className="cell-sub">Shared {formatDate(d.created_at)}{d.notes ? ` · ${d.notes}` : ''}</div>
                </div>
                <StatusBadge status={d.status} />
                <div className="row">
                  {url && <a className="btn btn-sm" href={url} target="_blank" rel="noopener noreferrer">Open <IconExternal className="icon" /></a>}
                  {d.status === 'review' && (
                    <>
                      <button className="btn btn-sm" disabled={!!reviewing} onClick={() => review(d, 'revision_requested')}>Request changes</button>
                      <button className="btn btn-sm btn-success" disabled={!!reviewing} onClick={() => review(d, 'approved')}>
                        {reviewing === d.id && <Spinner />} Approve
                      </button>
                    </>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      <div className="card">
        <div className="card-head"><div className="card-title">Messages</div></div>
        <div className="card-pad">
          {messages.length === 0 ? (
            <EmptyState icon={<IconMessage />} title="No messages yet" text="Ask a question, request a revision or share feedback." />
          ) : (
            <div className="stack" style={{ gap: 10, marginBottom: 16 }}>
              {messages.map(m => (
                <div key={m.id} className={`msg ${m.direction === 'inbound' ? 'in' : 'out'}`}>
                  <div className="prose" style={{ color: 'var(--text)' }}>{m.body}</div>
                  <div className="msg-time">{m.direction === 'inbound' ? 'You' : 'Bear Studios'} · {formatDateTime(m.created_at)}</div>
                </div>
              ))}
            </div>
          )}
          <form onSubmit={send}>
            <textarea className="textarea" rows={3} value={message} onChange={e => setMessage(e.target.value)} placeholder="Write a message to the team…" required aria-label="Message" />
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}>
              <button type="submit" className="btn btn-primary" disabled={sending || !message.trim()}>
                {sending ? <Spinner /> : <IconSend className="icon" />} Send message
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
