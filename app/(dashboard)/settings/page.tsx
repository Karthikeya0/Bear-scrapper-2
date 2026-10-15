'use client'
import { useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/Toast'
import { Alert, Badge, EmptyState, PageHeader, Spinner } from '@/components/ui'
import { IconDatabase, IconFile, IconRefresh, IconWorkflow } from '@/components/icons'

type IcpFilter = { min_score: number; sources: string[]; exclude_domains: string[]; keywords_include: string[]; keywords_exclude: string[] }
type SendingLimits = {
  daily_max: number; hourly_max: number; min_gap_minutes: number
  send_window_start_hour: number; send_window_end_hour: number; send_on_weekends: boolean; follow_up_days: number[]
}
type Template = { id: string; key: string; name: string; subject_template: string; body_template: string; active: boolean }
type TabKey = 'icp' | 'sending' | 'templates' | 'integrations'
type Status = {
  supabase: { connected: boolean; error?: string }
  n8n: {
    baseUrlConfigured: boolean; secretConfigured: boolean; reachable: boolean; error?: string
    webhooks?: { workflow: string; path: string; state: 'ready' | 'missing' | 'wrong_method' | 'unknown'; detail?: string }[]
  }
}

// Same defaults as the seed in supabase/schema.sql — used only if a settings row is missing.
const DEFAULT_ICP: IcpFilter = {
  min_score: 60, sources: ['reddit', 'producthunt', 'yc'], exclude_domains: ['gmail.com', 'yahoo.com', 'hotmail.com'],
  keywords_include: [], keywords_exclude: [],
}
const DEFAULT_SENDING: SendingLimits = {
  daily_max: 25, hourly_max: 3, min_gap_minutes: 5, send_window_start_hour: 9, send_window_end_hour: 17,
  send_on_weekends: false, follow_up_days: [7, 14, 21],
}
const SOURCES = ['reddit', 'producthunt', 'yc', 'twitter', 'linkedin']
const TABS: { key: TabKey; label: string }[] = [
  { key: 'icp', label: 'Lead filter' },
  { key: 'sending', label: 'Sending limits' },
  { key: 'templates', label: 'Email templates' },
  { key: 'integrations', label: 'Integrations' },
]

const toList = (v: string) => v.split(',').map(s => s.trim()).filter(Boolean)
const clampInt = (v: string, min: number, max: number) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min
}

/** Comma-separated text input that only parses on blur, so typing commas/spaces isn't fought. */
function ListInput({ value, onChange, placeholder, id }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; id: string }) {
  const [text, setText] = useState(value.join(', '))
  return (
    <input
      id={id}
      className="input"
      value={text}
      placeholder={placeholder}
      onChange={e => setText(e.target.value)}
      onBlur={() => {
        const list = toList(text)
        onChange(list)
        setText(list.join(', '))
      }}
    />
  )
}

