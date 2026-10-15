'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/Toast'
import { Alert, Drawer, PageHeader, Spinner, StatusBadge } from '@/components/ui'
import { IconChevronLeft, IconChevronRight, IconPlus, IconRefresh } from '@/components/icons'
import { formatDay, isOverdue } from '@/lib/format'

type Status = 'todo' | 'in_progress' | 'review' | 'delivered'
type Task = {
  id: string; title: string; status: Status; priority: string; deadline: string | null; project_id: string | null
  projects: { title: string; clients: { company: string } | null } | null
}
type Project = { id: string; title: string; clients: { company: string } | null }
type Form = { id?: string; title: string; project_id: string; priority: string; status: Status; deadline: string }

const COLUMNS: { id: Status; label: string; color: string }[] = [
  { id: 'todo', label: 'To do', color: 'var(--text-tertiary)' },
  { id: 'in_progress', label: 'In progress', color: 'var(--blue)' },
  { id: 'review', label: 'In review', color: 'var(--amber)' },
  { id: 'delivered', label: 'Delivered', color: 'var(--green)' },
]
const EMPTY_FORM: Form = { title: '', project_id: '', priority: 'medium', status: 'todo', deadline: '' }

export default function ProductionBoardPage() {
  const supabase = useMemo(() => createClient(), [])
  const toast = useToast()
  const [tasks, setTasks] = useState<Task[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)
  const [over, setOver] = useState<Status | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [t, p] = await Promise.all([
      supabase.from('tasks').select('id, title, status, priority, deadline, project_id, projects(title, clients(company))').order('created_at', { ascending: false }),
      supabase.from('projects').select('id, title, clients(company)').order('created_at', { ascending: false }),
    ])
    if (t.error || p.error) setError((t.error ?? p.error)!.message)
    else setError('')
    setTasks((t.data ?? []) as unknown as Task[])
    setProjects((p.data ?? []) as unknown as Project[])
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load
    load()
  }, [load])

  async function move(id: string, status: Status) {
    const prev = tasks.find(t => t.id === id)
    if (!prev || prev.status === status) return
    setTasks(ts => ts.map(t => (t.id === id ? { ...t, status } : t)))
    const { error } = await supabase.from('tasks').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) {
      setTasks(ts => ts.map(t => (t.id === id ? { ...t, status: prev.status } : t)))
      toast.error(`Could not move task: ${error.message}`)
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!form || !form.title.trim()) return
    setSaving(true)
    // Only real columns — nested relation objects are rejected by PostgREST.
    const row = {
      title: form.title.trim(),
      project_id: form.project_id || null,
      priority: form.priority,
      status: form.status,
      deadline: form.deadline || null,
    }
    const { error } = form.id
      ? await supabase.from('tasks').update({ ...row, updated_at: new Date().toISOString() }).eq('id', form.id)
      : await supabase.from('tasks').insert(row)
    setSaving(false)
    if (error) return toast.error(`Could not save task: ${error.message}`)
    toast.success(form.id ? 'Task updated.' : 'Task created.')
    setForm(null)
    load()
  }

  async function remove() {
    if (!form?.id || !window.confirm(`Delete "${form.title}"? This cannot be undone.`)) return
    setSaving(true)
    const { error } = await supabase.from('tasks').delete().eq('id', form.id)
    setSaving(false)
    if (error) return toast.error(`Could not delete task: ${error.message}`)
    toast.success('Task deleted.')
    setForm(null)
    load()
  }

  const active = tasks.filter(t => t.status !== 'delivered').length
  const overdue = tasks.filter(t => t.status !== 'delivered' && isOverdue(t.deadline)).length

  return (
    <>
      <PageHeader
        title="Production board"
        description={loading ? 'Loading tasks…' : `${active} active task${active === 1 ? '' : 's'}${overdue ? ` · ${overdue} overdue` : ''}`}
        actions={
          <>
            <button className="btn" onClick={load} disabled={loading}><IconRefresh className="icon" /> Refresh</button>
            <button className="btn btn-primary" onClick={() => setForm({ ...EMPTY_FORM, project_id: projects[0]?.id ?? '' })}>
              <IconPlus className="icon" /> New task
            </button>
          </>
        }
      />

      {error && <Alert title="Could not load the board">{error}</Alert>}

      <div className="kanban">
        {COLUMNS.map((col, colIdx) => {
          const colTasks = tasks.filter(t => t.status === col.id)
          return (
            <section
              key={col.id}
              className={`lane ${over === col.id ? 'over' : ''}`}
              onDragOver={e => { e.preventDefault(); setOver(col.id) }}
              onDragLeave={() => setOver(null)}
              onDrop={e => {
                e.preventDefault()
                setOver(null)
                if (dragId) move(dragId, col.id)
                setDragId(null)
              }}
              aria-label={col.label}
            >
              <div className="lane-head">
                <div className="lane-title"><span className="dot" style={{ background: col.color }} />{col.label}</div>
                <span className="lane-count">{colTasks.length}</span>
              </div>
              <div className="lane-body">
                {loading && tasks.length === 0 ? (
                  <div className="skeleton" style={{ height: 84, borderRadius: 10 }} />
                ) : colTasks.length === 0 ? (
                  <div className="lane-empty">Drop tasks here</div>
                ) : (
                  colTasks.map(task => (
                    <article
                      key={task.id}
                      className={`kcard p-${task.priority}`}
                      draggable
                      onDragStart={e => { setDragId(task.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', task.id) }}
                      onDragEnd={() => { setDragId(null); setOver(null) }}
                      style={{ opacity: dragId === task.id ? 0.45 : 1 }}
                      onClick={() => setForm({ id: task.id, title: task.title, project_id: task.project_id ?? '', priority: task.priority, status: task.status, deadline: task.deadline ?? '' })}
                    >
                      <div className="kcard-client">{task.projects?.clients?.company ?? task.projects?.title ?? 'Studio task'}</div>
                      <div className="kcard-title">{task.title}</div>
                      <div className="kcard-foot">
                        <span className={`hint ${task.status !== 'delivered' && isOverdue(task.deadline) ? 'overdue' : ''}`}>
                          {task.deadline ? formatDay(task.deadline) : 'No deadline'}
                        </span>
                        <div className="row" style={{ gap: 4 }}>
                          <StatusBadge status={task.priority} plain />
                          <div className="kcard-move" onClick={e => e.stopPropagation()}>
                            <button className="icon-btn" style={{ width: 24, height: 24 }} disabled={colIdx === 0} onClick={() => move(task.id, COLUMNS[colIdx - 1].id)} aria-label="Move left">
                              <IconChevronLeft width={14} height={14} />
                            </button>
                            <button className="icon-btn" style={{ width: 24, height: 24 }} disabled={colIdx === COLUMNS.length - 1} onClick={() => move(task.id, COLUMNS[colIdx + 1].id)} aria-label="Move right">
                              <IconChevronRight width={14} height={14} />
                            </button>
                          </div>
                        </div>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </section>
          )
        })}
      </div>

      <Drawer
        open={!!form}
        onClose={() => setForm(null)}
        title={form?.id ? 'Edit task' : 'New task'}
        description={form?.id ? undefined : 'Add a production task to the board.'}
        footer={
          <>
            {form?.id && (
              <button type="button" className="btn btn-danger" onClick={remove} disabled={saving} style={{ marginRight: 'auto' }}>Delete</button>
            )}
            <button type="button" className="btn" onClick={() => setForm(null)}>Cancel</button>
            <button type="submit" form="task-form" className="btn btn-primary" disabled={saving || !form?.title.trim()}>
              {saving && <Spinner />} {form?.id ? 'Save changes' : 'Create task'}
            </button>
          </>
        }
      >
        {form && (
          <form id="task-form" onSubmit={save}>
            <div className="field">
              <label className="label" htmlFor="t-title">Title</label>
              <input id="t-title" className="input" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="e.g. Cut 3 TikTok hook variants" required autoFocus />
            </div>
            <div className="field">
              <label className="label" htmlFor="t-project">Project</label>
              <select id="t-project" className="select" value={form.project_id} onChange={e => setForm({ ...form, project_id: e.target.value })}>
                <option value="">No project (studio task)</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.clients?.company ? `${p.clients.company} — ` : ''}{p.title}</option>
                ))}
              </select>
            </div>
            <div className="form-grid">
              <div className="field">
                <label className="label" htmlFor="t-status">Status</label>
                <select id="t-status" className="select" value={form.status} onChange={e => setForm({ ...form, status: e.target.value as Status })}>
                  {COLUMNS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </div>
              <div className="field">
                <label className="label" htmlFor="t-priority">Priority</label>
                <select id="t-priority" className="select" value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
            </div>
            <div className="field">
              <label className="label" htmlFor="t-deadline">Deadline</label>
              <input id="t-deadline" type="date" className="input" value={form.deadline} onChange={e => setForm({ ...form, deadline: e.target.value })} />
            </div>
          </form>
        )}
      </Drawer>
    </>
  )
}
