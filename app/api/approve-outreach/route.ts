import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { APPROVE_AND_SEND_PATH, callWebhook } from '@/lib/n8n'

const MAX_SUBJECT = 300
const MAX_BODY = 20000

/**
 * Approves a queued email and hands it to n8n WF-3b ("approve-and-send"), which sends it via Gmail.
 * The row is marked approved first (n8n reads subject/body from the row), and rolled back to
 * pending_review if n8n cannot be reached so the email can be retried.
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole(['owner'])
  if (!auth.ok) return auth.response
  const { supabase } = auth

  const body = await request.json().catch(() => null)
  const outreach_id = typeof body?.outreach_id === 'string' ? body.outreach_id : ''
  const subject = typeof body?.subject === 'string' ? body.subject.trim() : undefined
  const emailBody = typeof body?.body === 'string' ? body.body.trim() : undefined

  if (!outreach_id) {
    return NextResponse.json({ ok: false, error: 'Missing outreach_id.' }, { status: 400 })
  }
  if (subject !== undefined && (!subject || subject.length > MAX_SUBJECT)) {
    return NextResponse.json({ ok: false, error: 'Subject is required (max 300 characters).' }, { status: 400 })
  }
  if (emailBody !== undefined && (!emailBody || emailBody.length > MAX_BODY)) {
    return NextResponse.json({ ok: false, error: 'Email body is required.' }, { status: 400 })
  }

  const approved_at = new Date().toISOString()
  const updates: Record<string, unknown> = { status: 'approved', approved_at }
  if (subject !== undefined) updates.subject = subject
  if (emailBody !== undefined) updates.body = emailBody

  // Only transition rows still awaiting review — prevents double sends from double clicks or two tabs.
  const { data: row, error: updateError } = await supabase
    .from('outreach_queue')
    .update(updates)
    .eq('id', outreach_id)
    .eq('status', 'pending_review')
    .select('id, lead_id')
    .maybeSingle()

  if (updateError) {
    return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 })
  }
  if (!row) {
    return NextResponse.json(
      { ok: false, error: 'This email is no longer pending review (it may already have been approved).' },
      { status: 409 },
    )
  }

  // Payload format is unchanged from the original integration: { outreach_id, lead_id, approved_at }.
  const result = await callWebhook(APPROVE_AND_SEND_PATH, { outreach_id: row.id, lead_id: row.lead_id, approved_at })

  if (!result.ok) {
    await supabase
      .from('outreach_queue')
      .update({ status: 'pending_review', approved_at: null })
      .eq('id', row.id)
      .eq('status', 'approved')
    console.error('[approve-outreach] n8n call failed:', result.error)
    return NextResponse.json(
      { ok: false, error: `${result.error} The email was returned to the review queue.` },
      { status: 502 },
    )
  }

  return NextResponse.json({ ok: true })
}
