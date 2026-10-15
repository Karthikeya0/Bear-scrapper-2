'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function ClientPortalDashboard() {
  const [client, setClient] = useState<any>(null)
  const [projects, setProjects] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [sentMsg, setSentMsg] = useState(false)

  const supabase = createClient()

  useEffect(() => {
    const fetchPortalData = async () => {
      setLoading(true)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: clientData } = await supabase
        .from('clients')
        .select('*')
        .eq('portal_user_id', user.id)
        .single()

      if (clientData) {
        setClient(clientData)
        const { data: projectData } = await supabase
          .from('projects')
          .select('*')
          .eq('client_id', clientData.id)
          .order('created_at', { ascending: false })
        setProjects(projectData || [])
      }
      setLoading(false)
    }
    fetchPortalData()
  }, [])

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!client || !message) return
    
    setSending(true)
    const { data: { user } } = await supabase.auth.getUser()
    
    await supabase.from('communications').insert([{
      client_id: client.id,
      author_id: user?.id,
      direction: 'inbound',
      channel: 'portal',
      body: message
    }])
    
    setSending(false)
    setMessage('')
    setSentMsg(true)
    setTimeout(() => setSentMsg(false), 3000)
  }

  if (loading) return <div className="section-dark hero-full"><div className="skeleton" style={{ height: '60px', width: '50%' }}/></div>
  if (!client) return (
    <div className="section-dark hero-full" style={{ textAlign: 'center' }}>
      <h1>NO ACCOUNT LINKED</h1>
      <p className="text-muted">Please contact Bear Studios to link your account to a client profile.</p>
    </div>
  )

  const activeProject = projects.find(p => ['todo', 'in_progress', 'review'].includes(p.status)) || projects[0]

  return (
    <div style={{ flex: 1 }}>
      {/* 1. Welcome Hero */}
      <section className="section-dark hero-full" style={{ minHeight: '50vh', justifyContent: 'flex-end', paddingBottom: '4rem' }}>
        <div className="fade-in">
          <span className="micro-label">CLIENT PORTAL</span>
          <h1 style={{ fontSize: 'clamp(3rem, 8vw, 6rem)', marginBottom: '1rem', wordBreak: 'break-word', lineHeight: 1.1 }}>
            WELCOME BACK,<br/>{client.contact_name || client.company}
          </h1>
        </div>
      </section>

      {/* 2. Project Status */}
      <section className="section-white border-line" style={{ borderTopWidth: '1px', borderTopStyle: 'solid' }}>
        <div className="fade-in">
          <span className="micro-label" style={{ color: 'var(--text-on-light)' }}>CURRENT STATUS</span>
          
          {activeProject ? (
            <div style={{ marginTop: '2rem' }}>
              <h2 style={{ fontSize: '3rem', marginBottom: '1rem' }}>{activeProject.title}</h2>
              <div style={{ display: 'flex', gap: '3rem', flexWrap: 'wrap' }}>
                <div>
                  <div className="data-font text-muted" style={{ fontSize: '0.75rem', marginBottom: '0.25rem' }}>STAGE</div>
                  <div className="data-font" style={{ textTransform: 'uppercase', fontSize: '1.25rem' }}>
                    <span className={`status-dot status-${activeProject.status === 'delivered' ? 'active' : activeProject.status === 'review' ? 'review' : 'inprogress'}`}></span>
                    {activeProject.status.replace('_', ' ')}
                  </div>
                </div>
                {activeProject.deadline && (
                  <div>
                    <div className="data-font text-muted" style={{ fontSize: '0.75rem', marginBottom: '0.25rem' }}>TARGET DEADLINE</div>
                    <div className="data-font" style={{ fontSize: '1.25rem' }}>
                      {new Date(activeProject.deadline).toLocaleDateString()}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="text-muted" style={{ marginTop: '2rem' }}>No active projects at this time.</div>
          )}
        </div>
      </section>

      {/* 3. Deliverables */}
      <section className="section-dark border-line" style={{ borderTopWidth: '1px', borderTopStyle: 'solid' }}>
        <div className="fade-in">
          <span className="micro-label">DELIVERABLES</span>
          <div className="empty-state" style={{ border: '1px dashed var(--border-light)', padding: '3rem', textAlign: 'center', marginTop: '2rem' }}>
            <p className="text-muted">No files ready for download yet.</p>
          </div>
        </div>
      </section>

      {/* 4. Message Us */}
      <section className="section-light border-line" style={{ borderTopWidth: '1px', borderTopStyle: 'solid' }}>
        <div className="fade-in" style={{ maxWidth: '600px' }}>
          <span className="micro-label" style={{ color: 'var(--text-on-light)' }}>MESSAGE BEAR STUDIOS</span>
          
          {sentMsg ? (
            <div style={{ padding: '2rem', background: 'var(--bg-white)', border: '1px solid var(--status-positive)', color: 'var(--status-positive)', marginTop: '2rem' }}>
              <div className="data-font" style={{ fontWeight: 600 }}>MESSAGE SENT SUCCESSFULLY</div>
            </div>
          ) : (
            <form onSubmit={sendMessage} style={{ marginTop: '2rem' }}>
              <textarea 
                className="form-textarea" 
                required
                value={message} 
                onChange={e => setMessage(e.target.value)}
                placeholder="Request revisions, ask a question, or share an update..."
                style={{ background: 'var(--bg-white)', padding: '1.5rem', border: '1px solid var(--border-dark)' }}
              />
              <button type="submit" className="btn btn-primary" disabled={sending || !message} style={{ marginTop: '1rem' }}>
                {sending ? 'SENDING...' : 'SEND MESSAGE →'}
              </button>
            </form>
          )}
        </div>
      </section>
    </div>
  )
}
