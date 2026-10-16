'use client'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/Toast'
import { Alert, Badge, PageHeader, Spinner } from '@/components/ui'
import { IconDatabase, IconRefresh, IconWorkflow } from '@/components/icons'
import { DEFAULT_SETTINGS, loadSettings, SETTINGS_KEY, type OutreachSettings } from '@/lib/settings'

type Status = {
  supabase: { connected: boolean; error?: string }
  n8n: {
    baseUrlConfigured: boolean; secretConfigured: boolean; reachable: boolean; error?: string
    webhooks?: { workflow: string; path: string; required?: boolean; state: 'ready' | 'missing' | 'wrong_method' | 'unknown'; detail?: string }[]
  }
}

const WEBHOOKS: [string, string][] = [
  ['wf1-scraper', 'Scrape leads'],
  ['wf2-processor', 'Score & enrich'],
  ['wf3-outreach', 'Draft outreach'],
  ['approve-and-send', 'Approve & send'],
  ['wf4-reply-monitor', 'Check replies'],
]
const FALLBACK_ZONES = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'UTC']
const hourLabel = (h: number) => (h === 0 || h === 24 ? '12 am' : h === 12 ? '12 pm' : h < 12 ? `${h} am` : `${h - 12} pm`)
const int = (v: string, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(v))
  return v.trim() !== '' && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

/** One setting: what it does on the left, the control on the right. */
function Row({ label, hint, htmlFor, children }: { label: string; hint?: ReactNode; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-row-text">
        <label className="set-row-label" htmlFor={htmlFor}>{label}</label>
        {hint && <div className="set-row-hint">{hint}</div>}
      </div>
      <div className="set-row-control">{children}</div>
    </div>
  )
}

function Section({ title, desc, wide, children }: { title: string; desc: string; wide?: boolean; children: ReactNode }) {
  return (
    <section className={`card set-section${wide ? ' wide' : ''}`}>
      <div className="set-section-head">
        <h2 className="card-title">{title}</h2>
        <p className="card-desc">{desc}</p>
      </div>
      {children}
    </section>
  )
}

