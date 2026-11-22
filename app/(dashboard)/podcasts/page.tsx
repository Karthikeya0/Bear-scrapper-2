'use client'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/Toast'
import { Alert, Badge, Drawer, EmptyState, PageHeader, ScoreBadge, SkeletonRows, Spinner } from '@/components/ui'
import { IconBolt, IconCheck, IconDownload, IconExternal, IconMail, IconMic, IconRefresh, IconSearch, IconSettings } from '@/components/icons'
import { errorMessage, formatDate, timeAgo } from '@/lib/format'
import { triggerWorkflow, type WorkflowKey } from '@/lib/workflows'
import {
  DEFAULT_PODCAST_SETTINGS, PODCAST_NICHES, PODCAST_STATUSES, PODCAST_STATUS_TONE, loadPodcastSettings, savePodcastSettings, startOfDayIso,
  type PodcastLead, type PodcastSettings,
} from '@/lib/podcast'
import { loadSettings } from '@/lib/settings'

type Stage = 'qualified' | 'found' | 'skipped'
const STAGES: { key: Stage; label: string }[] = [
  { key: 'qualified', label: 'Qualified' },
  { key: 'found', label: 'Waiting for checks' },
  { key: 'skipped', label: 'Skipped' },
]
const PAGE_SIZE = 50

function safeUrl(v: string | null | undefined) {
  if (!v) return null
  try {
    const u = new URL(v)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null
  } catch {
    return null
  }
}

