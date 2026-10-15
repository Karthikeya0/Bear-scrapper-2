'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/Toast'
import { Alert, Drawer, EmptyState, PageHeader, SkeletonRows, Spinner, StatusBadge } from '@/components/ui'
import { IconPlus, IconSearch, IconUsers } from '@/components/icons'
import { formatDate, formatMoney } from '@/lib/format'

type Client = {
  id: string; company: string; contact_name: string | null; contact_email: string | null
  status: string; monthly_value: number | null; currency: string | null; created_at: string
}
const EMPTY = { company: '', contact_name: '', contact_email: '', status: 'lead', monthly_value: '', currency: 'USD' }

export default function ClientsPage() {
  const router = useRouter()
  const toast = useToast()
  const supabase = useMemo(() => createClient(), [])
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [form, setForm] = useState<typeof EMPTY | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.from('clients').select('*').order('created_at', { ascending: false })
    if (error) setError(error.message)
    else {
      setError('')
      setClients((data ?? []) as Client[])
    }
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load
    load()
  }, [load])

  const filtered = clients.filter(c => {
    if (status !== 'all' && c.status !== status) return false
    const q = search.trim().toLowerCase()
    return !q || [c.company, c.contact_name, c.contact_email].some(v => v?.toLowerCase().includes(q))
  })
  const active = clients.filter(c => c.status === 'active')
  const mrr = active.reduce((s, c) => s + (Number(c.monthly_value) || 0), 0)

  async function create(e: React.FormEvent) {
    e.preventDefault()
    if (!form?.company.trim()) return
    setSaving(true)
    const { data: auth } = await supabase.auth.getUser()
    const { data, error } = await supabase
      .from('clients')
      .insert({
        company: form.company.trim(),
        contact_name: form.contact_name.trim() || null,
        contact_email: form.contact_email.trim() || null,
        status: form.status,
        monthly_value: form.monthly_value === '' ? null : Number(form.monthly_value),
        currency: form.currency || 'USD',
        owner_id: auth.user?.id ?? null,
      })
      .select('id')
      .single()
    setSaving(false)
    if (error) return toast.error(`Could not create client: ${error.message}`)
    toast.success(`${form.company.trim()} added.`)
    setForm(null)
    router.push(`/clients/${data.id}`)
  }

  return (
    <>
      <PageHeader
        title="Clients"
        description={`${active.length} active · ${formatMoney(mrr)} monthly retained`}
        actions={<button className="btn btn-primary" onClick={() => setForm({ ...EMPTY })}><IconPlus className="icon" /> New client</button>}
      />

      <div className="toolbar">
        <div className="search">
          <IconSearch />
          <input className="input" placeholder="Search company or contact…" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search clients" />
        </div>
        <select className="select" value={status} onChange={e => setStatus(e.target.value)} aria-label="Status">
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="lead">Lead</option>
          <option value="past">Past</option>
        </select>
      </div>

      {error && <Alert title="Could not load clients">{error}</Alert>}

      <div className="card">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Contact</th>
                <th>Status</th>
                <th className="t-right">Monthly value</th>
                <th className="t-right">Added</th>
              </tr>
            </thead>
            <tbody>
              {loading && clients.length === 0 ? (
                <SkeletonRows rows={5} cols={5} />
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <EmptyState
                      icon={<IconUsers />}
                      title={clients.length ? 'No clients match' : 'No clients yet'}
                      text={clients.length ? 'Try a different search or filter.' : 'Add your first client to start tracking projects and deliverables.'}
                      action={!clients.length && <button className="btn btn-primary" onClick={() => setForm({ ...EMPTY })}><IconPlus className="icon" /> New client</button>}
                    />
                  </td>
                </tr>
              ) : (
                filtered.map(c => (
                  <tr key={c.id} className="clickable" onClick={() => router.push(`/clients/${c.id}`)}>
                    <td><Link href={`/clients/${c.id}`} className="cell-title" onClick={e => e.stopPropagation()}>{c.company}</Link></td>
                    <td>
                      <div>{c.contact_name || <span className="subtle">—</span>}</div>
                      {c.contact_email && <div className="cell-sub">{c.contact_email}</div>}
                    </td>
                    <td><StatusBadge status={c.status} /></td>
                    <td className="t-right num">{formatMoney(c.monthly_value, c.currency ?? 'USD')}</td>
                    <td className="t-right subtle num">{formatDate(c.created_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Drawer
        open={!!form}
        onClose={() => setForm(null)}
        title="New client"
        description="Add a company you work with or are pitching."
        footer={
          <>
            <button type="button" className="btn" onClick={() => setForm(null)}>Cancel</button>
            <button type="submit" form="client-form" className="btn btn-primary" disabled={saving || !form?.company.trim()}>
              {saving && <Spinner />} Create client
            </button>
          </>
        }
      >
        {form && (
          <form id="client-form" onSubmit={create}>
            <div className="field">
              <label className="label" htmlFor="c-company">Company name</label>
              <input id="c-company" className="input" required autoFocus value={form.company} onChange={e => setForm({ ...form, company: e.target.value })} placeholder="Acme Inc." />
            </div>
            <div className="form-grid">
              <div className="field">
                <label className="label" htmlFor="c-name">Contact name</label>
                <input id="c-name" className="input" value={form.contact_name} onChange={e => setForm({ ...form, contact_name: e.target.value })} placeholder="Jane Smith" />
              </div>
              <div className="field">
                <label className="label" htmlFor="c-email">Contact email</label>
                <input id="c-email" type="email" className="input" value={form.contact_email} onChange={e => setForm({ ...form, contact_email: e.target.value })} placeholder="jane@acme.com" />
              </div>
              <div className="field">
                <label className="label" htmlFor="c-status">Status</label>
                <select id="c-status" className="select" value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
                  <option value="lead">Lead</option>
                  <option value="active">Active</option>
                  <option value="past">Past</option>
                </select>
              </div>
              <div className="field">
                <label className="label" htmlFor="c-value">Monthly value</label>
                <input id="c-value" type="number" min={0} step="0.01" className="input" value={form.monthly_value} onChange={e => setForm({ ...form, monthly_value: e.target.value })} placeholder="0" />
              </div>
            </div>
          </form>
        )}
      </Drawer>
    </>
  )
}