function Toggle({ id, checked, onChange }: { id: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button id={id} type="button" role="switch" aria-checked={checked} className={`switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
      <span className="switch-knob" />
    </button>
  )
}

export default function SettingsPage() {
  const supabase = useMemo(() => createClient(), [])
  const toast = useToast()
  const [saved, setSaved] = useState<OutreachSettings>(DEFAULT_SETTINGS)
  const [form, setForm] = useState<OutreachSettings>(DEFAULT_SETTINGS)
  const [followText, setFollowText] = useState(DEFAULT_SETTINGS.follow_up_days.join(', '))
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<Status | null>(null)
  const [checking, setChecking] = useState(false)
  const zones = useMemo(() => {
    let list: string[] = FALLBACK_ZONES
    try {
      list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? FALLBACK_ZONES
    } catch {}
    return list.includes(form.timezone) ? list : [form.timezone, ...list]
  }, [form.timezone])

  const load = useCallback(async () => {
    setLoading(true)
    const { settings, error } = await loadSettings(supabase)
    setLoadError(error ?? '')
    setSaved(settings)
    setForm(settings)
    setFollowText(settings.follow_up_days.join(', '))
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
    load()
    checkStatus()
  }, [load, checkStatus])

  const dirty = JSON.stringify(form) !== JSON.stringify(saved)
  const patch = (p: Partial<OutreachSettings>) => setForm(prev => ({ ...prev, ...p }))

  function parseFollowUps(text: string) {
    return [...new Set(text.split(/[,\s]+/).map(Number).filter(n => Number.isInteger(n) && n > 0 && n <= 90))].sort((a, b) => a - b).slice(0, 3)
  }

  async function save() {
    if (form.send_window_start >= form.send_window_end) return toast.error('The send window must start before it ends.')
    for (const k of ['sign_off', 'signature_name', 'company_name', 'from_name'] as const) {
      if (!form[k].trim()) return toast.error('Fill in every signature field.')
    }
    setSaving(true)
    const value = { ...form, sign_off: form.sign_off.trim(), signature_name: form.signature_name.trim(), company_name: form.company_name.trim(), website: form.website.trim(), from_name: form.from_name.trim() }
    const { error } = await supabase.from('settings').upsert({ key: SETTINGS_KEY, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
    setSaving(false)
    if (error) return toast.error(`Could not save: ${error.message}`)
    setSaved(value)
    setForm(value)
    toast.success('Saved. n8n uses these from its next run.')
  }

  function discard() {
    setForm(saved)
    setFollowText(saved.follow_up_days.join(', '))
  }

  const webhookIssues = status?.n8n.webhooks?.filter(w => w.required !== false && w.state !== 'ready') ?? []
  const n8nOk = !!status && status.n8n.reachable && status.n8n.secretConfigured

  return (
    <>
      <PageHeader title="Settings" description="Everything here is used by your n8n workflows on their next run." />
      {loadError && <Alert title="Could not load your settings">{loadError}</Alert>}

      {loading ? (
        <div className="skeleton" style={{ height: 420, borderRadius: 14, maxWidth: 880 }} />
      ) : (
        <div className="set-page">
          <Section title="Who gets an email" desc="Used by Score & enrich and Draft outreach.">
            <Row label="Minimum AI score" htmlFor="min_score" hint="Leads below this are not drafted. 60 is a good start. Lowering it only affects leads scored from now on.">
              <div className="row" style={{ gap: 12, width: '100%' }}>
                <input id="min_score" type="range" min={30} max={95} step={5} value={form.min_score} onChange={e => patch({ min_score: Number(e.target.value) })} className="range" />
                <span className="score high set-score">{form.min_score}</span>
              </div>
            </Row>
            <Row label="Drafts per run" htmlFor="drafts" hint="Messages written per click of Draft new emails (and every 3 hours).">
              <input id="drafts" type="number" inputMode="numeric" className="input set-num" min={1} max={50} value={form.drafts_per_run}
                onChange={e => patch({ drafts_per_run: int(e.target.value, 1, 50, form.drafts_per_run) })} />
            </Row>
            <Row label="Follow-ups" htmlFor="followups" hint="Days after the first email. Sent as replies in the same thread. Empty = none.">
              <div className="set-suffix">
                <input id="followups" className="input" value={followText} placeholder="4, 7"
                  onChange={e => { setFollowText(e.target.value); patch({ follow_up_days: parseFollowUps(e.target.value) }) }}
                  onBlur={() => setFollowText(form.follow_up_days.join(', '))} />
                <span className="subtle">days</span>
              </div>
            </Row>
            <Row label="Draft DMs when there is no email" htmlFor="dms" hint="Writes an X / LinkedIn message you send by hand.">
              <Toggle id="dms" checked={form.draft_dms} onChange={v => patch({ draft_dms: v })} />
            </Row>
          </Section>

          <Section title="Sending" desc="For emails you approve with Approve all. Approve & send on one email sends right away.">
            <Row label="Daily limit" htmlFor="daily" hint="Keep it at 20–30 so Gmail trusts your account.">
              <input id="daily" type="number" inputMode="numeric" className="input set-num" min={1} max={200} value={form.daily_max}
                onChange={e => patch({ daily_max: int(e.target.value, 1, 200, form.daily_max) })} />
            </Row>
            <Row label="Send window" htmlFor="win_start" hint="One scheduled email every 10 minutes inside these hours.">
              <div className="row" style={{ gap: 8 }}>
                <select id="win_start" className="input set-select" value={form.send_window_start} onChange={e => patch({ send_window_start: Number(e.target.value) })}>
                  {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
                </select>
                <span className="subtle">to</span>
                <select aria-label="Send window end" className="input set-select" value={form.send_window_end} onChange={e => patch({ send_window_end: Number(e.target.value) })}>
                  {Array.from({ length: 24 }, (_, i) => i + 1).map(h => <option key={h} value={h}>{hourLabel(h)}</option>)}
                </select>
              </div>
            </Row>
            <Row label="Time zone" htmlFor="tz">
              <select id="tz" className="input" value={form.timezone} onChange={e => patch({ timezone: e.target.value })}>
                {zones.map(z => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
              </select>
            </Row>
            <Row label="Send on weekends" htmlFor="weekends">
              <Toggle id="weekends" checked={form.send_on_weekends} onChange={v => patch({ send_on_weekends: v })} />
            </Row>
          </Section>

          <Section wide title="Your signature" desc="Added to the end of every email. The AI never writes its own sign-off.">
            <div className="set-sig">
              <div className="set-sig-fields">
                <div className="field">
                  <label className="label" htmlFor="from_name">From name <span className="subtle">(shown in their inbox)</span></label>
                  <input id="from_name" className="input" value={form.from_name} maxLength={80} onChange={e => patch({ from_name: e.target.value })} />
                </div>
                <div className="form-grid">
                  <div className="field">
                    <label className="label" htmlFor="sign_off">Sign-off</label>
                    <input id="sign_off" className="input" value={form.sign_off} maxLength={40} onChange={e => patch({ sign_off: e.target.value })} />
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="sig_name">Name</label>
                    <input id="sig_name" className="input" value={form.signature_name} maxLength={80} onChange={e => patch({ signature_name: e.target.value })} />
                  </div>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label className="label" htmlFor="company">Company</label>
                    <input id="company" className="input" value={form.company_name} maxLength={80} onChange={e => patch({ company_name: e.target.value })} />
                  </div>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label className="label" htmlFor="website">Website</label>
                    <input id="website" className="input" value={form.website} maxLength={80} onChange={e => patch({ website: e.target.value })} />
                  </div>
                </div>
              </div>
              <div className="set-preview" aria-label="Preview">
                <div className="set-preview-label">Preview</div>
                <div className="set-preview-from"><strong>{form.from_name || '—'}</strong></div>
                <p className="set-preview-faded">…Would a 15-minute call next week be useful?</p>
                <p>I&apos;ve attached a one-pager on how we work.</p>
                <p className="set-preview-sig">
                  {form.sign_off}<br />{form.signature_name}<br />{form.company_name}<br />
                  {form.website && <span className="link">{form.website}</span>}
                </p>
                <div className="set-preview-file">📎 Bear-Studios-How-We-Work.pdf</div>
              </div>
            </div>
          </Section>

          <Section wide title="Connections" desc="Checked on the server. Secret values never reach the browser.">
            <div className="set-conn">
              <div className="set-conn-item">
                <span className="integration-icon"><IconDatabase /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="cell-title">Supabase</div>
                  <div className="cell-sub truncate">{!status ? 'Checking…' : status.supabase.connected ? 'Database reachable' : status.supabase.error}</div>
                </div>
                {status && <Badge tone={status.supabase.connected ? 'green' : 'red'}>{status.supabase.connected ? 'Connected' : 'Error'}</Badge>}
              </div>
              <div className="set-conn-item">
                <span className="integration-icon"><IconWorkflow /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="cell-title">n8n</div>
                  <div className="cell-sub truncate">
                    {!status ? 'Checking…'
                      : !status.n8n.baseUrlConfigured ? 'N8N_BASE_URL is not set in .env.local'
                      : !status.n8n.secretConfigured ? 'N8N_WEBHOOK_SECRET is not set in .env.local'
                      : status.n8n.reachable ? (webhookIssues.length ? `${webhookIssues.length} webhook${webhookIssues.length > 1 ? 's' : ''} not ready` : 'All webhooks ready')
                      : `Unreachable: ${status.n8n.error ?? 'unknown error'}`}
                  </div>
                </div>
                {status && <Badge tone={n8nOk && !webhookIssues.length ? 'green' : 'red'}>{n8nOk && !webhookIssues.length ? 'Connected' : 'Problem'}</Badge>}
              </div>
            </div>
            {status?.n8n.webhooks && (
              <div className="set-hooks">
                {WEBHOOKS.map(([path, label]) => {
                  const probe = status.n8n.webhooks?.find(w => w.path === path)
                  const ok = probe?.state === 'ready'
                  return (
                    <div key={path} className="set-hook" title={probe?.detail}>
                      <span className={`set-dot ${ok ? 'ok' : probe?.state === 'unknown' ? '' : 'bad'}`} />
                      <span>{label}</span>
                      <span className="mono subtle truncate">/webhook/{path}</span>
                      <span className="set-hook-state">{ok ? 'Ready' : probe?.state === 'missing' ? 'Not published in n8n' : probe?.state === 'wrong_method' ? 'Must be POST' : 'Unknown'}</span>
                    </div>
                  )
                })}
              </div>
            )}
            <div className="set-section-foot">
              <span className="hint">A 403 when starting a workflow means that webhook&apos;s Header Auth credential in n8n doesn&apos;t match N8N_WEBHOOK_SECRET.</span>
              <button className="btn btn-sm" onClick={checkStatus} disabled={checking}>
                {checking ? <Spinner /> : <IconRefresh className="icon" />} Re-check
              </button>
            </div>
          </Section>
        </div>
      )}

      {dirty && (
        <div className="savebar fade-in" role="region" aria-label="Unsaved changes">
          <span>Unsaved changes</span>
          <div className="row">
            <button className="btn btn-sm" onClick={discard} disabled={saving}>Discard</button>
            <button className="btn btn-sm btn-primary" onClick={save} disabled={saving}>{saving && <Spinner />} Save changes</button>
          </div>
        </div>
      )}
    </>
  )
}
