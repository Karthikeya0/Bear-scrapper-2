'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

export default function ClientsPage() {
  const [clients, setClients] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [company, setCompany] = useState('')
  const [contactName, setContactName] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [status, setStatus] = useState('lead')
  const [saving, setSaving] = useState(false)

  const supabase = createClient()

  const fetchClients = async () => {
    setLoading(true)
    let query = supabase.from('clients').select('*')
    if (search) query = query.ilike('company', `%${search}%`)
    const { data } = await query.order('created_at', { ascending: false })
    setClients(data || [])
    setLoading(false)
  }

  useEffect(() => { fetchClients() }, [search])

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    await supabase.from('clients').insert([{ company, contact_name: contactName, contact_email: contactEmail, status }])
    setSaving(false)
    setDrawerOpen(false)
    setCompany(''); setContactName(''); setContactEmail(''); setStatus('lead')
    fetchClients()
  }

  const statusClass = (s: string) => {
    const m: Record<string, string> = { active: 'badge-green', lead: 'badge-yellow', past: 'badge-default' }
    return `badge ${m[s] || 'badge-default'}`
  }

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Clients</div>
          <div className="page-subtitle">{clients.length} total</div>
        </div>
        <div className="page-actions">
          <button onClick={() => setDrawerOpen(true)} className="btn btn-primary btn-sm">+ New Client</button>
        </div>
      </div>

      <div className="page-body fade-in">
        {/* Search */}
        <div className="toolbar">
          <input
            className="search-input"
            placeholder="Search clients…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* Table */}
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Contact</th>
                  <th>Email</th>
                  <th>Status</th>
                  <th>Added</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6}><div className="skeleton" style={{ height: 40 }} /></td></tr>
                ) : clients.length === 0 ? (
                  <tr><td colSpan={6}>
                    <div className="empty-state">
                      <div className="empty-state-icon">👥</div>
                      <div className="empty-state-title">No clients yet</div>
                      <p>Add your first client to get started.</p>
                    </div>
                  </td></tr>
                ) : clients.map(c => (
                  <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => window.location.href = `/clients/${c.id}`}>
                    <td style={{ fontWeight: 500 }}>{c.company}</td>
                    <td className="text-sm text-muted">{c.contact_name || '—'}</td>
                    <td className="text-sm font-mono text-muted">{c.contact_email || '—'}</td>
                    <td>
                      <span className={statusClass(c.status)}>
                        <span className="badge-dot" />
                        {c.status}
                      </span>
                    </td>
                    <td className="text-sm text-subtle font-mono">{new Date(c.created_at).toLocaleDateString()}</td>
                    <td style={{ textAlign: 'right' }}>
                      <Link href={`/clients/${c.id}`} className="btn btn-ghost btn-sm" onClick={e => e.stopPropagation()}>View →</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Drawer overlay */}
      {drawerOpen && <div className="drawer-overlay" onClick={() => setDrawerOpen(false)} />}

      {/* Add client drawer */}
      <div className={`drawer ${drawerOpen ? 'open' : ''}`}>
        <div className="drawer-header">
          <span className="drawer-title">New Client</span>
          <button className="btn btn-ghost btn-icon" onClick={() => setDrawerOpen(false)}>✕</button>
        </div>
        <div className="drawer-body">
          <form onSubmit={handleAdd}>
            <div className="form-group">
              <label className="form-label">Company name *</label>
              <input className="form-input" required value={company} onChange={e => setCompany(e.target.value)} placeholder="Acme Inc." />
            </div>
            <div className="form-group">
              <label className="form-label">Contact name</label>
              <input className="form-input" value={contactName} onChange={e => setContactName(e.target.value)} placeholder="Jane Smith" />
            </div>
            <div className="form-group">
              <label className="form-label">Contact email</label>
              <input type="email" className="form-input" value={contactEmail} onChange={e => setContactEmail(e.target.value)} placeholder="jane@acme.com" />
            </div>
            <div className="form-group">
              <label className="form-label">Status</label>
              <select className="form-select" value={status} onChange={e => setStatus(e.target.value)}>
                <option value="lead">Lead</option>
                <option value="active">Active</option>
                <option value="past">Past</option>
              </select>
            </div>
            <div className="divider" />
            <button type="submit" className="btn btn-primary w-full" disabled={saving || !company}>
              {saving ? 'Saving…' : 'Create Client'}
            </button>
          </form>
        </div>
      </div>
    </>
  )
}
