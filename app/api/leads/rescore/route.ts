import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { callWebhook, WORKFLOW_WEBHOOK_MAP } from '@/lib/n8n'
import { FAILED_SCORING_PATTERNS } from '@/lib/outreach'

/**
 * Leads whose AI scoring failed (e.g. Groq rate limit) were saved with score 0 and can never be drafted.
 * Sends leads whose scoring failed back through WF-2: their raw lead is reset to "raw" and the
 * failed lead row is removed (only if nothing was ever drafted or sent for it), then WF-2 is started.
 */
export async function POST() {
  const auth = await requireRole(['owner'])
  if (!auth.ok) return auth.response
  const { supabase } = auth

  // One plain ilike query per pattern (values with ':' are unsafe inside a PostgREST or=() filter).
  const results = await Promise.all(
    FAILED_SCORING_PATTERNS.map(pattern =>
      supabase.from('leads').select('id, raw_lead_id, outreach_queue(id)').ilike('ai_reasoning', pattern).limit(1000),
    ),
  )
  const failedQuery = results.find(r => r.error)
  if (failedQuery?.error) return NextResponse.json({ ok: false, error: failedQuery.error.message }, { status: 500 })
  const data = results.flatMap(r => r.data ?? [])

  const rows = (data ?? []) as { id: string; raw_lead_id: string | null; outreach_queue: { id: string }[] | null }[]
  const redo = rows.filter(r => r.raw_lead_id && !(r.outreach_queue ?? []).length)
  if (!redo.length) return NextResponse.json({ ok: true, count: 0 })

  const rawIds = redo.map(r => r.raw_lead_id as string)
  const reset = await supabase.from('raw_leads').update({ status: 'raw', processed_at: null, disqualify_reason: null }).in('id', rawIds)
  if (reset.error) return NextResponse.json({ ok: false, error: reset.error.message }, { status: 500 })
  const removed = await supabase.from('leads').delete().in('id', redo.map(r => r.id))
  if (removed.error) return NextResponse.json({ ok: false, error: removed.error.message }, { status: 500 })

  const started = await callWebhook(WORKFLOW_WEBHOOK_MAP['WF-2-Processor'], { triggered_by: 'dashboard', reason: 'rescore' })
  return NextResponse.json({
    ok: true,
    count: redo.length,
    warning: started.ok ? undefined : `Leads were reset but WF-2 could not be started: ${started.error}`,
  })
}
