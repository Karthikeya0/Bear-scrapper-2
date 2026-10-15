'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'

type Settings = {
  icp_filter: {
    min_score: number
    sources: string[]
    exclude_domains: string[]
    keywords_include: string[]
    keywords_exclude: string[]
  }
  sending_limits: {
    daily_max: number
    hourly_max: number
    min_gap_minutes: number
    send_window_start_hour: number
    send_window_end_hour: number
    send_on_weekends: boolean
    follow_up_days: number[]
  }
}

type Template = {
  id: string
  key: string
  name: string
  subject_template: string
  body_template: string
  active: boolean
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState<'icp' | 'sending' | 'templates'>('icp')
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null)
  const [saved, setSaved] = useState(false)

  const supabase = useMemo(() => createClient(), [])

  const fetchData = useCallback(async () => {
    setLoading(true)
    const { data: settingsData } = await supabase.from('settings').select('*')
    if (settingsData) {
      const s: Partial<Settings> = {}
      for (const row of settingsData) {
        s[row.key as keyof Settings] = row.value
      }
      setSettings(s as Settings)
    }

    const { data: tmpl } = await supabase.from('email_templates').select('*').order('created_at')
    setTemplates((tmpl as Template[]) || [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  async function saveSettings() {
    if (!settings) return
    setSaving(true)
    await Promise.all([
      supabase.from('settings').upsert({ key: 'icp_filter', value: settings.icp_filter }),
      supabase.from('settings').upsert({ key: 'sending_limits', value: settings.sending_limits }),
    ])
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    setSaving(false)
  }

  async function saveTemplate() {
    if (!editingTemplate) return
    setSaving(true)
    await supabase.from('email_templates')
      .update({
        subject_template: editingTemplate.subject_template,
        body_template: editingTemplate.body_template,
        name: editingTemplate.name,
        active: editingTemplate.active,
      })
      .eq('id', editingTemplate.id)
    setSaving(false)
    setEditingTemplate(null)
    fetchData()
  }

  function updateICP<K extends keyof Settings['icp_filter']>(key: K, value: Settings['icp_filter'][K]) {
    setSettings(prev => prev ? { ...prev, icp_filter: { ...prev.icp_filter, [key]: value } } : prev)
  }

  function updateSending<K extends keyof Settings['sending_limits']>(key: K, value: Settings['sending_limits'][K]) {
    setSettings(prev => prev ? { ...prev, sending_limits: { ...prev.sending_limits, [key]: value } } : prev)
  }

  if (loading) return <div className="skeleton" style={{ height: 400, borderRadius: 'var(--radius)' }} />

  const TABS = [
    { key: 'icp' as const, label: '🎯 ICP Filter' },
    { key: 'sending' as const, label: '📧 Sending Limits' },
    { key: 'templates' as const, label: '✉ Email Templates' },
  ]

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Configure filters, sending limits, and email templates</p>
        </div>
        {activeTab !== 'templates' && (
          <button
            className="btn btn-primary btn-sm"
            onClick={saveSettings}
            disabled={saving}
          >
            {saved ? '✓ Saved!' : saving ? 'Saving…' : 'Save Changes'}
          </button>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', borderBottom: '1px solid var(--border-soft)' }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{
              padding: '0.625rem 1rem', fontSize: '0.875rem', fontWeight: 600,
              background: 'none', border: 'none', cursor: 'pointer',
              color: activeTab === t.key ? 'var(--accent-light)' : 'var(--text-muted)',
              borderBottom: activeTab === t.key ? '2px solid var(--accent)' : '2px solid transparent',
              transition: 'all 0.15s',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ICP Filter Tab */}
      {activeTab === 'icp' && settings && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: 640 }}>
          <div className="card">
            <h3 style={{ marginBottom: '1.25rem' }}>Scoring Threshold</h3>
            <div className="form-group">
              <label className="form-label">Minimum AI Score for Outreach (0–100)</label>
              <input
                type="number" min={0} max={100}
                className="form-input"
                value={settings.icp_filter.min_score}
                onChange={e => updateICP('min_score', Number(e.target.value))}
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                Leads with score below this are disqualified. Recommended: 60
              </span>
            </div>
          </div>

          <div className="card">
            <h3 style={{ marginBottom: '1.25rem' }}>Active Sources</h3>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              {['reddit', 'producthunt', 'twitter', 'yc', 'linkedin'].map(src => {
                const active = settings.icp_filter.sources.includes(src)
                return (
                  <button
                    key={src}
                    onClick={() => updateICP('sources',
                      active
                        ? settings.icp_filter.sources.filter(s => s !== src)
                        : [...settings.icp_filter.sources, src]
                    )}
                    className={`btn btn-sm ${active ? 'btn-primary' : 'btn-ghost'}`}
                    style={{ textTransform: 'capitalize' }}
                  >
                    {active ? '✓ ' : ''}{src}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="card">
            <h3 style={{ marginBottom: '1.25rem' }}>Keyword Filters</h3>
            <div className="form-group">
              <label className="form-label">Include keywords (comma-separated)</label>
              <input
                className="form-input"
                value={settings.icp_filter.keywords_include.join(', ')}
                onChange={e => updateICP('keywords_include', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                placeholder="saas, startup, founder, launch"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Exclude keywords (comma-separated)</label>
              <input
                className="form-input"
                value={settings.icp_filter.keywords_exclude.join(', ')}
                onChange={e => updateICP('keywords_exclude', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                placeholder="hiring, job, agency"
              />
            </div>
          </div>
        </div>
      )}

      {/* Sending Limits Tab */}
      {activeTab === 'sending' && settings && (
        <div style={{ maxWidth: 640, display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div className="card">
            <h3 style={{ marginBottom: '1.25rem' }}>Rate Limits</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Daily max emails</label>
                <input type="number" min={1} max={50} className="form-input"
                  value={settings.sending_limits.daily_max}
                  onChange={e => updateSending('daily_max', Number(e.target.value))} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Hourly max emails</label>
                <input type="number" min={1} max={10} className="form-input"
                  value={settings.sending_limits.hourly_max}
                  onChange={e => updateSending('hourly_max', Number(e.target.value))} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Min gap between sends (min)</label>
                <input type="number" min={1} max={60} className="form-input"
                  value={settings.sending_limits.min_gap_minutes}
                  onChange={e => updateSending('min_gap_minutes', Number(e.target.value))} />
              </div>
            </div>
          </div>

          <div className="card">
            <h3 style={{ marginBottom: '1.25rem' }}>Send Window</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Start hour (0–23)</label>
                <input type="number" min={0} max={23} className="form-input"
                  value={settings.sending_limits.send_window_start_hour}
                  onChange={e => updateSending('send_window_start_hour', Number(e.target.value))} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">End hour (0–23)</label>
                <input type="number" min={0} max={23} className="form-input"
                  value={settings.sending_limits.send_window_end_hour}
                  onChange={e => updateSending('send_window_end_hour', Number(e.target.value))} />
              </div>
            </div>
            <div style={{ marginTop: '1rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', cursor: 'pointer', fontSize: '0.875rem' }}>
                <input
                  type="checkbox"
                  checked={settings.sending_limits.send_on_weekends}
                  onChange={e => updateSending('send_on_weekends', e.target.checked)}
                  style={{ width: 16, height: 16, accentColor: 'var(--accent)' }}
                />
                <span>Allow sending on weekends</span>
              </label>
            </div>
          </div>

          <div className="card">
            <h3 style={{ marginBottom: '1.25rem' }}>Follow-up Schedule</h3>
            <div className="form-group">
              <label className="form-label">Follow-up days (comma-separated, e.g. 7, 14, 21)</label>
              <input
                className="form-input"
                value={settings.sending_limits.follow_up_days.join(', ')}
                onChange={e => updateSending('follow_up_days', e.target.value.split(',').map(s => Number(s.trim())).filter(Boolean))}
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                Days after initial email to send follow-ups. Max 3 follow-ups recommended.
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Templates Tab */}
      {activeTab === 'templates' && (
        <div style={{ display: 'grid', gridTemplateColumns: editingTemplate ? '280px 1fr' : '1fr', gap: '1.5rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {templates.map(t => (
              <div
                key={t.id}
                className="card card-hover"
                onClick={() => setEditingTemplate({ ...t })}
                style={{
                  cursor: 'pointer',
                  borderColor: editingTemplate?.id === t.id ? 'var(--accent)' : undefined,
                }}
              >
                <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.25rem' }}>{t.name}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{t.key}</div>
              </div>
            ))}
          </div>

          {editingTemplate && (
            <div className="card fade-in">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                <h3>{editingTemplate.name}</h3>
                <button className="btn btn-ghost btn-sm" onClick={() => setEditingTemplate(null)}>✕</button>
              </div>

              <div className="form-group">
                <label className="form-label">Template Name</label>
                <input className="form-input" value={editingTemplate.name}
                  onChange={e => setEditingTemplate(prev => prev ? { ...prev, name: e.target.value } : prev)} />
              </div>
              <div className="form-group">
                <label className="form-label">Subject Template</label>
                <input className="form-input" value={editingTemplate.subject_template}
                  onChange={e => setEditingTemplate(prev => prev ? { ...prev, subject_template: e.target.value } : prev)} />
              </div>
              <div className="form-group">
                <label className="form-label">Body Template</label>
                <textarea className="form-textarea" value={editingTemplate.body_template} style={{ minHeight: 260, fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}
                  onChange={e => setEditingTemplate(prev => prev ? { ...prev, body_template: e.target.value } : prev)} />
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                <button className="btn btn-primary btn-sm" onClick={saveTemplate} disabled={saving}>
                  {saving ? 'Saving…' : 'Save Template'}
                </button>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={editingTemplate.active}
                    onChange={e => setEditingTemplate(prev => prev ? { ...prev, active: e.target.checked } : prev)}
                    style={{ accentColor: 'var(--accent)' }} />
                  Active
                </label>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}
