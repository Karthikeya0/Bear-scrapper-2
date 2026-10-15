'use client'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/Toast'
import { Alert, EmptyState, PageHeader, ScoreBadge, Spinner, StatusBadge } from '@/components/ui'
import { IconArrowLeft, IconCheck, IconExternal, IconMail, IconSparkle } from '@/components/icons'
import { formatDate, formatDateTime, humanize } from '@/lib/format'

type Lead = {
  id: string; name: string | null; company: string | null; email: string | null; source: string | null
  company_domain: string | null; profile_url: string | null; bio: string | null; post_content: string | null
  ai_score: number | null; ai_reasoning: string | null; ai_signals: unknown; status: string; notes: string | null
  outreach_eligible: boolean | null; created_at: string; first_contacted_at: string | null
  replied_at: string | null; converted_at: string | null
}
type History = { id: string; subject: string | null; body_sent: string | null; body: string | null; sequence_step: number | null; sent_at: string | null }
type Sequence = { id: string; sequence_step: number | null; step: number | null; template_key: string | null; send_at: string; sent: boolean | null; cancelled: boolean | null }

const STATUS_FLOW = ['scored', 'contacted', 'replied', 'converted', 'dead', 'bounced', 'unsubscribed', 'disqualified']

function toSignals(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed.map(String) : []
    } catch {
      return value ? [value] : []
    }
  }
  return []
}

