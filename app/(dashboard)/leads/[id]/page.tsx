'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'

type Lead = Record<string, unknown>
type OutreachRecord = Record<string, unknown>

const STATUS_FLOW = ['scored', 'contacted', 'replied', 'converted', 'dead', 'unsubscribed', 'disqualified']

export default function LeadDetailPage() {
  const { id } = useParams()
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const [lead, setLead] = useState<Lead | null>(null)
  const [history, setHistory] = useState<OutreachRecord[]>([])
  const [sequences, setSequences] = useState<OutreachRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notes, setNotes] = useState('')

  const fetchLead = useCallback(async () => {
    const { data } = await supabase.from('leads').select('*').eq('id', id).single()
    if (data) { setLead(data); setNotes(data.notes || '') }

    const { data: hist } = await supabase
      .from('outreach_history').select('*').eq('lead_id', id).order('sent_at', { ascending: false })
    setHistory(hist || [])

    const { data: seqs } = await supabase
      .from('outreach_sequences').select('*').eq('lead_id', id).order('send_at')
    setSequences(seqs || [])

    setLoading(false)
  }, [id])

  useEffect(() => { fetchLead() }, [fetchLead])

  async function updateStatus(newStatus: string) {
    setSaving(true)
    const updates: Record<string, unknown> = { status: newStatus }
    if (newStatus === 'converted') updates.converted_at = new Date().toISOString()
    await supabase.from('leads').update(updates).eq('id', id)
    setLead(prev => prev ? { ...prev, ...updates } : prev)
    setSaving(false)
  }

  async function saveNotes() {
    setSaving(true)
    await supabase.from('leads').update({ notes }).eq('id', id)
    setSaving(false)
  }

  async function markOutreachEligible(eligible: boolean) {
    await supabase.from('leads').update({ outreach_eligible: eligible }).eq('id', id)
    setLead(prev => prev ? { ...prev, outreach_eligible: eligible } : prev)
  }

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {Array(4).fill(0).map((_, i) => (
        <div key={i} className="skeleton" style={{ height: 80, borderRadius: 'var(--radius)' }} />
      ))}
    </div>
  )

  if (!lead) return (
    <div className="empty-state">
      <div className="empty-state-title">Lead not found</div>
      <Link href="/leads" className="btn btn-ghost" style={{ marginTop: '1rem' }}>← Back to leads</Link>
    </div>
  )

  const score = lead.ai_score as number || 0
  const scoreClass = score >= 70 ? 'score-high' : score >= 40 ? 'score-mid' : 'score-low'
  const signals = (lead.ai_signals as string[]) || []

  return (
    <>
      {/* Header */}
      <div className="page-header">
        <div>
          <Link href="/leads" style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.5rem' }}>
            ← Back to leads
          </Link>
          <h1 className="page-title">{(lead.name as string) || 'Unknown'}</h1>
          <p className="page-subtitle">{(lead.company as string) || '—'} · {lead.source as string}</p>
        </div>
        <div className="page-actions">
          <span className={`score-pill ${scoreClass}`} style={{ fontSize: '1.25rem', padding: '0.375rem 0.875rem' }}>
            {score}
          </span>
          <span className={`badge badge-${lead.status}`}>
            {lead.status as string}
          </span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '1.5rem' }}>
        {/* Main Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

          {/* Profile */}
          <div className="card">
            <h3 style={{ marginBottom: '1rem' }}>Profile</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', fontSize: '0.875rem' }}>
              {([
                { label: 'Name', value: lead.name as string | null },
                { label: 'Company', value: lead.company as string | null },
                { label: 'Email', value: lead.email as string | null },
                { label: 'Domain', value: lead.company_domain as string | null },
                { label: 'Profile URL', value: lead.profile_url as string | null, isLink: true },
                { label: 'Source', value: lead.source as string | null },
              ] as { label: string; value: string | null; isLink?: boolean }[]).map(f => (
                <div key={f.label}>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.125rem' }}>{f.label}</div>
                  {f.isLink && f.value ? (
                    <a href={f.value as string} target="_blank" rel="noopener noreferrer" style={{ wordBreak: 'break-all' }}>
                      {f.value as string}
                    </a>
                  ) : (
                    <span style={{ color: f.value ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                      {(f.value as string) || '—'}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>


          <div className="card">
            <h3 style={{ marginBottom: '1rem' }}>AI Analysis</h3>
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem', fontWeight: 600 }}>REASONING</div>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                {(lead.ai_reasoning as string) || 'No reasoning recorded.'}
              </p>
            </div>
            {signals.length > 0 && (
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem', fontWeight: 600 }}>INTENT SIGNALS</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                  {signals.map((s, i) => (
                    <span key={i} className="badge badge-scored">{s}</span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Post Content */}
          {(lead.post_content as string) && (
            <div className="card">
              <h3 style={{ marginBottom: '0.75rem' }}>Source Content</h3>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>
                {(lead.post_content as string).substring(0, 1000)}
                {(lead.post_content as string).length > 1000 && '…'}
              </p>
            </div>
          )}

          {/* Outreach History */}
          <div className="card">
            <h3 style={{ marginBottom: '1rem' }}>Outreach History</h3>
            {history.length === 0 ? (
              <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>No outreach sent yet.</p>
            ) : (
              <div className="timeline">
                {history.map((h, i) => (
                  <div key={i} className="timeline-item">
                    <div className="timeline-dot">✉</div>
                    <div className="timeline-content">
                      <div className="timeline-title">Step {h.sequence_step as number}: {h.subject as string}</div>
                      <div className="timeline-time">{new Date(h.sent_at as string).toLocaleString()}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Pending Sequences */}
          {sequences.filter(s => !s.sent && !s.cancelled).length > 0 && (
            <div className="card">
              <h3 style={{ marginBottom: '1rem' }}>Scheduled Follow-ups</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {sequences.filter(s => !s.sent && !s.cancelled).map((s, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.875rem' }}>
                    <span>Step {s.sequence_step as number} — {s.template_key as string}</span>
                    <span style={{ color: 'var(--text-muted)' }}>
                      {new Date(s.send_at as string).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          <div className="card">
            <h3 style={{ marginBottom: '1rem' }}>Notes</h3>
            <textarea
              className="form-textarea"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Add notes about this lead…"
              style={{ marginBottom: '0.75rem' }}
            />
            <button className="btn btn-ghost btn-sm" onClick={saveNotes} disabled={saving}>
              {saving ? 'Saving…' : 'Save notes'}
            </button>
          </div>
        </div>

        {/* Right Sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

          {/* Status Actions */}
          <div className="card">
            <h4 style={{ marginBottom: '1rem', color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              Update Status
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {STATUS_FLOW.map(s => (
                <button
                  key={s}
                  className={`btn btn-ghost btn-sm ${lead.status === s ? 'active' : ''}`}
                  onClick={() => updateStatus(s)}
                  disabled={saving}
                  style={{
                    justifyContent: 'space-between',
                    background: lead.status === s ? 'var(--accent-glow)' : undefined,
                    color: lead.status === s ? 'var(--accent-light)' : undefined,
                    borderColor: lead.status === s ? 'var(--accent)' : undefined,
                  }}
                >
                  <span style={{ textTransform: 'capitalize' }}>{s}</span>
                  {lead.status === s && <span>✓</span>}
                </button>
              ))}
            </div>
          </div>

          {/* Outreach Toggle */}
          <div className="card">
            <h4 style={{ marginBottom: '1rem', color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              Outreach
            </h4>
            <div style={{ fontSize: '0.875rem', marginBottom: '0.75rem', color: 'var(--text-secondary)' }}>
              Eligible for automated outreach:
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                className={`btn btn-sm ${lead.outreach_eligible ? 'btn-success' : 'btn-ghost'}`}
                onClick={() => markOutreachEligible(true)}
              >
                ✓ Yes
              </button>
              <button
                className={`btn btn-sm ${!lead.outreach_eligible ? 'btn-danger' : 'btn-ghost'}`}
                onClick={() => markOutreachEligible(false)}
              >
                ✗ No
              </button>
            </div>
          </div>

          {/* Timestamps */}
          <div className="card">
            <h4 style={{ marginBottom: '1rem', color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              Timeline
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem', fontSize: '0.8125rem' }}>
              {[
                { label: 'Scraped', value: lead.created_at },
                { label: 'First contacted', value: lead.first_contacted_at },
                { label: 'Replied', value: lead.replied_at },
                { label: 'Converted', value: lead.converted_at },
              ].map(t => (
                <div key={t.label} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>{t.label}</span>
                  <span style={{ color: t.value ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                    {t.value ? new Date(t.value as string).toLocaleDateString() : '—'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
