'use client'
import { useEffect, useState, use } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

export default function ClientProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [client, setClient] = useState<any>(null)
  const [projects, setProjects] = useState<any[]>([])
  const [comms, setComms] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [notes, setNotes] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)
  const [savedNotesToast, setSavedNotesToast] = useState(false)
  const [activeTab, setActiveTab] = useState<'projects' | 'comms' | 'notes'>('projects')

  // New Project Drawer
  const [projDrawerOpen, setProjDrawerOpen] = useState(false)
  const [projTitle, setProjTitle] = useState('')
  const [projDescription, setProjDescription] = useState('')
  const [projPriority, setProjPriority] = useState('high')
  const [projStatus, setProjStatus] = useState('in_progress')
  const [projDeadline, setProjDeadline] = useState('')
  const [creatingProj, setCreatingProj] = useState(false)

  // New Comm Drawer
  const [commDrawerOpen, setCommDrawerOpen] = useState(false)
  const [commChannel, setCommChannel] = useState('email')
  const [commDirection, setCommDirection] = useState('outbound')
  const [commBody, setCommBody] = useState('')
  const [savingComm, setSavingComm] = useState(false)

  const supabase = createClient()

  const fetchAll = async () => {
    setLoading(true)
    const [{ data: c }, { data: p }, { data: co }] = await Promise.all([
      supabase.from('clients').select('*').eq('id', id).single(),
      supabase.from('projects').select('*').eq('client_id', id).order('created_at', { ascending: false }),
      supabase.from('communications').select('*').eq('client_id', id).order('created_at', { ascending: false })
    ])
    setClient(c)
    setNotes(c?.contract_notes || '')
    setProjects(p || [])
    setComms(co || [])
    setLoading(false)
  }

  useEffect(() => {
    fetchAll()
  }, [id])

  const saveNotes = async () => {
    setSavingNotes(true)
    await supabase.from('clients').update({ contract_notes: notes }).eq('id', id)
    setSavingNotes(false)
    setSavedNotesToast(true)
    setTimeout(() => setSavedNotesToast(false), 3000)
  }

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!projTitle.trim()) return
    setCreatingProj(true)

    await supabase.from('projects').insert([{
      client_id: id,
      title: projTitle.trim(),
      description: projDescription.trim(),
      priority: projPriority,
      status: projStatus,
      deadline: projDeadline || null,
      clients: { company: client?.company || '' }
    }])

    setCreatingProj(false)
    setProjDrawerOpen(false)
    setProjTitle('')
    setProjDescription('')
    setProjDeadline('')
    fetchAll()
  }

  const handleLogComm = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!commBody.trim()) return
    setSavingComm(true)

    await supabase.from('communications').insert([{
      client_id: id,
      channel: commChannel,
      direction: commDirection,
      body: commBody.trim(),
    }])

    setSavingComm(false)
    setCommDrawerOpen(false)
    setCommBody('')
    fetchAll()
  }

  const statusClass = (s: string) => {
    const m: Record<string, string> = { todo: 'badge-default', in_progress: 'badge-blue', review: 'badge-yellow', delivered: 'badge-green' }
    return `badge ${m[s] || 'badge-default'}`
  }

  const clientStatusClass = (s: string) => {
    const m: Record<string, string> = { active: 'badge-green', lead: 'badge-yellow', past: 'badge-default' }
    return `badge ${m[s] || 'badge-default'}`
  }

  if (loading) return (
    <>
      <div className="page-header"><div className="page-title">Loading…</div></div>
      <div className="page-body"><div className="skeleton" style={{ height: 200 }} /></div>
    </>
  )

  if (!client) return (
    <>
      <div className="page-header"><div className="page-title">Client not found</div></div>
      <div className="page-body"><Link href="/clients" className="btn btn-default">← Back to clients</Link></div>
    </>
  )

  return (
    <>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link href="/clients" className="btn btn-ghost btn-sm" style={{ padding: '4px 8px' }}>← Back</Link>
          <div>
            <div className="page-title">{client.company}</div>
            <div className="page-subtitle">{client.contact_email || 'No email associated'}</div>
          </div>
        </div>
        <div className="page-actions">
          <span className={clientStatusClass(client.status)}>
            <span className="badge-dot" />{client.status}
          </span>
          <button onClick={() => setProjDrawerOpen(true)} className="btn btn-primary btn-sm">
            + New Project
          </button>
        </div>
      </div>

      <div className="page-body fade-in">
        {/* Quick info cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
          {[
            { label: 'Primary Contact', value: client.contact_name || '—' },
            { label: 'Active Projects', value: projects.length },
            { label: 'Monthly Retainer', value: client.monthly_value ? `$${client.monthly_value} ${client.currency || 'USD'}` : '—' },
            { label: 'Client Since', value: new Date(client.created_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) },
          ].map(s => (
            <div key={s.label} className="card card-body" style={{ padding: '14px 16px' }}>
              <div className="text-xs text-subtle" style={{ marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontWeight: 600 }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="tabs">
          {(['projects', 'comms', 'notes'] as const).map(t => (
            <button key={t} className={`tab-btn ${activeTab === t ? 'active' : ''}`} onClick={() => setActiveTab(t)}>
              {t === 'projects' ? `Projects (${projects.length})` : t === 'comms' ? `Communication (${comms.length})` : 'Notes & Scope'}
            </button>
          ))}
        </div>

        {/* Projects tab */}
        {activeTab === 'projects' && (
          <div className="card" style={{ padding: 0 }}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Status</th>
                    <th>Priority</th>
                    <th>Deadline</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.length === 0 ? (
                    <tr><td colSpan={5}>
                      <div className="empty-state">
                        <div className="empty-state-title">No projects yet</div>
                        <p>Click &quot;+ New Project&quot; above to add a project.</p>
                      </div>
                    </td></tr>
                  ) : projects.map(p => (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 500 }}>{p.title}</td>
                      <td><span className={statusClass(p.status)}><span className="badge-dot" />{p.status.replace('_', ' ')}</span></td>
                      <td><span className={`badge ${p.priority === 'urgent' ? 'badge-red' : p.priority === 'high' ? 'badge-yellow' : 'badge-default'}`}>{p.priority}</span></td>
                      <td className="text-sm font-mono text-subtle">{p.deadline ? new Date(p.deadline).toLocaleDateString() : '—'}</td>
                      <td className="text-sm font-mono text-subtle">{new Date(p.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Comms tab */}
        {activeTab === 'comms' && (
          <div className="card" style={{ padding: 0 }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="text-xs font-semibold text-subtle uppercase">History Log</span>
              <button onClick={() => setCommDrawerOpen(true)} className="btn btn-default btn-sm">
                + Log Interaction
              </button>
            </div>
            {comms.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-title">No communications logged</div>
                <p>Log emails, calls, or client feedback here.</p>
              </div>
            ) : comms.map(c => (
              <div key={c.id} style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)' }}>
                <div className="flex items-center justify-between" style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className={`badge ${c.direction === 'inbound' ? 'badge-blue' : c.direction === 'outbound' ? 'badge-green' : 'badge-default'}`}>
                      {c.direction === 'inbound' ? '↓ from client' : c.direction === 'outbound' ? '↑ to client' : '• note'}
                    </span>
                    <span className="text-xs text-subtle">via {c.channel}</span>
                  </div>
                  <span className="text-xs font-mono text-subtle">{new Date(c.created_at).toLocaleString()}</span>
                </div>
                {c.subject && <div style={{ fontWeight: 500, marginBottom: 4 }}>{c.subject}</div>}
                <p style={{ fontSize: '0.875rem', whiteSpace: 'pre-wrap' }}>{c.body}</p>
              </div>
            ))}
          </div>
        )}

        {/* Notes tab */}
        {activeTab === 'notes' && (
          <div className="card card-body">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <span className="text-sm font-medium" style={{ fontWeight: 600 }}>Contract &amp; Scope Details</span>
                <div className="text-xs text-subtle">Shared reference notes for team deliverables</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {savedNotesToast && <span style={{ color: 'var(--accent)', fontSize: '0.8rem', fontWeight: 600 }}>✓ Saved!</span>}
                <button onClick={saveNotes} disabled={savingNotes} className="btn btn-primary btn-sm">
                  {savingNotes ? 'Saving…' : 'Save Notes'}
                </button>
              </div>
            </div>
            <textarea
              className="form-textarea"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Add contract details, monthly retainer terms, design preferences, deliverables scope…"
              style={{ minHeight: 320 }}
            />
          </div>
        )}
      </div>

      {/* New Project Modal */}
      {projDrawerOpen && (
        <div className="drawer-overlay" onClick={() => setProjDrawerOpen(false)}>
          <div className="drawer-panel" onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <div className="drawer-title">Add Project for {client.company}</div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setProjDrawerOpen(false)}>×</button>
            </div>
            <form onSubmit={handleCreateProject} className="drawer-body">
              <div className="form-group">
                <label className="form-label">Project Title</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Q4 Brand Refresh"
                  value={projTitle}
                  onChange={e => setProjTitle(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label className="form-label">Scope Description</label>
                <textarea
                  className="form-textarea"
                  placeholder="Deliverables, target formats, asset specs..."
                  value={projDescription}
                  onChange={e => setProjDescription(e.target.value)}
                  rows={3}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">Status</label>
                  <select className="form-input" value={projStatus} onChange={e => setProjStatus(e.target.value)}>
                    <option value="todo">To Do</option>
                    <option value="in_progress">In Progress</option>
                    <option value="review">Review</option>
                    <option value="delivered">Delivered</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Priority</label>
                  <select className="form-input" value={projPriority} onChange={e => setProjPriority(e.target.value)}>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Deadline</label>
                <input
                  type="date"
                  className="form-input"
                  value={projDeadline}
                  onChange={e => setProjDeadline(e.target.value)}
                />
              </div>
              <div className="drawer-footer" style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button type="button" className="btn btn-default" onClick={() => setProjDrawerOpen(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={creatingProj || !projTitle.trim()}>
                  {creatingProj ? 'Saving…' : 'Create Project'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Log Interaction Modal */}
      {commDrawerOpen && (
        <div className="drawer-overlay" onClick={() => setCommDrawerOpen(false)}>
          <div className="drawer-panel" onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <div className="drawer-title">Log Communication</div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCommDrawerOpen(false)}>×</button>
            </div>
            <form onSubmit={handleLogComm} className="drawer-body">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">Channel</label>
                  <select className="form-input" value={commChannel} onChange={e => setCommChannel(e.target.value)}>
                    <option value="email">Email</option>
                    <option value="portal">Portal</option>
                    <option value="call">Call / Meet</option>
                    <option value="slack">Slack</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Direction</label>
                  <select className="form-input" value={commDirection} onChange={e => setCommDirection(e.target.value)}>
                    <option value="outbound">Outbound (To Client)</option>
                    <option value="inbound">Inbound (From Client)</option>
                    <option value="internal">Internal Note</option>
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Notes / Message</label>
                <textarea
                  className="form-textarea"
                  placeholder="Summary of conversation or update sent..."
                  value={commBody}
                  onChange={e => setCommBody(e.target.value)}
                  rows={4}
                  required
                  autoFocus
                />
              </div>
              <div className="drawer-footer" style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button type="button" className="btn btn-default" onClick={() => setCommDrawerOpen(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={savingComm || !commBody.trim()}>
                  {savingComm ? 'Saving…' : 'Log Communication'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
