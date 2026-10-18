'use client'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRole } from '@/components/AppShell'
import { Alert, EmptyState, PageHeader, ScoreBadge, SkeletonRows, StatusBadge } from '@/components/ui'
import { IconArrowRight, IconKanban, IconMail, IconRefresh, IconSend, IconTarget, IconUsers } from '@/components/icons'
import { errorMessage, formatDay, formatMoney, isOverdue, timeAgo } from '@/lib/format'

type Project = { id: string; client_id: string | null; title: string; status: string; deadline: string | null; clients: { company: string } | null }
type Lead = { id: string; name: string | null; company: string | null; ai_score: number | null; status: string; created_at: string }
type Stats = { clients: number; mrr: number; projects: number; leads: number; pendingReview: number; sent: number }

export default function DashboardPage() {
  const role = useRole()
  const isOwner = role === 'owner'
  const [stats, setStats] = useState<Stats | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const supabase = createClient()
    try {
      const [clients, projectCount, projectRows, leadCount, leadRows, pending, sent] = await Promise.all([
        supabase.from('clients').select('monthly_value').eq('status', 'active'),
        (supabase.from('projects').select('id', { count: 'exact', head: true }).in('status', ['todo', 'in_progress', 'review'])),
        supabase
          .from('projects')
          .select('id, client_id, title, status, deadline, clients(company)')
          .in('status', ['todo', 'in_progress', 'review'])
          .order('deadline', { ascending: true, nullsFirst: false })
          .limit(6),
        (supabase.from('leads').select('id', { count: 'exact', head: true })),
        supabase
          .from('leads')
          .select('id, name, company, ai_score, status, created_at')
          .order('created_at', { ascending: false })
          .limit(6),
        isOwner
          ? (supabase.from('outreach_queue').select('id', { count: 'exact', head: true }).eq('status', 'pending_review'))
          : Promise.resolve({ count: 0, error: null }),
        isOwner
          ? (supabase.from('outreach_queue').select('id', { count: 'exact', head: true }).eq('status', 'sent'))
          : Promise.resolve({ count: 0, error: null }),
      ])

      const firstError = [clients, projectCount, projectRows, leadCount, leadRows, pending, sent].find(r => r.error)?.error
      if (firstError) setError(errorMessage(firstError))

      const activeClients = (clients.data ?? []) as { monthly_value: number | null }[]
      setStats({
        clients: activeClients.length,
        mrr: activeClients.reduce((sum, c) => sum + (Number(c.monthly_value) || 0), 0),
        projects: projectCount.count ?? 0,
        leads: leadCount.count ?? 0,
        pendingReview: pending.count ?? 0,
        sent: sent.count ?? 0,
      })
      setProjects((projectRows.data ?? []) as unknown as Project[])
      setLeads((leadRows.data ?? []) as Lead[])
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [isOwner])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load
    load()
  }, [load])

  const statCards = [
    { label: 'Active clients', value: stats?.clients, hint: isOwner && stats ? `${formatMoney(stats.mrr)} / month retained` : 'Clients on active retainers', href: '/clients', icon: <IconUsers />, owner: true },
    { label: 'Open projects', value: stats?.projects, hint: 'To do, in progress or in review', href: '/pending', icon: <IconKanban />, owner: false },
    { label: 'Leads in pipeline', value: stats?.leads, hint: 'Scraped & scored by n8n', href: '/leads', icon: <IconTarget />, owner: false },
    { label: 'Awaiting review', value: stats?.pendingReview, hint: 'Drafted emails to approve', href: '/outreach', icon: <IconMail />, owner: true },
    { label: 'Emails sent', value: stats?.sent, hint: 'Delivered via Gmail (WF-3b)', href: '/outreach?tab=sent', icon: <IconSend />, owner: true },
  ].filter(s => isOwner || !s.owner)

  return (
    <>
      <PageHeader
        title="Overview"
        description="Your studio at a glance — pipeline, production and outreach."
        actions={
          <>
            <button className="btn" onClick={load} disabled={loading}>
              <IconRefresh className="icon" /> Refresh
            </button>
            {isOwner && (
              <Link href="/runs" className="btn btn-primary">
                Run workflows <IconArrowRight className="icon" />
              </Link>
            )}
          </>
        }
      />

      {error && <Alert title="Some data could not be loaded">{error}</Alert>}

      <div className="stats">
        {statCards.map(s => {
          const body = (
            <>
            <div className="stat-top">
              <span className="stat-label">{s.label}</span>
              <span className="stat-icon">{s.icon}</span>
            </div>
            <div className="stat-value">
              {loading && !stats ? <span className="skeleton" style={{ display: 'inline-block', width: 48, height: 26 }} /> : (s.value ?? 0).toLocaleString()}
            </div>
            <div className="stat-hint">{s.hint}</div>
            </>
          )
          return isOwner || s.href === '/pending' ? (
            <Link key={s.label} href={s.href} className="stat">{body}</Link>
          ) : (
            <div key={s.label} className="stat">{body}</div>
          )
        })}
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">Upcoming deadlines</div>
              <div className="card-desc">Open projects, soonest first</div>
            </div>
            <Link href="/pending" className="btn btn-sm btn-ghost">
              Board <IconArrowRight className="icon" />
            </Link>
          </div>
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {loading && projects.length === 0 ? (
                  <SkeletonRows rows={4} cols={3} />
                ) : projects.length === 0 ? (
                  <tr>
                    <td>
                      <EmptyState icon={<IconKanban />} title="No open projects" text="Projects you add to a client will show up here." />
                    </td>
                  </tr>
                ) : (
                  projects.map(p => (
                    <tr key={p.id}>
                      <td>
                        {isOwner && p.client_id ? (
                          <Link href={`/clients/${p.client_id}`} className="cell-title">{p.title}</Link>
                        ) : (
                          <div className="cell-title">{p.title}</div>
                        )}
                        <div className="cell-sub">{p.clients?.company ?? 'Internal'}</div>
                      </td>
                      <td><StatusBadge status={p.status} /></td>
                      <td className={`t-right num ${isOverdue(p.deadline) ? 'overdue' : 'subtle'}`}>{formatDay(p.deadline)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">Newest leads</div>
              <div className="card-desc">Latest prospects scored by the AI filter</div>
            </div>
            {isOwner && (
              <Link href="/leads" className="btn btn-sm btn-ghost">
                All leads <IconArrowRight className="icon" />
              </Link>
            )}
          </div>
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {loading && leads.length === 0 ? (
                  <SkeletonRows rows={4} cols={3} />
                ) : leads.length === 0 ? (
                  <tr>
                    <td>
                      <EmptyState icon={<IconTarget />} title="No leads yet" text="Run the scraper and processor workflows to fill your pipeline." />
                    </td>
                  </tr>
                ) : (
                  leads.map(l => (
                    <tr key={l.id}>
                      <td>
                        {isOwner ? (
                          <Link href={`/leads/${l.id}`} className="cell-title">{l.name || 'Unnamed lead'}</Link>
                        ) : (
                          <div className="cell-title">{l.name || 'Unnamed lead'}</div>
                        )}
                        <div className="cell-sub">{l.company || '—'} · {timeAgo(l.created_at)}</div>
                      </td>
                      <td><ScoreBadge score={l.ai_score} /></td>
                      <td className="t-right"><StatusBadge status={l.status} /></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  )
}
