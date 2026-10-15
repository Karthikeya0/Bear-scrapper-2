'use client'
import { useEffect, useState, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

type Lead = {
  id: string; name: string; company: string; email: string;
  source: string; ai_score: number; status: string; created_at: string; profile_url: string
}

const STATUS_OPTIONS = ['all', 'scored', 'contacted', 'replied', 'converted', 'dead', 'disqualified']
const SOURCE_OPTIONS = ['all', 'reddit', 'producthunt', 'twitter', 'yc', 'linkedin']

const statusClass = (s: string) => {
  const map: Record<string, string> = {
    scored: 'badge-blue', contacted: 'badge-purple', replied: 'badge-green',
    converted: 'badge-green', dead: 'badge-red', disqualified: 'badge-default'
  }
  return `badge ${map[s] || 'badge-default'}`
}

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [scoreMin, setScoreMin] = useState(0)
  const [stats, setStats] = useState({ total: 0, scored: 0, contacted: 0, replied: 0, converted: 0 })
  const [triggeringRun, setTriggeringRun] = useState(false)

  const supabase = useMemo(() => createClient(), [])

  const fetchLeads = useCallback(async () => {
    setLoading(true)
    let query = supabase.from('leads').select('*').order('created_at', { ascending: false }).limit(200)
    if (statusFilter !== 'all') query = query.eq('status', statusFilter)
    if (sourceFilter !== 'all') query = query.eq('source', sourceFilter)
    if (scoreMin > 0) query = query.gte('ai_score', scoreMin)
    if (search) query = query.or(`name.ilike.%${search}%,company.ilike.%${search}%,email.ilike.%${search}%`)
    const { data } = await query
    setLeads(data || [])
    setLoading(false)
  }, [statusFilter, sourceFilter, scoreMin, search, supabase])

  const fetchStats = useCallback(async () => {
    const { data } = await supabase.from('leads').select('status')
    if (!data) return
    setStats({
      total: data.length,
      scored: data.filter((l: any) => l.status === 'scored').length,
      contacted: data.filter((l: any) => l.status === 'contacted').length,
      replied: data.filter((l: any) => l.status === 'replied').length,
      converted: data.filter((l: any) => l.status === 'converted').length,
    })
  }, [supabase])

  useEffect(() => { fetchLeads(); fetchStats() }, [fetchLeads, fetchStats])

  useEffect(() => {
    const channel = supabase.channel('leads-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, () => { fetchLeads(); fetchStats() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [fetchLeads, fetchStats, supabase])

  async function triggerScraper() {
    setTriggeringRun(true)
    try {
      await fetch('/api/trigger', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workflow: 'WF-1-Scraper' }) })
    } finally {
      setTimeout(() => setTriggeringRun(false), 2000)
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Leads</div>
          <div className="page-subtitle">All scraped and scored leads</div>
        </div>
        <div className="page-actions">
          <button className="btn btn-ghost btn-sm" onClick={fetchLeads}>↻ Refresh</button>
          <button className="btn btn-primary btn-sm" onClick={triggerScraper} disabled={triggeringRun}>
            {triggeringRun ? '⏳ Triggering…' : '⚡ Run Scraper'}
          </button>
        </div>
      </div>

      <div className="page-body fade-in">
        {/* Stats */}
        <div className="stats-grid" style={{ marginBottom: '20px' }}>
          {[
            { label: 'Total Leads', value: stats.total },
            { label: 'Scored', value: stats.scored },
            { label: 'Contacted', value: stats.contacted },
            { label: 'Replied', value: stats.replied },
            { label: 'Converted', value: stats.converted },
          ].map(s => (
            <div key={s.label} className="stat-card">
              <div className="stat-value">{s.value}</div>
              <div className="stat-label">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="toolbar">
          <input
            className="search-input"
            placeholder="Search name, company, email…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            id="lead-search"
          />
          <select className="select-filter" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s === 'all' ? 'All statuses' : s}</option>)}
          </select>
          <select className="select-filter" value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}>
            {SOURCE_OPTIONS.map(s => <option key={s} value={s}>{s === 'all' ? 'All sources' : s}</option>)}
          </select>
          <select className="select-filter" value={scoreMin} onChange={e => setScoreMin(Number(e.target.value))}>
            <option value={0}>Any score</option>
            <option value={40}>Score ≥ 40</option>
            <option value={60}>Score ≥ 60</option>
            <option value={80}>Score ≥ 80</option>
          </select>
        </div>

        {/* Table */}
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name / Company</th>
                  <th>Source</th>
                  <th>Email</th>
                  <th>Score</th>
                  <th>Status</th>
                  <th>Added</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array(6).fill(0).map((_, i) => (
                    <tr key={i}>
                      {Array(6).fill(0).map((_, j) => (
                        <td key={j}><div className="skeleton" style={{ height: 16, width: j === 0 ? 140 : 80 }} /></td>
                      ))}
                    </tr>
                  ))
                ) : leads.length === 0 ? (
                  <tr><td colSpan={6}>
                    <div className="empty-state">
                      <div className="empty-state-icon">◈</div>
                      <div className="empty-state-title">No leads found</div>
                      <p>Run the scraper or adjust your filters.</p>
                    </div>
                  </td></tr>
                ) : leads.map(lead => (
                  <tr key={lead.id}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{lead.name || '—'}</div>
                      <div className="text-xs text-subtle">{lead.company || '—'}</div>
                    </td>
                    <td>
                      <span className="source-tag">{lead.source}</span>
                    </td>
                    <td className="text-sm text-muted font-mono">{lead.email || '—'}</td>
                    <td>
                      <span className={`score-pill ${lead.ai_score >= 70 ? 'score-high' : lead.ai_score >= 40 ? 'score-mid' : 'score-low'}`}>
                        {lead.ai_score || 0}
                      </span>
                    </td>
                    <td>
                      <span className={statusClass(lead.status)}>
                        <span className="badge-dot" />
                        {lead.status}
                      </span>
                    </td>
                    <td className="text-sm text-subtle font-mono">
                      {new Date(lead.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!loading && leads.length > 0 && (
            <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border-subtle)', fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
              {leads.length} leads
            </div>
          )}
        </div>
      </div>
    </>
  )
}
