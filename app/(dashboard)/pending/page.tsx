'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const COLUMNS = [
  { id: 'todo', label: 'To Do', color: 'var(--text-tertiary)' },
  { id: 'in_progress', label: 'In Progress', color: 'var(--blue)' },
  { id: 'review', label: 'Review', color: 'var(--yellow)' },
  { id: 'delivered', label: 'Delivered', color: 'var(--green)' },
]

export default function PendingWorksPage() {
  const [tasks, setTasks] = useState<any[]>([])
  const [projects, setProjects] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dropOver, setDropOver] = useState<string | null>(null)
  
  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [taskTitle, setTaskTitle] = useState('')
  const [taskProjectId, setTaskProjectId] = useState('')
  const [taskPriority, setTaskPriority] = useState('medium')
  const [taskStatus, setTaskStatus] = useState('todo')
  const [taskDeadline, setTaskDeadline] = useState('')

  const supabase = createClient()

  const fetchTasks = async () => {
    setLoading(true)
    const [{ data: taskData }, { data: projData }] = await Promise.all([
      supabase.from('tasks').select('*, projects(title, clients(company))').order('created_at', { ascending: false }),
      supabase.from('projects').select('id, title, clients(company)').order('created_at', { ascending: false })
    ])
    setTasks(taskData || [])
    setProjects(projData || [])
    if (projData && projData.length > 0 && !taskProjectId) {
      setTaskProjectId(projData[0].id)
    }
    setLoading(false)
  }

  useEffect(() => { fetchTasks() }, [])

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedId(id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }

  const handleDragEnd = () => { setDraggedId(null); setDropOver(null) }

  const handleDrop = async (e: React.DragEvent, status: string) => {
    e.preventDefault()
    if (!draggedId) return
    setDropOver(null)
    setTasks(prev => prev.map(t => t.id === draggedId ? { ...t, status } : t))
    await supabase.from('tasks').update({ status }).eq('id', draggedId)
    setDraggedId(null)
  }

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!taskTitle.trim()) return
    setSaving(true)

    const selectedProj = projects.find(p => p.id === taskProjectId)
    const newTask = {
      title: taskTitle.trim(),
      project_id: taskProjectId || null,
      priority: taskPriority,
      status: taskStatus,
      deadline: taskDeadline || null,
      projects: selectedProj ? { title: selectedProj.title, clients: selectedProj.clients } : undefined
    }

    await supabase.from('tasks').insert([newTask])
    setSaving(false)
    setDrawerOpen(false)
    setTaskTitle('')
    setTaskDeadline('')
    fetchTasks()
  }

  const priorityClass = (p: string) => {
    const m: Record<string, string> = { urgent: 'priority-urgent', high: 'priority-high', medium: 'priority-medium', low: 'priority-low' }
    return m[p] || 'priority-medium'
  }

  const totalActive = tasks.filter(t => t.status !== 'delivered').length

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Pending Works</div>
          <div className="page-subtitle">{totalActive} active tasks across all studio projects</div>
        </div>
        <div className="page-actions">
          <button className="btn btn-ghost btn-sm" onClick={fetchTasks} title="Refresh board">
            ↻ Refresh
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => setDrawerOpen(true)}
            id="new-task-btn"
          >
            + New Task
          </button>
        </div>
      </div>

      <div className="page-body fade-in" style={{ overflowX: 'hidden' }}>
        <div className="kanban-board">
          {COLUMNS.map(col => {
            const colTasks = tasks.filter(t => t.status === col.id)
            return (
              <div
                key={col.id}
                className={`kanban-col ${dropOver === col.id ? 'drop-over' : ''}`}
                onDragOver={e => { e.preventDefault(); setDropOver(col.id) }}
                onDragLeave={() => setDropOver(null)}
                onDrop={e => handleDrop(e, col.id)}
              >
                {/* Column header */}
                <div className="kanban-col-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: col.color }} />
                    <span className="kanban-col-title">{col.label}</span>
                  </div>
                  <span className="kanban-col-count">{colTasks.length}</span>
                </div>

                {/* Tasks */}
                <div className="kanban-col-body">
                  {loading ? (
                    <div className="skeleton" style={{ height: 80, borderRadius: 6 }} />
                  ) : colTasks.length === 0 ? (
                    <div style={{ padding: '24px 0', textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                      No tasks in this lane
                    </div>
                  ) : colTasks.map(task => (
                    <div
                      key={task.id}
                      className={`kanban-card ${priorityClass(task.priority)}`}
                      draggable
                      onDragStart={e => handleDragStart(e, task.id)}
                      onDragEnd={handleDragEnd}
                      style={{ opacity: draggedId === task.id ? 0.4 : 1 }}
                    >
                      <div className="kanban-card-client">
                        {task.projects?.clients?.company || task.projects?.title || 'Bear Studios'}
                      </div>
                      <div className="kanban-card-title">{task.title}</div>
                      <div className="kanban-card-footer">
                        <span className="kanban-date">
                          {task.deadline ? new Date(task.deadline).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'No deadline'}
                        </span>
                        <span
                          className={`badge ${
                            task.priority === 'urgent'
                              ? 'badge-red'
                              : task.priority === 'high'
                              ? 'badge-yellow'
                              : 'badge-default'
                          }`}
                          style={{ fontSize: '0.62rem', padding: '1px 6px', textTransform: 'uppercase' }}
                        >
                          {task.priority}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* New Task Drawer / Modal */}
      {drawerOpen && (
        <div className="drawer-overlay" onClick={() => setDrawerOpen(false)}>
          <div className="drawer-panel" onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <div className="drawer-title">Create New Task</div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setDrawerOpen(false)}
                style={{ fontSize: '1.2rem', padding: '0 8px', lineHeight: 1 }}
              >
                ×
              </button>
            </div>

            <form onSubmit={handleCreateTask} className="drawer-body">
              <div className="form-group">
                <label className="form-label">Task Title</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Design 3x TikTok hook concepts"
                  value={taskTitle}
                  onChange={e => setTaskTitle(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label className="form-label">Associated Project</label>
                <select
                  className="form-input"
                  value={taskProjectId}
                  onChange={e => setTaskProjectId(e.target.value)}
                >
                  <option value="">No Project (General Studio Task)</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.clients?.company ? `${p.clients.company} — ` : ''}{p.title}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">Initial Status</label>
                  <select
                    className="form-input"
                    value={taskStatus}
                    onChange={e => setTaskStatus(e.target.value)}
                  >
                    <option value="todo">To Do</option>
                    <option value="in_progress">In Progress</option>
                    <option value="review">Review</option>
                    <option value="delivered">Delivered</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Priority</label>
                  <select
                    className="form-input"
                    value={taskPriority}
                    onChange={e => setTaskPriority(e.target.value)}
                  >
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
                  value={taskDeadline}
                  onChange={e => setTaskDeadline(e.target.value)}
                />
              </div>

              <div className="drawer-footer" style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button
                  type="button"
                  className="btn btn-default"
                  onClick={() => setDrawerOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={saving || !taskTitle.trim()}
                >
                  {saving ? 'Creating…' : 'Create Task'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