function SettingsInner() {
  const params = useSearchParams()
  const supabase = useMemo(() => createClient(), [])
  const toast = useToast()
  const [tab, setTab] = useState<TabKey>((TABS.find(t => t.key === params.get('tab'))?.key ?? 'icp') as TabKey)
  const [icp, setIcp] = useState<IcpFilter>(DEFAULT_ICP)
  const [sending, setSending] = useState<SendingLimits>(DEFAULT_SENDING)
  const [templates, setTemplates] = useState<Template[]>([])
  const [editing, setEditing] = useState<Template | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [status, setStatus] = useState<Status | null>(null)
  const [checking, setChecking] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [s, t] = await Promise.all([
      supabase.from('settings').select('key, value'),
      supabase.from('email_templates').select('*').order('created_at'),
    ])
    if (s.error || t.error) setLoadError((s.error ?? t.error)!.message)
    const rows = (s.data ?? []) as { key: string; value: unknown }[]
    const icpRow = rows.find(r => r.key === 'icp_filter')?.value as Partial<IcpFilter> | undefined
    const sendRow = rows.find(r => r.key === 'sending_limits')?.value as Partial<SendingLimits> | undefined
    setIcp({ ...DEFAULT_ICP, ...icpRow })
    setSending({ ...DEFAULT_SENDING, ...sendRow })
    setTemplates((t.data ?? []) as Template[])
    setDirty(false)
    setLoading(false)
  }, [supabase])

  const checkStatus = useCallback(async () => {
    setChecking(true)
    try {
      const res = await fetch('/api/integrations/status', { cache: 'no-store' })
      setStatus(res.ok ? await res.json() : null)
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load
    load()
  }, [load])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load status when tab opens
    if (tab === 'integrations' && !status) checkStatus()
  }, [tab, status, checkStatus])

  const patchIcp = (p: Partial<IcpFilter>) => { setIcp(prev => ({ ...prev, ...p })); setDirty(true) }
  const patchSending = (p: Partial<SendingLimits>) => { setSending(prev => ({ ...prev, ...p })); setDirty(true) }

  async function saveSettings() {
    if (sending.send_window_start_hour >= sending.send_window_end_hour) {
      toast.error('The send window must start before it ends.')
      return
    }
    if (sending.hourly_max > sending.daily_max) {
      toast.error('Hourly max cannot exceed the daily max.')
      return
    }
    setSaving(true)
    const now = new Date().toISOString()
    const { error } = await supabase.from('settings').upsert(
      [
        { key: 'icp_filter', value: icp, updated_at: now },
        { key: 'sending_limits', value: sending, updated_at: now },
      ],
      { onConflict: 'key' },
    )
    setSaving(false)
    if (error) return toast.error(`Could not save settings: ${error.message}`)
    setDirty(false)
    toast.success('Settings saved.')
  }

  async function saveTemplate() {
    if (!editing) return
    if (!editing.name.trim() || !editing.subject_template.trim() || !editing.body_template.trim()) {
      toast.error('Name, subject and body are all required.')
      return
    }
    setSaving(true)
    const { error } = await supabase
      .from('email_templates')
      .update({
        name: editing.name.trim(),
        subject_template: editing.subject_template,
        body_template: editing.body_template,
        active: editing.active,
      })
      .eq('id', editing.id)
    setSaving(false)
    if (error) return toast.error(`Could not save template: ${error.message}`)
    setTemplates(prev => prev.map(t => (t.id === editing.id ? editing : t)))
    toast.success('Template saved.')
  }

  const showSave = tab === 'icp' || tab === 'sending'

  return (
    <>
      <PageHeader
        title="Settings"
        description="Tune lead qualification, sending behaviour, templates and integrations."
        actions={
          showSave && (
            <button className="btn btn-primary" onClick={saveSettings} disabled={saving || !dirty || loading}>
              {saving && <Spinner />} {dirty ? 'Save changes' : 'Saved'}
            </button>
          )
        }
      />

      <div className="tabs" role="tablist">
        {TABS.map(t => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {loadError && <Alert title="Could not load settings">{loadError}</Alert>}

      {loading && tab !== 'integrations' ? (
        <div className="skeleton" style={{ height: 320, borderRadius: 14, maxWidth: 720 }} />
      ) : (
        <>
          {tab === 'icp' && (
            <div className="stack" style={{ maxWidth: 720 }}>
              <div className="card card-pad">
                <div className="card-title" style={{ marginBottom: 14 }}>Qualification threshold</div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label className="label" htmlFor="min_score">Minimum AI score for outreach</label>
                  <div className="row">
                    <input id="min_score" type="range" min={0} max={100} step={5} value={icp.min_score} onChange={e => patchIcp({ min_score: Number(e.target.value) })} style={{ flex: 1, accentColor: 'var(--accent)' }} />
                    <span className="score high" style={{ minWidth: 44 }}>{icp.min_score}</span>
                  </div>
                  <span className="hint">Leads scoring below this are not drafted for outreach. 60 is a good starting point.</span>
                </div>
              </div>
              <div className="card card-pad">
                <div className="card-title" style={{ marginBottom: 14 }}>Lead sources</div>
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  {SOURCES.map(src => {
                    const on = icp.sources.includes(src)
                    return (
                      <button key={src} className={`btn btn-sm ${on ? 'btn-primary' : ''}`} aria-pressed={on}
                        onClick={() => patchIcp({ sources: on ? icp.sources.filter(s => s !== src) : [...icp.sources, src] })}>
                        {src}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="card card-pad">
                <div className="card-title" style={{ marginBottom: 14 }}>Keyword & domain filters</div>
                <div className="field">
                  <label className="label" htmlFor="kw_in">Include keywords</label>
                  <ListInput id="kw_in" value={icp.keywords_include} onChange={v => patchIcp({ keywords_include: v })} placeholder="saas, startup, founder" />
                </div>
                <div className="field">
                  <label className="label" htmlFor="kw_out">Exclude keywords</label>
                  <ListInput id="kw_out" value={icp.keywords_exclude} onChange={v => patchIcp({ keywords_exclude: v })} placeholder="hiring, job, agency" />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label className="label" htmlFor="domains">Excluded email domains</label>
                  <ListInput id="domains" value={icp.exclude_domains} onChange={v => patchIcp({ exclude_domains: v })} placeholder="gmail.com, yahoo.com" />
                  <span className="hint">Comma-separated.</span>
                </div>
              </div>
            </div>
          )}

          {tab === 'sending' && (
            <div className="stack" style={{ maxWidth: 720 }}>
              <div className="card card-pad">
                <div className="card-title" style={{ marginBottom: 14 }}>Rate limits</div>
                <div className="form-grid">
                  <div className="field">
                    <label className="label" htmlFor="daily">Daily max emails</label>
                    <input id="daily" type="number" className="input" min={1} max={200} value={sending.daily_max} onChange={e => patchSending({ daily_max: clampInt(e.target.value, 1, 200) })} />
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="hourly">Hourly max emails</label>
                    <input id="hourly" type="number" className="input" min={1} max={50} value={sending.hourly_max} onChange={e => patchSending({ hourly_max: clampInt(e.target.value, 1, 50) })} />
                  </div>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label className="label" htmlFor="gap">Minimum gap between sends (minutes)</label>
                    <input id="gap" type="number" className="input" min={1} max={120} value={sending.min_gap_minutes} onChange={e => patchSending({ min_gap_minutes: clampInt(e.target.value, 1, 120) })} />
                  </div>
                </div>
              </div>
              <div className="card card-pad">
                <div className="card-title" style={{ marginBottom: 14 }}>Send window</div>
                <div className="form-grid">
                  <div className="field">
                    <label className="label" htmlFor="start">Start hour (0–23)</label>
                    <input id="start" type="number" className="input" min={0} max={23} value={sending.send_window_start_hour} onChange={e => patchSending({ send_window_start_hour: clampInt(e.target.value, 0, 23) })} />
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="end">End hour (0–23)</label>
                    <input id="end" type="number" className="input" min={0} max={23} value={sending.send_window_end_hour} onChange={e => patchSending({ send_window_end_hour: clampInt(e.target.value, 0, 23) })} />
                  </div>
                </div>
                <label className="check">
                  <input type="checkbox" checked={sending.send_on_weekends} onChange={e => patchSending({ send_on_weekends: e.target.checked })} />
                  Allow sending on weekends
                </label>
              </div>
              <div className="card card-pad">
                <div className="card-title" style={{ marginBottom: 14 }}>Follow-up schedule</div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label className="label" htmlFor="followups">Days after the first email</label>
                  <ListInput
                    id="followups"
                    value={sending.follow_up_days.map(String)}
                    onChange={v => patchSending({ follow_up_days: v.map(Number).filter(n => Number.isInteger(n) && n > 0).sort((a, b) => a - b) })}
                    placeholder="7, 14, 21"
                  />
                  <span className="hint">Up to three follow-ups are recommended.</span>
                </div>
              </div>
            </div>
          )}

          {tab === 'templates' && (
            templates.length === 0 ? (
              <div className="card"><EmptyState icon={<IconFile />} title="No templates" text="Seed templates are created by supabase/schema.sql." /></div>
            ) : (
              <div className="grid" style={{ gridTemplateColumns: 'minmax(220px, 300px) minmax(0, 1fr)' }}>
                <div className="card">
                  <div className="list">
                    {templates.map(t => (
                      <button key={t.id} className={`list-item ${editing?.id === t.id ? 'selected' : ''}`} onClick={() => setEditing({ ...t })}>
                        <div className="row-between">
                          <span className="cell-title truncate">{t.name}</span>
                          {t.active ? <Badge tone="green">Active</Badge> : <Badge>Off</Badge>}
                        </div>
                        <div className="cell-sub mono">{t.key}</div>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="card">
                  {!editing ? (
                    <EmptyState icon={<IconFile />} title="Select a template" text="Use {{name}}, {{company}}, {{source}} and {{hook}} as placeholders." />
                  ) : (
                    <div className="card-pad fade-in">
                      <div className="field">
                        <label className="label" htmlFor="tname">Name</label>
                        <input id="tname" className="input" value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} />
                      </div>
                      <div className="field">
                        <label className="label" htmlFor="tsubject">Subject</label>
                        <input id="tsubject" className="input" value={editing.subject_template} onChange={e => setEditing({ ...editing, subject_template: e.target.value })} />
                      </div>
                      <div className="field">
                        <label className="label" htmlFor="tbody">Body</label>
                        <textarea id="tbody" className="textarea mono" style={{ minHeight: 280 }} value={editing.body_template} onChange={e => setEditing({ ...editing, body_template: e.target.value })} />
                        <span className="hint">Placeholders: {'{{name}} {{company}} {{source}} {{hook}}'}</span>
                      </div>
                      <div className="row-between">
                        <label className="check">
                          <input type="checkbox" checked={editing.active} onChange={e => setEditing({ ...editing, active: e.target.checked })} />
                          Active
                        </label>
                        <button className="btn btn-primary" onClick={saveTemplate} disabled={saving}>
                          {saving && <Spinner />} Save template
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )
          )}

          {tab === 'integrations' && (
            <div className="stack" style={{ maxWidth: 820 }}>
              <div className="card">
                <div className="card-head">
                  <div>
                    <div className="card-title">Connection status</div>
                    <div className="card-desc">Checked server-side. Secret values are never sent to the browser.</div>
                  </div>
                  <button className="btn btn-sm" onClick={checkStatus} disabled={checking}>
                    {checking ? <Spinner /> : <IconRefresh className="icon" />} Re-check
                  </button>
                </div>
                {!status ? (
                  <div className="card-pad">{checking ? <div className="skeleton" style={{ height: 80 }} /> : <Alert>Status check failed.</Alert>}</div>
                ) : (
                  <>
                    <div className="integration">
                      <div className="integration-icon"><IconDatabase /></div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="cell-title">Supabase</div>
                        <div className="cell-sub">{status.supabase.connected ? 'Database reachable and readable with your account.' : status.supabase.error}</div>
                      </div>
                      <Badge tone={status.supabase.connected ? 'green' : 'red'}>{status.supabase.connected ? 'Connected' : 'Error'}</Badge>
                    </div>
                    <div className="integration">
                      <div className="integration-icon"><IconWorkflow /></div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="cell-title">n8n</div>
                        <div className="cell-sub">
                          {!status.n8n.baseUrlConfigured
                            ? 'N8N_BASE_URL is not set on the server.'
                            : !status.n8n.secretConfigured
                              ? 'N8N_WEBHOOK_SECRET is not set — webhooks will be refused.'
                              : status.n8n.reachable
                                ? 'Instance reachable (GET /healthz).'
                                : `Instance unreachable: ${status.n8n.error ?? 'unknown error'}`}
                        </div>
                      </div>
                      <Badge tone={status.n8n.reachable && status.n8n.secretConfigured ? 'green' : status.n8n.baseUrlConfigured ? 'red' : 'amber'}>
                        {status.n8n.reachable && status.n8n.secretConfigured ? 'Connected' : status.n8n.baseUrlConfigured ? 'Problem' : 'Not configured'}
                      </Badge>
                    </div>
                  </>
                )}
              </div>
              <div className="card card-pad">
                <div className="card-title" style={{ marginBottom: 4 }}>Webhook endpoints used by this app</div>
                <p className="card-desc" style={{ marginBottom: 14 }}>
                  Every request is a POST to <span className="mono">{'{N8N_BASE_URL}'}/webhook/&lt;path&gt;</span> with the
                  header <span className="mono">X-Webhook-Secret</span>.
                </p>
                {[
                  ['approve-and-send', 'WF-3b · send an approved email', '{ outreach_id, lead_id, approved_at }'],
                  ['wf1-scraper', 'WF-1 · scraper', '{ triggered_by, timestamp }'],
                  ['wf2-processor', 'WF-2 · processor', '{ triggered_by, timestamp }'],
                  ['wf3-outreach', 'WF-3 · outreach generator', '{ triggered_by, timestamp }'],
                  ['wf4-reply-monitor', 'WF-4 · reply monitor', '{ triggered_by, timestamp }'],
                  ['wf5-feedback', 'WF-5 · feedback loop', '{ triggered_by, timestamp }'],
                ].map(([path, label, payload]) => {
                  const probe = status?.n8n.webhooks?.find(w => w.path === path)
                  return (
                    <div key={path} className="kv" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
                      <span>{label}</span>
                      <span className="row" style={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        <span className="mono">/webhook/{path} <span className="subtle">{payload}</span></span>
                        {probe && (
                          <span title={probe.detail}>
                            <span className={`badge as-is ${probe.state === 'ready' ? 'green' : probe.state === 'unknown' ? '' : 'red'}`}>
                              {probe.state === 'ready' ? 'Ready' : probe.state === 'missing' ? 'Missing in n8n' : probe.state === 'wrong_method' ? 'Not POST' : 'Unknown'}
                            </span>
                          </span>
                        )}
                      </span>
                    </div>
                  )
                })}
                {status?.n8n.webhooks?.some(w => w.state !== 'ready') && (
                  <div style={{ marginTop: 14 }}>
                    <Alert tone="warn" title="Some webhooks are not set up in n8n">
                      For each one marked Missing, open that workflow in n8n and add a <strong>Webhook</strong> trigger node with HTTP Method{' '}
                      <span className="mono">POST</span>, the Path shown above, and Header Auth on <span className="mono">X-Webhook-Secret</span>.
                      Connect it to the same first node as the existing trigger, then publish/activate the workflow. Marked Not POST: change
                      that Webhook node&apos;s HTTP Method to POST.
                    </Alert>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </>
  )
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="skeleton" style={{ height: 400, borderRadius: 14 }} />}>
      <SettingsInner />
    </Suspense>
  )
}
