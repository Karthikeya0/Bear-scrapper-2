'use client'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/Toast'
import { Alert, Badge, Drawer, EmptyState, PageHeader, Spinner, StatusBadge } from '@/components/ui'
import { IconArrowLeft, IconExternal, IconFile, IconKanban, IconMessage, IconPlus } from '@/components/icons'
import { formatDate, formatDateTime, formatDay, formatMoney, humanize, isOverdue } from '@/lib/format'

type Client = {
  id: string; company: string; contact_name: string | null; contact_email: string | null; status: string
  monthly_value: number | null; currency: string | null; contract_notes: string | null; portal_user_id: string | null; created_at: string
}
type Project = { id: string; title: string; description: string | null; status: string; priority: string; deadline: string | null; created_at: string }
type Comm = { id: string; channel: string; direction: string; subject: string | null; body: string; created_at: string }
type Deliverable = { id: string; title: string; file_url: string; status: string; notes: string | null; project_id: string | null; created_at: string }
type Tab = 'projects' | 'deliverables' | 'comms' | 'notes'

const PROJECT_EMPTY = { id: '', title: '', description: '', status: 'todo', priority: 'medium', deadline: '' }
const COMM_EMPTY = { channel: 'email', direction: 'outbound', subject: '', body: '' }
const DELIV_EMPTY = { title: '', file_url: '', project_id: '', notes: '' }

