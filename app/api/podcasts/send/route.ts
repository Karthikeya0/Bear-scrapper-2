import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { callWebhook, PODCAST_SEND_PATH } from '@/lib/n8n'
import { loadPodcastSettings, startOfDayIso } from '@/lib/podcast'
import { audit, loadSettings } from '@/lib/settings'

/**
 * "Approve & send" for one podcast email. Marks the row approved, then hands it to n8n WF-P3b, which
 * sends it from Gmail. Refused once today's podcast limit (default 10) is reached; WF-P3b checks it again.
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole(['owner'])
  if (!auth.ok) return auth.response
  const { supabase } = auth

  const body = await request.json().catch(() => null)
  const outreach_id = typeof body?.outreach_id === 'string' ? body.outreach_id : ''
  const subject = typeof body?.subject === 'string' ? body.subject.trim() : undefined
  const text = typeof body?.body === 'string' ? body.body.trim() : undefined
  if (!outreach_id) return NextResponse.json({ ok: false, error: 'Missing outreach_id.' }, { status: 400 })
  if (subject !== undefined && (!subject || subject.length > 300)) return NextResponse.json({ ok: false, error: 'Subject is required (max 300 characters).' }, { status: 400 })
  if (text !== undefined && (!text || text.length > 20000)) return NextResponse.json({ ok: false, error: 'Email body is required.' }, { status: 400 })

  const [{ settings }, { settings: podcast }] = await Promise.all([loadSettings(supabase), loadPodcastSettings(supabase)])
  if (settings.paused) {
    return NextResponse.json({ ok: false, error: 'Outreach is paused (STOP ALL). Resume it first.' }, { status: 423 })
  }
  const { count } = await supabase
    .from('podcast_outreach')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'sent')
    .eq('channel', 'email')
    .gte('sent_at', startOfDayIso(settings.timezone))
  if ((count ?? 0) >= podcast.daily_max) {
    return NextResponse.json(
      { ok: false, error: `Today's podcast limit is reached (${count}/${podcast.daily_max}). Use "Approve all" to schedule it; it goes out on the next sending day.` },
      { status: 429 },
    )
  }

  const updates: Record<string, unknown> = { status: 'approved', approved_at: new Date().toISOString(), error: null }
  if (subject !== undefined) updates.subject = subject
  if (text !== undefined) updates.body = text
  const { data: row, error } = await supabase
    .from('podcast_outreach')
    .update(updates)
    .eq('id', outreach_id)
    .in('status', ['pending_review', 'scheduled'])
    .eq('channel', 'email')
    .select('id, podcast_id')
    .maybeSingle()
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  if (!row) return NextResponse.json({ ok: false, error: 'This email is no longer waiting to be sent (already sent, or it is a DM).' }, { status: 409 })

  const result = await callWebhook(PODCAST_SEND_PATH, { outreach_id: row.id, podcast_id: row.podcast_id })
  if (!result.ok) {
    await supabase.from('podcast_outreach').update({ status: 'pending_review', approved_at: null }).eq('id', row.id).eq('status', 'approved')
    return NextResponse.json({ ok: false, error: `${result.error} The email was returned to the review queue.` }, { status: 502 })
  }
  await audit(supabase, 'podcast_approved', { via: 'dashboard', outreach_id: row.id, podcast_id: row.podcast_id })
  return NextResponse.json({ ok: true, sent_today: (count ?? 0) + 1, daily_max: podcast.daily_max })
}
