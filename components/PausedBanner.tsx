'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { audit, loadSettings, patchSettings } from '@/lib/settings'
import { useToast } from './Toast'
import { Spinner } from './ui'

/** Fired by the Settings page after it changes `paused`, so the banner updates without a reload. */
export const SETTINGS_CHANGED = 'bear:settings-changed'

/** Shown on every page while STOP ALL is on (set here, in Settings, or by replying STOP ALL to the digest). */
export default function PausedBanner() {
  const supabase = useMemo(() => createClient(), [])
  const toast = useToast()
  const [paused, setPaused] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { settings } = await loadSettings(supabase)
    setPaused(settings.paused)
  }, [supabase])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load
    load()
    const onChange = () => load()
    window.addEventListener(SETTINGS_CHANGED, onChange)
    // An emailed STOP ALL / RESUME changes the row from n8n; check again now and then.
    const timer = setInterval(load, 60000)
    return () => {
      window.removeEventListener(SETTINGS_CHANGED, onChange)
      clearInterval(timer)
    }
  }, [load])

  async function resume() {
    setBusy(true)
    const { error } = await patchSettings(supabase, { paused: false })
    if (!error) await audit(supabase, 'resumed', { via: 'dashboard banner' })
    setBusy(false)
    if (error) return toast.error(`Could not resume: ${error}`)
    setPaused(false)
    window.dispatchEvent(new Event(SETTINGS_CHANGED))
    toast.success('Resumed. Workflows run on their next schedule.')
  }

  if (!paused) return null
  return (
    <div className="paused-banner" role="status">
      <span><strong>Outreach is paused.</strong> Nothing is scraped, drafted or sent until you resume. Reply checks keep running.</span>
      <button className="btn btn-sm" onClick={resume} disabled={busy}>{busy && <Spinner />} Resume</button>
    </div>
  )
}
