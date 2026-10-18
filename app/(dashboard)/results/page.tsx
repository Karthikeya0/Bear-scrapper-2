'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Alert, EmptyState, PageHeader } from '@/components/ui'
import { IconChart, IconRefresh } from '@/components/icons'
import { DEFAULT_SETTINGS, loadSettings } from '@/lib/settings'

type Lead = { id: string; source: string | null; status: string; email: string | null; ai_score: number | null; replied_at: string | null }
type Sent = { lead_id: string; channel: string | null; sequence_step: number | null; sent_at: string | null }

const CONTACTED = new Set(['contacted', 'replied', 'converted', 'bounced', 'unsubscribed', 'dead'])
const REPLIED = new Set(['replied', 'converted'])
const WEEKS = 6
const DAY = 86400000

const pct = (num: number, den: number) => (den ? `${Math.round((num / den) * 100)}%` : '—')

function weekStart(d: Date) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)) // Monday
  return x
}

async function fetchAll<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = []
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await query(from, from + 999)
    if (error) throw new Error(error.message)
    rows.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return rows
}

export default function ResultsPage() {
  const supabase = useMemo(() => createClient(), [])
  const [leads, setLeads] = useState<Lead[]>([])
  const [sent, setSent] = useState<Sent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [loadedAt, setLoadedAt] = useState(0)
  const [minScore, setMinScore] = useState(DEFAULT_SETTINGS.min_score)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [l, s, cfg] = await Promise.all([
        fetchAll<Lead>((a, b) => supabase.from('leads').select('id, source, status, email, ai_score, replied_at').range(a, b)),
        fetchAll<Sent>((a, b) =>
          supabase.from('outreach_queue').select('lead_id, channel, sequence_step, sent_at').eq('status', 'sent').range(a, b),
        ),
        loadSettings(supabase),
      ])
      setMinScore(cfg.settings.min_score)
      setLeads(l)
      setSent(s)
      setLoadedAt(Date.now())
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load
    load()
  }, [load])

  const emails = sent.filter(s => (s.channel ?? 'email') === 'email')
  const firstEmails = emails.filter(s => (s.sequence_step ?? 1) === 1).length
  const followUps = emails.length - firstEmails
  const dms = sent.length - emails.length
  const contacted = leads.filter(l => CONTACTED.has(l.status))
  const replied = leads.filter(l => REPLIED.has(l.status))
  const bounced = leads.filter(l => l.status === 'bounced').length
  const weekAgo = loadedAt - 7 * DAY
  const sentThisWeek = emails.filter(s => s.sent_at && Date.parse(s.sent_at) >= weekAgo).length
  const repliesThisWeek = leads.filter(l => l.replied_at && Date.parse(l.replied_at) >= weekAgo).length

  const sources = [...new Set(leads.map(l => l.source ?? 'unknown'))].sort()
  const bySource = sources.map(src => {
    const ls = leads.filter(l => (l.source ?? 'unknown') === src)
    const c = ls.filter(l => CONTACTED.has(l.status)).length
    const r = ls.filter(l => REPLIED.has(l.status)).length
    return { src, total: ls.length, good: ls.filter(l => (l.ai_score ?? 0) >= minScore).length, withEmail: ls.filter(l => l.email).length, contacted: c, replied: r }
  }).sort((a, b) => b.replied - a.replied || b.contacted - a.contacted || b.total - a.total)

  const thisWeek = weekStart(new Date(loadedAt))
  const weeks = Array.from({ length: WEEKS }, (_, i) => {
    const start = new Date(thisWeek.getTime() - i * 7 * DAY)
    const end = start.getTime() + 7 * DAY
    const inWeek = (iso: string | null) => !!iso && Date.parse(iso) >= start.getTime() && Date.parse(iso) < end
    const w = sent.filter(s => inWeek(s.sent_at))
    return {
      label: start.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
      first: w.filter(s => (s.channel ?? 'email') === 'email' && (s.sequence_step ?? 1) === 1).length,
      followUps: w.filter(s => (s.channel ?? 'email') === 'email' && (s.sequence_step ?? 1) > 1).length,
      dms: w.filter(s => s.channel === 'dm').length,
      replies: leads.filter(l => inWeek(l.replied_at)).length,
    }
  })

  const tiles = [
    { label: 'Emails sent', value: emails.length, hint: `${firstEmails} first · ${followUps} follow-ups · ${sentThisWeek} this week` },
    { label: 'DMs sent', value: dms, hint: 'Marked sent on the Outreach page' },
    { label: 'Replies', value: replied.length, hint: `${repliesThisWeek} this week` },
    { label: 'Reply rate', value: pct(replied.length, contacted.length), hint: `of ${contacted.length} contacted leads` },
    { label: 'Bounced', value: bounced, hint: pct(bounced, contacted.length) + ' of contacted' },
  ]

  return (
    <>
      <PageHeader
        title="Results"
        description="What your outreach is producing, and which lead sources are worth it."
        actions={
          <button className="btn" onClick={load} disabled={loading}>
            <IconRefresh className="icon" /> Refresh
          </button>
        }
      />
      {error && <Alert title="Could not load results">{error}</Alert>}

      <div className="stats">
        {tiles.map(t => (
          <div key={t.label} className="stat">
            <div className="stat-label">{t.label}</div>
            <div className="stat-value" style={{ marginTop: 10 }}>{loading ? '…' : t.value}</div>
            <div className="stat-hint">{t.hint}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-head"><div><div className="card-title">By source</div><div className="card-desc">Best performers first</div></div></div>
          {bySource.length === 0 && !loading ? (
            <EmptyState icon={<IconChart />} title="No leads yet" text="Results appear once leads are scraped and contacted." />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>Source</th><th className="t-right">Leads</th><th className="t-right">Score {minScore}+</th><th className="t-right">With email</th><th className="t-right">Contacted</th><th className="t-right">Replied</th><th className="t-right">Reply rate</th></tr>
                </thead>
                <tbody>
                  {bySource.map(r => (
                    <tr key={r.src}>
                      <td><span className="tag">{r.src}</span></td>
                      <td className="t-right num">{r.total}</td>
                      <td className="t-right num">{r.good}</td>
                      <td className="t-right num">{r.withEmail}</td>
                      <td className="t-right num">{r.contacted}</td>
                      <td className="t-right num">{r.replied}</td>
                      <td className="t-right num">{pct(r.replied, r.contacted)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-head"><div><div className="card-title">By week</div><div className="card-desc">Weeks start on Monday</div></div></div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Week of</th><th className="t-right">First emails</th><th className="t-right">Follow-ups</th><th className="t-right">DMs</th><th className="t-right">Replies</th></tr>
              </thead>
              <tbody>
                {weeks.map(w => (
                  <tr key={w.label}>
                    <td>{w.label}</td>
                    <td className="t-right num">{w.first}</td>
                    <td className="t-right num">{w.followUps}</td>
                    <td className="t-right num">{w.dms}</td>
                    <td className="t-right num">{w.replies}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  )
}