function safeUrl(value: string) {
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null
  } catch {
    return null
  }
}

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>()
  const supabase = useMemo(() => createClient(), [])
  const toast = useToast()

  const [client, setClient] = useState<Client | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [comms, setComms] = useState<Comm[]>([])
  const [deliverables, setDeliverables] = useState<Deliverable[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<Tab>('projects')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const [projectForm, setProjectForm] = useState<typeof PROJECT_EMPTY | null>(null)
  const [commForm, setCommForm] = useState<typeof COMM_EMPTY | null>(null)
  const [delivForm, setDelivForm] = useState<typeof DELIV_EMPTY | null>(null)
  const [clientForm, setClientForm] = useState<Client | null>(null)

  const load = useCallback(async () => {
    const [c, p, co, d] = await Promise.all([
      supabase.from('clients').select('*').eq('id', id).maybeSingle(),
      supabase.from('projects').select('*').eq('client_id', id).order('created_at', { ascending: false }),
      supabase.from('communications').select('*').eq('client_id', id).order('created_at', { ascending: false }),
      supabase.from('deliverables').select('*').eq('client_id', id).order('created_at', { ascending: false }),
    ])
    const firstError = [c, p, co, d].find(r => r.error)?.error
    setError(firstError?.message ?? '')
    setClient((c.data as Client) ?? null)
    setNotes((c.data as Client | null)?.contract_notes ?? '')
    setProjects((p.data ?? []) as Project[])
    setComms((co.data ?? []) as Comm[])
    setDeliverables((d.data ?? []) as Deliverable[])
    setLoading(false)
  }, [id, supabase])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load
    load()
  }, [load])

  async function run(op: PromiseLike<{ error: { message: string } | null }>, ok: string) {
    setSaving(true)
    const { error } = await op
    setSaving(false)
    if (error) {
      toast.error(error.message)
      return false
    }
    toast.success(ok)
    load()
    return true
  }

  async function saveProject(e: React.FormEvent) {
    e.preventDefault()
    if (!projectForm?.title.trim()) return
    const row = {
      client_id: id,
      title: projectForm.title.trim(),
      description: projectForm.description.trim() || null,
      status: projectForm.status,
      priority: projectForm.priority,
      deadline: projectForm.deadline || null,
    }
    const ok = await run(
      projectForm.id
        ? supabase.from('projects').update({ ...row, updated_at: new Date().toISOString() }).eq('id', projectForm.id)
        : supabase.from('projects').insert(row),
      projectForm.id ? 'Project updated.' : 'Project created.',
    )
    if (ok) setProjectForm(null)
  }

  async function saveComm(e: React.FormEvent) {
    e.preventDefault()
    if (!commForm?.body.trim()) return
    const { data: auth } = await supabase.auth.getUser()
    const ok = await run(
      supabase.from('communications').insert({
        client_id: id,
        author_id: auth.user?.id ?? null,
        channel: commForm.channel,
        direction: commForm.direction,
        subject: commForm.subject.trim() || null,
        body: commForm.body.trim(),
      }),
      'Interaction logged.',
    )
    if (ok) setCommForm(null)
  }

  async function saveDeliverable(e: React.FormEvent) {
    e.preventDefault()
    if (!delivForm) return
    if (!safeUrl(delivForm.file_url.trim())) {
      toast.error('Enter a valid http(s) link to the file (e.g. Google Drive, Frame.io, Dropbox).')
      return
    }
    const ok = await run(
      supabase.from('deliverables').insert({
        client_id: id,
        project_id: delivForm.project_id || null,
        title: delivForm.title.trim(),
        file_url: delivForm.file_url.trim(),
        notes: delivForm.notes.trim() || null,
        status: 'review',
      }),
      'Deliverable shared with the client portal.',
    )
    if (ok) setDelivForm(null)
  }

  async function saveClient(e: React.FormEvent) {
    e.preventDefault()
    if (!clientForm?.company.trim()) return
    const ok = await run(
      supabase
        .from('clients')
        .update({
          company: clientForm.company.trim(),
          contact_name: clientForm.contact_name?.trim() || null,
          contact_email: clientForm.contact_email?.trim() || null,
          status: clientForm.status,
          monthly_value: clientForm.monthly_value === null || String(clientForm.monthly_value) === '' ? null : Number(clientForm.monthly_value),
          currency: clientForm.currency || 'USD',
          updated_at: new Date().toISOString(),
        })
        .eq('id', id),
      'Client updated.',
    )
    if (ok) setClientForm(null)
  }

  const back = (
    <Link href="/clients" className="back-link"><IconArrowLeft width={14} height={14} /> Clients</Link>
  )

  if (loading) {
    return (
      <div className="stack">
        <div className="skeleton" style={{ height: 56, width: 320 }} />
        <div className="stats">{[0, 1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: 96, borderRadius: 14 }} />)}</div>
        <div className="skeleton" style={{ height: 280, borderRadius: 14 }} />
      </div>
    )
  }

  if (!client) {
    return (
      <>
        <PageHeader title="Client not found" back={back} />
        {error ? <Alert>{error}</Alert> : <div className="card"><EmptyState title="This client doesn't exist or was removed." /></div>}
      </>
    )
  }

  const openProjects = projects.filter(p => p.status !== 'delivered').length
  const TABS: { key: Tab; label: string; count?: number }[] = [
    { key: 'projects', label: 'Projects', count: projects.length },
    { key: 'deliverables', label: 'Deliverables', count: deliverables.length },
    { key: 'comms', label: 'Communication', count: comms.length },
    { key: 'notes', label: 'Notes & scope' },
  ]

  return (
    <>
      <PageHeader
        back={back}
        title={client.company}
        description={client.contact_email || 'No contact email'}
        actions={
          <>
            <StatusBadge status={client.status} />
            <button className="btn" onClick={() => setClientForm({ ...client })}>Edit</button>
            <button className="btn btn-primary" onClick={() => setProjectForm({ ...PROJECT_EMPTY })}><IconPlus className="icon" /> New project</button>
          </>
        }
      />

      {error && <Alert title="Some data could not be loaded">{error}</Alert>}

      <div className="stats">
        <div className="stat"><div className="stat-label">Primary contact</div><div style={{ fontWeight: 600, marginTop: 10 }}>{client.contact_name || '—'}</div></div>
        <div className="stat"><div className="stat-label">Open projects</div><div className="stat-value" style={{ marginTop: 10 }}>{openProjects}</div></div>
        <div className="stat"><div className="stat-label">Monthly value</div><div className="stat-value" style={{ marginTop: 10, fontSize: 24 }}>{formatMoney(client.monthly_value, client.currency ?? 'USD')}</div></div>
        <div className="stat">
          <div className="stat-label">Client portal</div>
          <div style={{ marginTop: 10 }}>{client.portal_user_id ? <Badge tone="green">Linked</Badge> : <Badge tone="amber">Not linked</Badge>}</div>
          <div className="stat-hint">Since {formatDate(client.created_at, { month: 'short', year: 'numeric' })}</div>
        </div>
      </div>

      <div className="tabs" role="tablist">
        {TABS.map(t => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
            {t.count !== undefined && <span className="tab-count">{t.count}</span>}
          </button>
        ))}
      </div>

      {tab === 'projects' && (
        <div className="card">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Project</th><th>Status</th><th>Priority</th><th className="t-right">Deadline</th></tr>
              </thead>
              <tbody>
                {projects.length === 0 ? (
                  <tr><td colSpan={4}>
                    <EmptyState icon={<IconKanban />} title="No projects yet" text="Create a project to track scope, deadlines and tasks."
                      action={<button className="btn btn-primary" onClick={() => setProjectForm({ ...PROJECT_EMPTY })}><IconPlus className="icon" /> New project</button>} />
                  </td></tr>
                ) : projects.map(p => (
                  <tr key={p.id} className="clickable" onClick={() => setProjectForm({ id: p.id, title: p.title, description: p.description ?? '', status: p.status, priority: p.priority, deadline: p.deadline ?? '' })}>
                    <td>
                      <div className="cell-title">{p.title}</div>
                      {p.description && <div className="cell-sub truncate" style={{ maxWidth: 420 }}>{p.description}</div>}
                    </td>
                    <td><StatusBadge status={p.status} /></td>
                    <td><StatusBadge status={p.priority} plain /></td>
                    <td className={`t-right num ${p.status !== 'delivered' && isOverdue(p.deadline) ? 'overdue' : 'subtle'}`}>{formatDay(p.deadline)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'deliverables' && (
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">Shared files</div>
              <div className="card-desc">Visible to the client in their portal, where they can approve or request revisions.</div>
            </div>
            <button className="btn btn-sm" onClick={() => setDelivForm({ ...DELIV_EMPTY })}><IconPlus className="icon" /> Share file</button>
          </div>
          {deliverables.length === 0 ? (
            <EmptyState icon={<IconFile />} title="Nothing shared yet" text="Share a link to a cut, deck or asset for client review." />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <tbody>
                  {deliverables.map(d => {
                    const url = safeUrl(d.file_url)
                    return (
                      <tr key={d.id}>
                        <td>
                          <div className="cell-title">{d.title}</div>
                          {d.notes && <div className="cell-sub">{d.notes}</div>}
                        </td>
                        <td><StatusBadge status={d.status} /></td>
                        <td className="subtle">{formatDate(d.created_at)}</td>
                        <td className="t-right">
                          {url && <a className="btn btn-sm btn-ghost" href={url} target="_blank" rel="noopener noreferrer">Open <IconExternal className="icon" /></a>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'comms' && (
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">Communication log</div>
              <div className="card-desc">Emails, calls, notes and portal messages.</div>
            </div>
            <button className="btn btn-sm" onClick={() => setCommForm({ ...COMM_EMPTY })}><IconPlus className="icon" /> Log interaction</button>
          </div>
          {comms.length === 0 ? (
            <EmptyState icon={<IconMessage />} title="No communication logged" text="Keep a record of every client touchpoint here." />
          ) : (
            <div className="card-pad timeline">
              {comms.map(c => (
                <div key={c.id} className="tl-item">
                  <div className="tl-dot"><IconMessage /></div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="row" style={{ flexWrap: 'wrap' }}>
                      <Badge tone={c.direction === 'inbound' ? 'blue' : c.direction === 'outbound' ? 'green' : 'gray'} plain>
                        {c.direction === 'inbound' ? 'From client' : c.direction === 'outbound' ? 'To client' : 'Internal'}
                      </Badge>
                      <span className="tag">{c.channel}</span>
                      <span className="tl-time">{formatDateTime(c.created_at)}</span>
                    </div>
                    {c.subject && <div className="tl-title" style={{ marginTop: 6 }}>{c.subject}</div>}
                    <p className="prose" style={{ marginTop: 4 }}>{c.body}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'notes' && (
        <div className="card card-pad" style={{ maxWidth: 860 }}>
          <div className="card-title">Contract & scope</div>
          <div className="card-desc" style={{ marginBottom: 12 }}>Retainer terms, deliverable scope and preferences. Internal only.</div>
          <textarea className="textarea" style={{ minHeight: 280 }} value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. 4 deliverables / month, bi-weekly review calls…" />
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}>
            <button className="btn btn-primary" disabled={saving || notes === (client.contract_notes ?? '')}
              onClick={() => run(supabase.from('clients').update({ contract_notes: notes, updated_at: new Date().toISOString() }).eq('id', id), 'Notes saved.')}>
              {saving && <Spinner />} Save notes
            </button>
          </div>
        </div>
      )}

      <Drawer open={!!projectForm} onClose={() => setProjectForm(null)} title={projectForm?.id ? 'Edit project' : 'New project'} description={client.company}
        footer={<>
          {projectForm?.id && (
            <button type="button" className="btn btn-danger" style={{ marginRight: 'auto' }} disabled={saving}
              onClick={async () => {
                if (!window.confirm(`Delete "${projectForm.title}" and its tasks?`)) return
                if (await run(supabase.from('projects').delete().eq('id', projectForm.id), 'Project deleted.')) setProjectForm(null)
              }}>Delete</button>
          )}
          <button type="button" className="btn" onClick={() => setProjectForm(null)}>Cancel</button>
          <button type="submit" form="project-form" className="btn btn-primary" disabled={saving || !projectForm?.title.trim()}>{saving && <Spinner />} Save project</button>
        </>}>
        {projectForm && (
          <form id="project-form" onSubmit={saveProject}>
            <div className="field">
              <label className="label" htmlFor="p-title">Title</label>
              <input id="p-title" className="input" required autoFocus value={projectForm.title} onChange={e => setProjectForm({ ...projectForm, title: e.target.value })} placeholder="Q4 brand refresh" />
            </div>
            <div className="field">
              <label className="label" htmlFor="p-desc">Scope</label>
              <textarea id="p-desc" className="textarea" rows={3} value={projectForm.description} onChange={e => setProjectForm({ ...projectForm, description: e.target.value })} placeholder="Deliverables, formats, specs…" />
            </div>
            <div className="form-grid">
              <div className="field">
                <label className="label" htmlFor="p-status">Status</label>
                <select id="p-status" className="select" value={projectForm.status} onChange={e => setProjectForm({ ...projectForm, status: e.target.value })}>
                  {['todo', 'in_progress', 'review', 'delivered'].map(s => <option key={s} value={s}>{humanize(s)}</option>)}
                </select>
              </div>
              <div className="field">
                <label className="label" htmlFor="p-priority">Priority</label>
                <select id="p-priority" className="select" value={projectForm.priority} onChange={e => setProjectForm({ ...projectForm, priority: e.target.value })}>
                  {['low', 'medium', 'high', 'urgent'].map(s => <option key={s} value={s}>{humanize(s)}</option>)}
                </select>
              </div>
            </div>
            <div className="field">
              <label className="label" htmlFor="p-deadline">Deadline</label>
              <input id="p-deadline" type="date" className="input" value={projectForm.deadline} onChange={e => setProjectForm({ ...projectForm, deadline: e.target.value })} />
            </div>
          </form>
        )}
      </Drawer>

      <Drawer open={!!commForm} onClose={() => setCommForm(null)} title="Log interaction" description={client.company}
        footer={<>
          <button type="button" className="btn" onClick={() => setCommForm(null)}>Cancel</button>
          <button type="submit" form="comm-form" className="btn btn-primary" disabled={saving || !commForm?.body.trim()}>{saving && <Spinner />} Save</button>
        </>}>
        {commForm && (
          <form id="comm-form" onSubmit={saveComm}>
            <div className="form-grid">
              <div className="field">
                <label className="label" htmlFor="m-channel">Channel</label>
                <select id="m-channel" className="select" value={commForm.channel} onChange={e => setCommForm({ ...commForm, channel: e.target.value })}>
                  <option value="email">Email</option><option value="call">Call / meeting</option><option value="slack">Slack</option>
                  <option value="portal">Portal</option><option value="note">Note</option>
                </select>
              </div>
              <div className="field">
                <label className="label" htmlFor="m-dir">Direction</label>
                <select id="m-dir" className="select" value={commForm.direction} onChange={e => setCommForm({ ...commForm, direction: e.target.value })}>
                  <option value="outbound">To client</option><option value="inbound">From client</option><option value="internal">Internal</option>
                </select>
              </div>
            </div>
            <div className="field">
              <label className="label" htmlFor="m-subject">Subject (optional)</label>
              <input id="m-subject" className="input" value={commForm.subject} onChange={e => setCommForm({ ...commForm, subject: e.target.value })} />
            </div>
            <div className="field">
              <label className="label" htmlFor="m-body">Summary</label>
              <textarea id="m-body" className="textarea" rows={5} required autoFocus value={commForm.body} onChange={e => setCommForm({ ...commForm, body: e.target.value })} />
            </div>
          </form>
        )}
      </Drawer>

      <Drawer open={!!delivForm} onClose={() => setDelivForm(null)} title="Share a deliverable" description="The client sees this in their portal."
        footer={<>
          <button type="button" className="btn" onClick={() => setDelivForm(null)}>Cancel</button>
          <button type="submit" form="deliv-form" className="btn btn-primary" disabled={saving || !delivForm?.title.trim() || !delivForm?.file_url.trim()}>{saving && <Spinner />} Share</button>
        </>}>
        {delivForm && (
          <form id="deliv-form" onSubmit={saveDeliverable}>
            <div className="field">
              <label className="label" htmlFor="d-title">Title</label>
              <input id="d-title" className="input" required autoFocus value={delivForm.title} onChange={e => setDelivForm({ ...delivForm, title: e.target.value })} placeholder="Hero video — cut v2" />
            </div>
            <div className="field">
              <label className="label" htmlFor="d-url">File link</label>
              <input id="d-url" type="url" className="input" required value={delivForm.file_url} onChange={e => setDelivForm({ ...delivForm, file_url: e.target.value })} placeholder="https://drive.google.com/…" />
            </div>
            <div className="field">
              <label className="label" htmlFor="d-project">Project</label>
              <select id="d-project" className="select" value={delivForm.project_id} onChange={e => setDelivForm({ ...delivForm, project_id: e.target.value })}>
                <option value="">—</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="label" htmlFor="d-notes">Notes for the client</label>
              <textarea id="d-notes" className="textarea" rows={3} value={delivForm.notes} onChange={e => setDelivForm({ ...delivForm, notes: e.target.value })} />
            </div>
          </form>
        )}
      </Drawer>

      <Drawer open={!!clientForm} onClose={() => setClientForm(null)} title="Edit client"
        footer={<>
          <button type="button" className="btn" onClick={() => setClientForm(null)}>Cancel</button>
          <button type="submit" form="edit-client-form" className="btn btn-primary" disabled={saving || !clientForm?.company.trim()}>{saving && <Spinner />} Save</button>
        </>}>
        {clientForm && (
          <form id="edit-client-form" onSubmit={saveClient}>
            <div className="field">
              <label className="label" htmlFor="e-company">Company</label>
              <input id="e-company" className="input" required value={clientForm.company} onChange={e => setClientForm({ ...clientForm, company: e.target.value })} />
            </div>
            <div className="form-grid">
              <div className="field">
                <label className="label" htmlFor="e-name">Contact name</label>
                <input id="e-name" className="input" value={clientForm.contact_name ?? ''} onChange={e => setClientForm({ ...clientForm, contact_name: e.target.value })} />
              </div>
              <div className="field">
                <label className="label" htmlFor="e-email">Contact email</label>
                <input id="e-email" type="email" className="input" value={clientForm.contact_email ?? ''} onChange={e => setClientForm({ ...clientForm, contact_email: e.target.value })} />
              </div>
              <div className="field">
                <label className="label" htmlFor="e-status">Status</label>
                <select id="e-status" className="select" value={clientForm.status} onChange={e => setClientForm({ ...clientForm, status: e.target.value })}>
                  <option value="lead">Lead</option><option value="active">Active</option><option value="past">Past</option>
                </select>
              </div>
              <div className="field">
                <label className="label" htmlFor="e-value">Monthly value</label>
                <input id="e-value" type="number" min={0} step="0.01" className="input" value={clientForm.monthly_value ?? ''}
                  onChange={e => setClientForm({ ...clientForm, monthly_value: e.target.value === '' ? null : Number(e.target.value) })} />
              </div>
            </div>
          </form>
        )}
      </Drawer>
    </>
  )
}