function safeUrl(value: string | null) {
  if (!value) return null
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null
  } catch {
    return null
  }
}

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>()
  const supabase = useMemo(() => createClient(), [])
  const toast = useToast()

  const [lead, setLead] = useState<Lead | null>(null)
  const [history, setHistory] = useState<History[]>([])
  const [sequences, setSequences] = useState<Sequence[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [savingStatus, setSavingStatus] = useState('')
  const [notes, setNotes] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)

  const load = useCallback(async () => {
    const [l, h, s] = await Promise.all([
      supabase.from('leads').select('*').eq('id', id).maybeSingle(),
      supabase.from('outreach_history').select('*').eq('lead_id', id).order('sent_at', { ascending: false }),
      supabase.from('outreach_sequences').select('*').eq('lead_id', id).order('send_at'),
    ])
    if (l.error) setError(l.error.message)
    if (l.data) {
      setLead(l.data as Lead)
      setNotes((l.data as Lead).notes ?? '')
    }
    setHistory((h.data ?? []) as History[])
    setSequences((s.data ?? []) as Sequence[])
    setLoading(false)
  }, [id, supabase])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load
    load()
  }, [load])

  async function update(fields: Partial<Lead>, successMsg: string) {
    const { error } = await supabase.from('leads').update(fields).eq('id', id)
    if (error) {
      toast.error(`Could not save: ${error.message}`)
      return false
    }
    setLead(prev => (prev ? { ...prev, ...fields } : prev))
    toast.success(successMsg)
    return true
  }

  async function setStatus(next: string) {
    if (!lead || next === lead.status) return
    setSavingStatus(next)
    const fields: Partial<Lead> = { status: next }
    if (next === 'converted' && !lead.converted_at) fields.converted_at = new Date().toISOString()
    await update(fields, `Status changed to ${humanize(next)}.`)
    setSavingStatus('')
  }

  async function saveNotes() {
    setSavingNotes(true)
    await update({ notes }, 'Notes saved.')
    setSavingNotes(false)
  }

  const back = (
    <Link href="/leads" className="back-link">
      <IconArrowLeft width={14} height={14} /> Leads
    </Link>
  )

  if (loading) {
    return (
      <div className="stack">
        <div className="skeleton" style={{ height: 56, width: 320 }} />
        <div className="grid grid-aside">
          <div className="skeleton" style={{ height: 320, borderRadius: 14 }} />
          <div className="skeleton" style={{ height: 320, borderRadius: 14 }} />
        </div>
      </div>
    )
  }

  if (!lead) {
    return (
      <>
        <PageHeader title="Lead not found" back={back} />
        {error ? <Alert>{error}</Alert> : <div className="card"><EmptyState title="This lead doesn't exist or was removed." /></div>}
      </>
    )
  }

  const signals = toSignals(lead.ai_signals)
  const profileUrl = safeUrl(lead.profile_url)
  const pendingSequences = sequences.filter(s => !s.sent && !s.cancelled)

  return (
    <>
      <PageHeader
        back={back}
        title={lead.name || 'Unnamed lead'}
        description={[lead.company, lead.source].filter(Boolean).join(' · ') || undefined}
        actions={
          <>
            <ScoreBadge score={lead.ai_score} large />
            <StatusBadge status={lead.status} />
          </>
        }
      />

      <div className="grid grid-aside">
        <div className="stack">
          <div className="card card-pad">
            <div className="section-title">Profile</div>
            <dl className="dl">
              <div><dt>Name</dt><dd>{lead.name || '—'}</dd></div>
              <div><dt>Company</dt><dd>{lead.company || '—'}</dd></div>
              <div>
                <dt>Email</dt>
                <dd>{lead.email ? <a className="link" href={`mailto:${lead.email}`}>{lead.email}</a> : <span className="subtle">Not found yet</span>}</dd>
              </div>
              <div><dt>Domain</dt><dd>{lead.company_domain || '—'}</dd></div>
              <div>
                <dt>Profile</dt>
                <dd>
                  {profileUrl ? (
                    <a className="link row" href={profileUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex' }}>
                      Open profile <IconExternal width={13} height={13} />
                    </a>
                  ) : '—'}
                </dd>
              </div>
              <div><dt>Source</dt><dd>{lead.source ? <span className="tag">{lead.source}</span> : '—'}</dd></div>
              {lead.bio && <div style={{ gridColumn: '1 / -1' }}><dt>Bio</dt><dd>{lead.bio}</dd></div>}
            </dl>
          </div>

          <div className="card card-pad">
            <div className="row" style={{ marginBottom: 12 }}>
              <IconSparkle width={16} height={16} style={{ color: 'var(--accent)' }} />
              <div className="section-title" style={{ margin: 0 }}>AI analysis</div>
            </div>
            <p className="prose">{lead.ai_reasoning || 'No reasoning was recorded for this lead.'}</p>
            {signals.length > 0 && (
              <div className="row" style={{ flexWrap: 'wrap', marginTop: 14 }}>
                {signals.map((s, i) => <span key={i} className="badge accent plain as-is">{s}</span>)}
              </div>
            )}
          </div>

          {lead.post_content && (
            <div className="card card-pad">
              <div className="section-title">Source content</div>
              <p className="prose">
                {lead.post_content.slice(0, 1500)}
                {lead.post_content.length > 1500 && '…'}
              </p>
            </div>
          )}

          <div className="card card-pad">
            <div className="section-title">Outreach history</div>
            {history.length === 0 ? (
              <p className="muted">No emails have been sent to this lead yet.</p>
            ) : (
              <div className="timeline">
                {history.map(h => (
                  <div key={h.id} className="tl-item">
                    <div className="tl-dot"><IconMail /></div>
                    <div style={{ minWidth: 0 }}>
                      <div className="tl-title">
                        {h.sequence_step ? `Step ${h.sequence_step} · ` : ''}
                        {h.subject || '(no subject)'}
                      </div>
                      <div className="tl-time">{formatDateTime(h.sent_at)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {pendingSequences.length > 0 && (
              <>
                <div className="section-title" style={{ marginTop: 18 }}>Scheduled follow-ups</div>
                {pendingSequences.map(s => (
                  <div key={s.id} className="kv">
                    <span>Step {s.sequence_step ?? s.step ?? '—'} {s.template_key ? `· ${humanize(s.template_key)}` : ''}</span>
                    <span>{formatDate(s.send_at)}</span>
                  </div>
                ))}
              </>
            )}
          </div>

          <div className="card card-pad">
            <div className="section-title">Notes</div>
            <textarea
              className="textarea"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Context, call notes, next steps…"
            />
            <div className="row" style={{ marginTop: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-primary btn-sm" onClick={saveNotes} disabled={savingNotes || notes === (lead.notes ?? '')}>
                {savingNotes && <Spinner />} Save notes
              </button>
            </div>
          </div>
        </div>

        <div className="stack sticky">
          <div className="card card-pad">
            <div className="section-title">Status</div>
            <div className="status-list">
              {STATUS_FLOW.map(s => (
                <button
                  key={s}
                  className={`status-opt ${lead.status === s ? 'active' : ''}`}
                  onClick={() => setStatus(s)}
                  disabled={!!savingStatus}
                >
                  <span>{humanize(s)}</span>
                  {savingStatus === s ? <Spinner /> : lead.status === s ? <IconCheck width={15} height={15} /> : null}
                </button>
              ))}
            </div>
          </div>

          <div className="card card-pad">
            <div className="section-title">Automated outreach</div>
            <label className="check">
              <input
                type="checkbox"
                checked={lead.outreach_eligible !== false}
                onChange={e => update({ outreach_eligible: e.target.checked }, e.target.checked ? 'Lead included in outreach.' : 'Lead excluded from outreach.')}
              />
              Eligible for AI-drafted emails
            </label>
            <p className="hint" style={{ marginTop: 8 }}>WF-3 only drafts emails for eligible leads with a score of 60+.</p>
          </div>

          <div className="card card-pad">
            <div className="section-title">Timeline</div>
            {[
              ['Scraped', lead.created_at],
              ['First contacted', lead.first_contacted_at],
              ['Replied', lead.replied_at],
              ['Converted', lead.converted_at],
            ].map(([label, value]) => (
              <div key={label} className="kv">
                <span>{label}</span>
                <span>{formatDate(value)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
