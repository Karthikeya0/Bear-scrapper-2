'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/Toast'
import { Alert, EmptyState, PageHeader, ScoreBadge, SkeletonRows, Spinner, StatusBadge } from '@/components/ui'
import { IconBolt, IconRefresh, IconSearch, IconTarget } from '@/components/icons'
import { errorMessage, formatDate, humanize } from '@/lib/format'
import { triggerWorkflow } from '@/lib/workflows'

type Lead = {
  id: string; name: string | null; company: string | null; email: string | null
  source: string | null; ai_score: number | null; status: string; created_at: string
}

const STATUSES = ['scored', 'contacted', 'replied', 'converted', 'dead', 'bounced', 'unsubscribed', 'disqualified']
const SOURCES = ['reddit', 'producthunt', 'yc', 'twitter', 'linkedin']
const PAGE_SIZE = 50
const FUNNEL = ['scored', 'contacted', 'replied', 'converted'] as const

/** Strip characters that have meaning inside a PostgREST `or=(...)` filter. */
function sanitizeSearch(value: string) {
  return value.replace(/[,()*%\\:"]/g, ' ').trim()
}

export default function LeadsPage() {
  const router = useRouter()
  const toast = useToast()
  const supabase = useMemo(() => createClient(), [])

  const [leads, setLeads] = useState<Lead[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [status, setStatus] = useState('all')
  const [source, setSource] = useState('all')
  const [minScore, setMinScore] = useState(0)
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [funnel, setFunnel] = useState<Record<string, number>>({})
  const [funnelTotal, setFunnelTotal] = useState(0)
  const [triggering, setTriggering] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(sanitizeSearch(search))
      setLimit(PAGE_SIZE)
    }, 300)
    return () => clearTimeout(t)
  }, [search])

  const fetchLeads = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('leads')
      .select('id, name, company, email, source, ai_score, status, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(0, limit - 1)
    if (status !== 'all') query = query.eq('status', status)
    if (source !== 'all') query = query.eq('source', source)
    if (minScore > 0) query = query.gte('ai_score', minScore)
    if (debounced) query = query.or(`name.ilike.*${debounced}*,company.ilike.*${debounced}*,email.ilike.*${debounced}*`)

    const { data, count, error } = await query
    if (error) setError(error.message)
    else {
      setError('')
      setLeads((data ?? []) as Lead[])
      setTotal(count ?? 0)
    }
    setLoading(false)
  }, [supabase, status, source, minScore, debounced, limit])

  const fetchFunnel = useCallback(async () => {
    const results = await Promise.all([
      supabase.from('leads').select('id', { count: 'exact', head: true }),
      ...FUNNEL.map(s => supabase.from('leads').select('id', { count: 'exact', head: true }).eq('status', s)),
    ])
    setFunnelTotal(results[0].count ?? 0)
    setFunnel(Object.fromEntries(FUNNEL.map((s, i) => [s, results[i + 1].count ?? 0])))
  }, [supabase])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data load on filter change
    fetchLeads()
  }, [fetchLeads])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load, then realtime refresh
    fetchFunnel()
    const channel = supabase
      .channel('leads-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, () => {
        fetchLeads()
        fetchFunnel()
      })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, fetchFunnel, fetchLeads])

  async function runScraper() {
    setTriggering(true)
    const res = await triggerWorkflow('WF-1-Scraper')
    setTriggering(false)
    if (res.ok) toast.success('Scraper started in n8n. New leads appear here automatically once scored.')
    else toast.error(res.error ?? 'Could not start the scraper.')
  }

  const filtersActive = status !== 'all' || source !== 'all' || minScore > 0 || !!debounced

  return (
    <>
      <PageHeader
        title="Leads"
        description="Every prospect scraped and scored by your n8n pipeline."
        actions={
          <>
            <button className="btn" onClick={() => { fetchLeads(); fetchFunnel() }} disabled={loading}>
              <IconRefresh className="icon" /> Refresh
            </button>
            <button className="btn btn-primary" onClick={runScraper} disabled={triggering}>
              {triggering ? <Spinner /> : <IconBolt className="icon" />}
              {triggering ? 'Starting…' : 'Run scraper'}
            </button>
          </>
        }
      />

      <div className="stats">
        <div className="stat">
          <div className="stat-label">Total leads</div>
          <div className="stat-value" style={{ marginTop: 10 }}>{funnelTotal.toLocaleString()}</div>
        </div>
        {FUNNEL.map(s => (
          <button
            key={s}
            className="stat"
            style={{ textAlign: 'left', font: 'inherit', color: 'inherit', cursor: 'pointer', outline: status === s ? '2px solid var(--accent)' : undefined }}
            onClick={() => setStatus(status === s ? 'all' : s)}
            title={`Filter by ${s}`}
          >
            <div className="stat-label" style={{ textTransform: 'capitalize' }}>{s}</div>
            <div className="stat-value" style={{ marginTop: 10 }}>{(funnel[s] ?? 0).toLocaleString()}</div>
            <div className="stat-hint">
              {funnelTotal ? `${Math.round(((funnel[s] ?? 0) / funnelTotal) * 100)}% of pipeline` : '—'}
            </div>
          </button>
        ))}
      </div>

      <div className="toolbar">
        <div className="search">
          <IconSearch />
          <input
            className="input"
            placeholder="Search name, company or email…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            aria-label="Search leads"
          />
        </div>
        <select className="select" value={status} onChange={e => { setStatus(e.target.value); setLimit(PAGE_SIZE) }} aria-label="Status">
          <option value="all">All statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{humanize(s)}</option>)}
        </select>
        <select className="select" value={source} onChange={e => { setSource(e.target.value); setLimit(PAGE_SIZE) }} aria-label="Source">
          <option value="all">All sources</option>
          {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="select" value={minScore} onChange={e => { setMinScore(Number(e.target.value)); setLimit(PAGE_SIZE) }} aria-label="Minimum score">
          <option value={0}>Any score</option>
          <option value={40}>Score ≥ 40</option>
          <option value={60}>Score ≥ 60</option>
          <option value={80}>Score ≥ 80</option>
        </select>
        {filtersActive && (
          <button className="btn btn-ghost btn-sm" onClick={() => { setSearch(''); setStatus('all'); setSource('all'); setMinScore(0) }}>
            Clear filters
          </button>
        )}
      </div>

      {error && <Alert title="Could not load leads">{errorMessage(error)}</Alert>}

      <div className="card">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Lead</th>
                <th>Source</th>
                <th>Email</th>
                <th>Score</th>
                <th>Status</th>
                <th className="t-right">Added</th>
              </tr>
            </thead>
            <tbody>
              {loading && leads.length === 0 ? (
                <SkeletonRows rows={8} cols={6} />
              ) : leads.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <EmptyState
                      icon={<IconTarget />}
                      title={filtersActive ? 'No leads match these filters' : 'No leads yet'}
                      text={filtersActive ? 'Try widening your search or clearing filters.' : 'Run the scraper, then the processor, to populate your pipeline.'}
                    />
                  </td>
                </tr>
              ) : (
                leads.map(lead => (
                  <tr key={lead.id} className="clickable" onClick={() => router.push(`/leads/${lead.id}`)}>
                    <td>
                      <Link href={`/leads/${lead.id}`} className="cell-title" onClick={e => e.stopPropagation()}>
                        {lead.name || 'Unnamed lead'}
                      </Link>
                      <div className="cell-sub">{lead.company || '—'}</div>
                    </td>
                    <td>{lead.source ? <span className="tag">{lead.source}</span> : <span className="subtle">—</span>}</td>
                    <td className="mono muted">{lead.email || <span className="subtle">—</span>}</td>
                    <td><ScoreBadge score={lead.ai_score} /></td>
                    <td><StatusBadge status={lead.status} /></td>
                    <td className="t-right subtle num">{formatDate(lead.created_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {leads.length > 0 && (
          <div className="card-foot row-between">
            <span>
              Showing {leads.length.toLocaleString()} of {total.toLocaleString()}
            </span>
            {leads.length < total && (
              <button className="btn btn-sm" onClick={() => setLimit(l => l + PAGE_SIZE)} disabled={loading}>
                {loading ? <Spinner /> : null} Load more
              </button>
            )}
          </div>
        )}
      </div>
    </>
  )
}
