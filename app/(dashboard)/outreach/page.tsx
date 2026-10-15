'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'

type QueueItem = {
  id: string
  lead_id: string
  subject: string
  body: string
  status: string
  sequence_step: number
  created_at: string
  lead?: { name: string; company: string; email: string; ai_score: number }
}

export default function OutreachPage() {
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<QueueItem | null>(null)
  const [editSubject, setEditSubject] = useState('')
  const [editBody, setEditBody] = useState('')
  const [actioning, setActioning] = useState(false)
  const [tab, setTab] = useState<'pending_review' | 'approved' | 'sent'>('pending_review')

  const supabase = useMemo(() => createClient(), [])

  const fetchQueue = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('outreach_queue')
      .select('*, lead:leads(name,company,email,ai_score)')
      .eq('status', tab)
      .order('created_at', { ascending: false })
    setQueue((data as QueueItem[]) || [])
    setLoading(false)
  }, [tab, supabase])

  useEffect(() => { fetchQueue() }, [fetchQueue])

  function openEditor(item: QueueItem) {
    setSelected(item)
    setEditSubject(item.subject)
    setEditBody(item.body)
  }

  async function handleApprove() {
    if (!selected) return
    setActioning(true)

    // Save any edits
    await supabase.from('outreach_queue').update({
      subject: editSubject,
      body: editBody,
      status: 'approved',
      approved_at: new Date().toISOString()
    }).eq('id', selected.id)

    // Trigger n8n webhook to send the email
    await fetch('/api/approve-outreach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outreach_id: selected.id, lead_id: selected.lead_id })
    })

    setActioning(false)
    setSelected(null)
    fetchQueue()
  }

  async function handleReject() {
    if (!selected) return
    setActioning(true)
    await supabase.from('outreach_queue').update({
      status: 'rejected',
      rejected_at: new Date().toISOString()
    }).eq('id', selected.id)
    setActioning(false)
    setSelected(null)
    fetchQueue()
  }

  const TABS = [
    { key: 'pending_review' as const, label: 'PENDING REVIEW' },
    { key: 'approved' as const, label: 'APPROVED' },
    { key: 'sent' as const, label: 'SENT' },
  ]

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      {/* 1. Header (Dark) */}
      <section className="section-dark">
        <div className="fade-in">
          <span className="micro-label">OUTREACH</span>
          <h1 style={{ fontSize: 'clamp(3rem, 6vw, 6rem)', margin: 0 }}>QUEUE</h1>
        </div>
      </section>

      {/* 2. Main Area (White) */}
      <section className="section-white border-line" style={{ flex: 1, borderTopWidth: '1px', borderTopStyle: 'solid', paddingTop: '0' }}>
        
        {/* Tabs */}
        <div style={{ display: 'flex', gap: '2rem', borderBottom: '1px solid var(--border-dark)', marginBottom: '3rem' }}>
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => { setTab(t.key); setSelected(null) }}
              style={{
                padding: '1.5rem 0',
                fontFamily: 'var(--font-sans)',
                fontSize: '0.75rem',
                fontWeight: 600,
                letterSpacing: '0.1em',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: tab === t.key ? 'var(--text-on-light)' : 'var(--text-muted-on-light)',
                borderBottom: tab === t.key ? '2px solid var(--text-on-light)' : '2px solid transparent',
                transition: 'all 0.2s',
                textTransform: 'uppercase'
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="fade-in" style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 1fr' : '1fr', gap: '4rem', padding: '0 2rem' }}>
          
          {/* Queue List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {loading ? (
              <div className="skeleton" style={{ height: '120px' }} />
            ) : queue.length === 0 ? (
              <div className="empty-state" style={{ border: 'none' }}>
                <h3 className="empty-state-title">NO EMAILS</h3>
                <p>No emails in the {tab.replace('_', ' ')} queue.</p>
              </div>
            ) : queue.map(item => (
              <div
                key={item.id}
                onClick={() => openEditor(item)}
                style={{
                  padding: '1.5rem',
                  border: `1px solid ${selected?.id === item.id ? 'var(--text-on-light)' : 'var(--border-dark)'}`,
                  background: selected?.id === item.id ? 'var(--bg-light)' : 'transparent',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '1.125rem' }}>
                      {item.lead?.name || 'Unknown'}
                    </div>
                    <div className="data-font text-muted">{item.lead?.company}</div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.5rem' }}>
                    <span className={`score-pill ${(item.lead?.ai_score || 0) >= 70 ? 'score-high' : 'score-mid'}`}>
                      {item.lead?.ai_score || 0}
                    </span>
                    <span className="data-font text-muted" style={{ fontSize: '0.65rem' }}>STEP {item.sequence_step}</span>
                  </div>
                </div>
                
                <div style={{ fontWeight: 500, marginBottom: '0.5rem' }}>{item.subject}</div>
                <div className="text-muted" style={{ fontSize: '0.875rem', lineHeight: 1.5 }}>
                  {item.body.substring(0, 140)}…
                </div>
              </div>
            ))}
          </div>

          {/* Email Editor */}
          {selected && (
            <div className="fade-in" style={{ position: 'sticky', top: '5rem', alignSelf: 'flex-start', background: 'var(--bg-light)', padding: '2rem', border: '1px solid var(--border-dark)' }}>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <span className="micro-label" style={{ margin: 0, color: 'var(--text-on-light)' }}>
                  {tab === 'pending_review' ? 'REVIEW & APPROVE' : 'VIEW EMAIL'}
                </span>
                <button className="btn btn-ghost btn-sm" onClick={() => setSelected(null)}>✕</button>
              </div>

              <div className="data-font text-muted" style={{ marginBottom: '2rem', paddingBottom: '1rem', borderBottom: '1px solid var(--border-dark)' }}>
                TO: <span style={{ color: 'var(--text-on-light)' }}>{selected.lead?.email || 'unknown'}</span>
              </div>

              <div className="form-group">
                <label className="form-label">SUBJECT</label>
                <input
                  className="form-input"
                  value={editSubject}
                  onChange={e => setEditSubject(e.target.value)}
                  disabled={tab !== 'pending_review'}
                  style={{ fontSize: '1.25rem', fontWeight: 600 }}
                />
              </div>

              <div className="form-group" style={{ marginBottom: '2rem' }}>
                <label className="form-label">BODY</label>
                <textarea
                  className="form-textarea data-font"
                  value={editBody}
                  onChange={e => setEditBody(e.target.value)}
                  disabled={tab !== 'pending_review'}
                  style={{ minHeight: '300px', lineHeight: 1.6 }}
                />
              </div>

              {tab === 'pending_review' && (
                <div style={{ display: 'flex', gap: '1rem' }}>
                  <button
                    className="btn btn-primary"
                    onClick={handleApprove}
                    disabled={actioning || !editSubject || !editBody}
                    style={{ flex: 1 }}
                  >
                    {actioning ? 'SENDING...' : '✓ APPROVE & SEND'}
                  </button>
                  <button
                    className="btn btn-outline"
                    onClick={handleReject}
                    disabled={actioning}
                  >
                    ✕ REJECT
                  </button>
                </div>
              )}
              
            </div>
          )}

        </div>
      </section>
    </div>
  )
}