function ExtLink({ href, children }: { href: string | null | undefined; children: React.ReactNode }) {
  const url = safeUrl(href)
  if (!url) return <span className="subtle">—</span>
  return (
    <a className="link" href={url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>
      {children} <IconExternal width={12} height={12} />
    </a>
  )
}

function PodcastStatus({ status }: { status: string }) {
  return <Badge tone={PODCAST_STATUS_TONE[status] ?? 'gray'}>{status}</Badge>
}

type Stats = { found: number; qualified: number; skipped: number; replied: number; niches: number; complete: number; sentToday: number }

export default function PodcastsPage() {
  const supabase = useMemo(() => createClient(), [])
  const toast = useToast()

  const [stage, setStage] = useState<Stage>('qualified')
  const [rows, setRows] = useState<PodcastLead[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [status, setStatus] = useState('all')
  const [niche, setNiche] = useState('all')
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [stats, setStats] = useState<Stats | null>(null)
  const [settings, setSettings] = useState<PodcastSettings>(DEFAULT_PODCAST_SETTINGS)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [running, setRunning] = useState<string>('')

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search.replace(/[,()*%\\:"]/g, ' ').trim())
      setLimit(PAGE_SIZE)
    }, 300)
    return () => clearTimeout(t)
  }, [search])

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase.from('podcast_leads').select('*', { count: 'exact' }).eq('stage', stage)
      .order(stage === 'qualified' ? 'ai_score' : 'updated_at', { ascending: false, nullsFirst: false })
      .range(0, limit - 1)
    if (status !== 'all') q = q.eq('status', status)
    if (niche !== 'all') q = q.eq('niche', niche)
    if (debounced) q = q.or(`podcast_name.ilike.*${debounced}*,host_name.ilike.*${debounced}*,email.ilike.*${debounced}*`)
    const { data, count, error } = await q
    if (error) setError(error.message)
    else {
      setError('')
      setRows((data ?? []) as PodcastLead[])
      setTotal(count ?? 0)
    }
    setLoading(false)
  }, [supabase, stage, status, niche, debounced, limit])

  const loadStats = useCallback(async () => {
    const head = { count: 'exact' as const, head: true }
    const [{ settings: shared }, { settings: ps }] = await Promise.all([loadSettings(supabase), loadPodcastSettings(supabase)])
    setSettings(ps)
    const [found, qualified, skipped, replied, complete, sent, niches] = await Promise.all([
      supabase.from('podcast_leads').select('id', head).eq('stage', 'found'),
      supabase.from('podcast_leads').select('id', head).eq('stage', 'qualified'),
      supabase.from('podcast_leads').select('id', head).eq('stage', 'skipped'),
      supabase.from('podcast_leads').select('id', head).in('status', ['Replied', 'Won']),
      supabase.from('podcast_leads').select('id', head).eq('stage', 'qualified').not('instagram_url', 'is', null).not('sample_episode_url', 'is', null),
      supabase.from('podcast_outreach').select('id', head).eq('status', 'sent').eq('channel', 'email').gte('sent_at', startOfDayIso(shared.timezone)),
      supabase.from('podcast_leads').select('niche').eq('stage', 'qualified').limit(5000),
    ])
    setStats({
      found: found.count ?? 0, qualified: qualified.count ?? 0, skipped: skipped.count ?? 0, replied: replied.count ?? 0,
      complete: complete.count ?? 0, sentToday: sent.count ?? 0,
      niches: new Set(((niches.data ?? []) as { niche: string | null }[]).map(r => r.niche).filter(Boolean)).size,
    })
  }, [supabase])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data load on filter change
    load()
  }, [load])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load, then realtime refresh
    loadStats()
    const channel = supabase
      .channel('podcasts-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'podcast_leads' }, () => {
        load()
        loadStats()
      })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, load, loadStats])

  async function run(key: WorkflowKey, message: string) {
    setRunning(key)
    const res = await triggerWorkflow(key)
    setRunning('')
    if (res.ok) toast.success(message)
    else toast.error(res.error ?? 'Could not start the workflow.')
  }

  async function update(id: string, patch: Partial<PodcastLead>, message?: string) {
    const { error } = await supabase.from('podcast_leads').update(patch).eq('id', id)
    if (error) return toast.error(error.message)
    setRows(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)))
    if (message) toast.success(message)
  }

  const selected = rows.find(r => r.id === selectedId) ?? null
  const filtersActive = status !== 'all' || niche !== 'all' || !!debounced

  return (
    <>
      <PageHeader
        title="Podcasts"
        description="Small podcasts found on YouTube and checked against the Podcast Lead Research SOP. Separate from startup leads."
        actions={
          <>
            <button className="btn" onClick={() => { load(); loadStats() }} disabled={loading}><IconRefresh className="icon" /> Refresh</button>
            <button className="btn" onClick={() => setSettingsOpen(true)}><IconSettings className="icon" /> Settings</button>
            <a className="btn" href="/api/podcasts/export" download title="Qualified podcasts as a CSV in the SOP's sheet layout (columns A–N)"><IconDownload className="icon" /> CSV</a>
            <Link className="btn" href="/podcasts/outreach"><IconMail className="icon" /> Podcast outreach</Link>
            <button className="btn btn-primary" onClick={() => run('WF-P1-PodcastFind', 'Searching YouTube. New shows appear under “Waiting for checks”, then WF-P2 checks them.')} disabled={!!running}>
              {running === 'WF-P1-PodcastFind' ? <Spinner /> : <IconBolt className="icon" />} Find podcasts
            </button>
          </>
        }
      />

      <div className="stats">
        <div className="stat">
          <div className="stat-label">Qualified</div>
          <div className="stat-value" style={{ marginTop: 10 }}>{stats?.qualified ?? '—'}</div>
          <div className="stat-hint">SOP target: 100 before outreach</div>
        </div>
        <div className="stat">
          <div className="stat-label">Waiting for checks</div>
          <div className="stat-value" style={{ marginTop: 10 }}>{stats?.found ?? '—'}</div>
          <div className="stat-hint">
            <button className="link" style={{ background: 'none', border: 0, padding: 0, font: 'inherit', cursor: 'pointer' }} disabled={!!running}
              onClick={() => run('WF-P2-PodcastQualify', 'Checking podcasts against the SOP (40 per run).')}>
              {running === 'WF-P2-PodcastQualify' ? 'Starting…' : 'Check now'}
            </button>
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Emails today</div>
          <div className="stat-value" style={{ marginTop: 10 }}>{stats ? `${stats.sentToday} / ${settings.daily_max}` : '—'}</div>
          <div className="stat-hint">Podcast limit (startups have their own 10)</div>
        </div>
        <div className="stat">
          <div className="stat-label">Replied or won</div>
          <div className="stat-value" style={{ marginTop: 10 }}>{stats?.replied ?? '—'}</div>
          <div className="stat-hint">{stats ? `${stats.skipped} skipped by the checks` : '—'}</div>
        </div>
      </div>

      {stats && (
        <div className="card card-pad" style={{ marginBottom: 18 }}>
          <div className="row-between" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
            <div className="section-title" style={{ margin: 0 }}>SOP handover checklist</div>
            <span className="hint">
              Google Sheet: {safeUrl(settings.sheet_url)
                ? <><ExtLink href={settings.sheet_url}>Podcast Leads</ExtLink> · <button className="link" style={{ background: 'none', border: 0, padding: 0, font: 'inherit', cursor: 'pointer' }} onClick={() => run('WF-P5-PodcastSheet', 'Syncing the Google Sheet.')}>sync now</button></>
                : <button className="link" style={{ background: 'none', border: 0, padding: 0, font: 'inherit', cursor: 'pointer' }} onClick={() => setSettingsOpen(true)}>add the sheet link</button>}
            </span>
          </div>
          <div className="pipeline-stats">
            <Check ok={stats.qualified >= 100} text={`${stats.qualified} / 100 qualified rows`} />
            <Check ok={stats.niches >= 5} text={`${stats.niches} niches (5+)`} />
            <Check ok={stats.qualified > 0 && stats.complete === stats.qualified} text={`${stats.complete} / ${stats.qualified} have Instagram + sample episode`} />
            <Check ok text="No duplicates (one row per YouTube channel)" />
            <Check ok text={`Subscribers ${settings.min_subscribers.toLocaleString()}–${settings.max_subscribers.toLocaleString()}, ${settings.min_uploads_30d}+ episodes in 30 days`} />
          </div>
        </div>
      )}

      <div className="tabs" role="tablist">
        {STAGES.map(s => (
          <button key={s.key} role="tab" aria-selected={stage === s.key} className={`tab ${stage === s.key ? 'active' : ''}`} onClick={() => { setStage(s.key); setLimit(PAGE_SIZE) }}>
            {s.label}
            <span className="tab-count">{stats ? stats[s.key] : '…'}</span>
          </button>
        ))}
      </div>

      <div className="toolbar">
        <div className="search">
          <IconSearch />
          <input className="input" placeholder="Search podcast, host or email…" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search podcasts" />
        </div>
        {stage === 'qualified' && (
          <select className="select" value={status} onChange={e => { setStatus(e.target.value); setLimit(PAGE_SIZE) }} aria-label="Status">
            <option value="all">All statuses</option>
            {PODCAST_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        <select className="select" value={niche} onChange={e => { setNiche(e.target.value); setLimit(PAGE_SIZE) }} aria-label="Niche">
          <option value="all">All niches</option>
          {PODCAST_NICHES.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        {filtersActive && <button className="btn btn-ghost btn-sm" onClick={() => { setSearch(''); setStatus('all'); setNiche('all') }}>Clear filters</button>}
      </div>

      {error && <Alert title="Could not load podcasts">{errorMessage(error)}{/podcast_leads/.test(error) && ' Run supabase/migrations/007_podcasts.sql in the Supabase SQL editor first.'}</Alert>}

      <div className="card">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Podcast</th>
                <th className="t-right">Subs</th>
                <th className="t-right">Eps / 30d</th>
                <th>Shorts</th>
                <th>Contact</th>
                <th>{stage === 'skipped' ? 'Why skipped' : 'Score'}</th>
                {stage === 'qualified' && <th>Status</th>}
                <th className="t-right">Added</th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <SkeletonRows rows={8} cols={stage === 'qualified' ? 8 : 7} />
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <EmptyState
                      icon={<IconMic />}
                      title={filtersActive ? 'No podcasts match these filters' : stage === 'qualified' ? 'No qualified podcasts yet' : stage === 'found' ? 'Nothing waiting' : 'Nothing skipped yet'}
                      text={stage === 'qualified' ? 'Click Find podcasts, then Check now. Shows that pass the SOP checks land here.' : undefined}
                    />
                  </td>
                </tr>
              ) : (
                rows.map(r => (
                  <tr key={r.id} className={`clickable ${r.status === 'Email sent' || r.status === 'DM sent' ? 'emailed' : ''}`} onClick={() => setSelectedId(r.id)}>
                    <td>
                      <div className="cell-title">{r.podcast_name || 'Unnamed show'}</div>
                      <div className="cell-sub">{[r.host_name, r.niche].filter(Boolean).join(' · ') || '—'}</div>
                    </td>
                    <td className="t-right num">{r.subscribers?.toLocaleString() ?? '—'}</td>
                    <td className="t-right num">{r.uploads_30d ?? '—'}{r.avg_minutes ? <span className="subtle"> · {r.avg_minutes}m</span> : null}</td>
                    <td>{r.has_shorts ? <span className="tag">{r.has_shorts}</span> : <span className="subtle">—</span>}</td>
                    <td className="muted" style={{ fontSize: 12.5 }}>
                      {r.email ? <span className="mono">{r.email}</span> : null}
                      {r.email && r.instagram_url ? <br /> : null}
                      {r.instagram_url ? <ExtLink href={r.instagram_url}>Instagram</ExtLink> : !r.email ? <span className="subtle">—</span> : null}
                    </td>
                    <td>{stage === 'skipped' ? <span className="muted" style={{ fontSize: 12.5 }}>{r.skip_reason}</span> : <ScoreBadge score={r.ai_score} />}</td>
                    {stage === 'qualified' && <td><PodcastStatus status={r.status} /></td>}
                    <td className="t-right subtle num">{formatDate(r.created_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {rows.length > 0 && (
          <div className="card-foot row-between">
            <span>Showing {rows.length.toLocaleString()} of {total.toLocaleString()}</span>
            {rows.length < total && <button className="btn btn-sm" onClick={() => setLimit(l => l + PAGE_SIZE)} disabled={loading}>{loading && <Spinner />} Load more</button>}
          </div>
        )}
      </div>

      {selected && <PodcastDrawer lead={selected} onClose={() => setSelectedId(null)} onUpdate={update} />}
      {settingsOpen && (
        <SettingsDrawer
          initial={settings}
          onClose={() => setSettingsOpen(false)}
          onSave={async patch => {
            const { error, value } = await savePodcastSettings(supabase, patch)
            if (error) return toast.error(error)
            if (value) setSettings(value)
            toast.success('Podcast settings saved. n8n uses them from the next run.')
            setSettingsOpen(false)
          }}
        />
      )}
    </>
  )
}

function Check({ ok, text }: { ok: boolean; text: string }) {
  return (
    <span className="row" style={{ gap: 6, display: 'inline-flex', alignItems: 'center' }}>
      <span style={{ color: ok ? 'var(--green)' : 'var(--text-tertiary, #999)' }}>{ok ? <IconCheck width={15} height={15} /> : '○'}</span>
      <span className={ok ? '' : 'muted'}>{text}</span>
    </span>
  )
}

function PodcastDrawer({ lead, onClose, onUpdate }: { lead: PodcastLead; onClose: () => void; onUpdate: (id: string, patch: Partial<PodcastLead>, message?: string) => Promise<unknown> }) {
  const [clip, setClip] = useState(lead.sample_clip_url ?? '')
  const [email, setEmail] = useState(lead.email ?? '')
  const [instagram, setInstagram] = useState(lead.instagram_url ?? '')
  const [saving, setSaving] = useState(false)

  async function saveContacts() {
    setSaving(true)
    const patch: Partial<PodcastLead> = {
      email: email.trim() ? email.trim().toLowerCase() : null,
      instagram_url: instagram.trim() || null,
    }
    const clipUrl = clip.trim() || null
    if (clipUrl !== lead.sample_clip_url) {
      patch.sample_clip_url = clipUrl
      if (clipUrl && lead.status === 'New') patch.status = 'Sample made'
    }
    await onUpdate(lead.id, patch, 'Saved.')
    setSaving(false)
  }

  return (
    <Drawer open onClose={onClose} title={lead.podcast_name || 'Podcast'} description={[lead.host_name, lead.niche].filter(Boolean).join(' · ') || undefined}
      footer={
        <>
          <button className="btn" onClick={onClose}>Close</button>
          <button className="btn btn-primary" onClick={saveContacts} disabled={saving}>{saving && <Spinner />} Save</button>
        </>
      }>
      {lead.stage === 'skipped' && <Alert tone="warn" title="Skipped by the checks">{lead.skip_reason}</Alert>}
      {lead.why_fit && <p style={{ marginTop: 0 }}><strong>Why a fit:</strong> {lead.why_fit}</p>}

      <div className="field">
        <label className="label" htmlFor="pstatus">Status (SOP column M)</label>
        <select id="pstatus" className="select" value={lead.status} onChange={e => onUpdate(lead.id, { status: e.target.value }, `Status set to ${e.target.value}.`)}>
          {PODCAST_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div style={{ marginBottom: 16 }}>
        <div className="kv"><span>YouTube channel</span><ExtLink href={lead.youtube_channel_url}>Open</ExtLink></div>
        <div className="kv"><span>Host / other account</span>{lead.host_other_url && lead.host_other_url !== 'same' ? <ExtLink href={lead.host_other_url}>Open</ExtLink> : <span>same</span>}</div>
        <div className="kv"><span>Sample episode</span><ExtLink href={lead.sample_episode_url}>{lead.sample_episode_title ? lead.sample_episode_title.slice(0, 40) : 'Open'}</ExtLink></div>
        <div className="kv"><span>Subscribers</span><span className="num">{lead.subscribers?.toLocaleString() ?? '—'}</span></div>
        <div className="kv"><span>Episodes in 30 days</span><span className="num">{lead.uploads_30d ?? '—'}{lead.avg_minutes ? ` · ${lead.avg_minutes} min avg` : ''}</span></div>
        <div className="kv"><span>Shorts</span><span>{lead.has_shorts ?? '—'}{lead.shorts_30d ? ` (${lead.shorts_30d} in 30 days)` : ''}</span></div>
        <div className="kv"><span>Last upload</span><span>{lead.last_upload_at ? timeAgo(lead.last_upload_at) : '—'}</span></div>
        <div className="kv"><span>Contact</span><span>{lead.contact_method || '—'}</span></div>
        {!!lead.checks_failed?.length && <div className="kv"><span>Checks failed</span><span>{lead.checks_failed.join('; ')}</span></div>}
        <div className="kv"><span>In Google Sheet</span><span>{lead.sheet_synced_at ? timeAgo(lead.sheet_synced_at) : 'not yet'}</span></div>
      </div>

      <div className="field">
        <label className="label" htmlFor="pig">Instagram URL</label>
        <input id="pig" className="input" value={instagram} onChange={e => setInstagram(e.target.value)} placeholder="https://www.instagram.com/…" />
        <label className="row" style={{ gap: 8, fontSize: 13, marginTop: 4 }}>
          <input type="checkbox" checked={!!lead.ig_verified} onChange={e => onUpdate(lead.id, { ig_verified: e.target.checked }, e.target.checked ? 'Marked as active on Instagram.' : undefined)} />
          Checked by hand: posted on Instagram in the last 30 days (SOP step 5)
        </label>
      </div>
      <div className="field">
        <label className="label" htmlFor="pemail">Email</label>
        <input id="pemail" className="input mono" value={email} onChange={e => setEmail(e.target.value)} placeholder="From the About tab, if any" />
        <span className="hint">YouTube hides About-tab emails behind a captcha, so add it here if you find one. Shows with an email get drafted.</span>
      </div>
      <div className="field">
        <label className="label" htmlFor="pclip">Free sample short (link)</label>
        <input id="pclip" className="input" value={clip} onChange={e => setClip(e.target.value)} placeholder="Drive / YouTube link to the clip you cut" />
        <span className="hint">Saving a link moves the show to “Sample made”, and the next draft shares it.</span>
      </div>
    </Drawer>
  )
}

function SettingsDrawer({ initial, onClose, onSave }: { initial: PodcastSettings; onClose: () => void; onSave: (patch: PodcastSettings) => Promise<unknown> }) {
  const [form, setForm] = useState<PodcastSettings>(initial)
  const [followText, setFollowText] = useState(initial.follow_up_days.join(', '))
  const [saving, setSaving] = useState(false)
  const set = (patch: Partial<PodcastSettings>) => setForm(f => ({ ...f, ...patch }))
  const int = (v: string, min: number, max: number, fallback: number) => {
    const n = Math.round(Number(v))
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
  }

  async function save() {
    setSaving(true)
    const days = followText.split(',').map(s => Number(s.trim())).filter(n => Number.isInteger(n) && n > 0 && n <= 90)
    await onSave({ ...form, follow_up_days: days })
    setSaving(false)
  }

  const sheetOk = !form.sheet_url || /^https:\/\/docs\.google\.com\/spreadsheets\//.test(form.sheet_url)
  return (
    <Drawer open onClose={onClose} title="Podcast settings" description="Saved in Supabase; every podcast workflow reads them on its next run."
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={saving || !sheetOk}>{saving && <Spinner />} Save</button></>}>
      <div className="field">
        <label className="label" htmlFor="pmax">Podcast emails per day</label>
        <input id="pmax" type="number" className="input" min={1} max={50} value={form.daily_max} onChange={e => set({ daily_max: int(e.target.value, 1, 50, form.daily_max) })} />
        <span className="hint">Hard limit, including Approve & send. Startups have their own limit in Settings (10 + 10 = 20 a day).</span>
      </div>
      <div className="field">
        <label className="label" htmlFor="pauto">Sending</label>
        <select id="pauto" className="select" value={form.autopilot} onChange={e => set({ autopilot: e.target.value as PodcastSettings['autopilot'] })}>
          <option value="manual">I approve each email (Approve all sends them gradually)</option>
          <option value="auto">Autopilot: new drafts are scheduled automatically</option>
        </select>
      </div>
      <div className="grid-2" style={{ display: 'grid', gap: 12 }}>
        <div className="field">
          <label className="label" htmlFor="pmin">Min subscribers</label>
          <input id="pmin" type="number" className="input" value={form.min_subscribers} onChange={e => set({ min_subscribers: int(e.target.value, 0, 10000000, form.min_subscribers) })} />
        </div>
        <div className="field">
          <label className="label" htmlFor="pmaxs">Max subscribers</label>
          <input id="pmaxs" type="number" className="input" value={form.max_subscribers} onChange={e => set({ max_subscribers: int(e.target.value, 1, 10000000, form.max_subscribers) })} />
        </div>
        <div className="field">
          <label className="label" htmlFor="pup">Min episodes in 30 days</label>
          <input id="pup" type="number" className="input" value={form.min_uploads_30d} onChange={e => set({ min_uploads_30d: int(e.target.value, 0, 60, form.min_uploads_30d) })} />
        </div>
        <div className="field">
          <label className="label" htmlFor="plen">Min episode length (min)</label>
          <input id="plen" type="number" className="input" value={form.min_episode_minutes} onChange={e => set({ min_episode_minutes: int(e.target.value, 1, 600, form.min_episode_minutes) })} />
        </div>
      </div>
      <div className="field">
        <label className="label" htmlFor="psearch">YouTube searches per run</label>
        <input id="psearch" type="number" className="input" min={1} max={90} value={form.searches_per_run} onChange={e => set({ searches_per_run: int(e.target.value, 1, 90, form.searches_per_run) })} />
        <span className="hint">Each search uses 100 of YouTube&apos;s free 10,000 daily units. WF-P1 runs twice a day, so keep this at 40 or less.</span>
      </div>
      <div className="field">
        <label className="label" htmlFor="pfollow">Follow-ups after (days)</label>
        <input id="pfollow" className="input" value={followText} onChange={e => setFollowText(e.target.value)} placeholder="4, 7 — empty for none" />
      </div>
      <label className="row" style={{ gap: 8, fontSize: 13, marginBottom: 16 }}>
        <input type="checkbox" checked={form.draft_dms} onChange={e => set({ draft_dms: e.target.checked })} />
        Draft Instagram DMs for shows without an email (you send them yourself)
      </label>
      <div className="field">
        <label className="label" htmlFor="psheet">Google Sheet link</label>
        <input id="psheet" className="input" value={form.sheet_url} onChange={e => set({ sheet_url: e.target.value.trim() })} placeholder="https://docs.google.com/spreadsheets/d/…" />
        <span className="hint">{sheetOk ? 'It needs a tab named “Podcast Leads” with the SOP headers in row 1 (see the setup guide).' : 'That is not a Google Sheets link.'}</span>
      </div>
      <div className="field">
        <label className="label" htmlFor="pby">“Added by” in the sheet</label>
        <input id="pby" className="input" value={form.added_by} onChange={e => set({ added_by: e.target.value })} />
      </div>
    </Drawer>
  )
}
