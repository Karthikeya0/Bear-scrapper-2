import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { PODCAST_DO_NOT_CONTACT } from '@/lib/podcast'
import { audit } from '@/lib/settings'

/**
 * "Approve all" for podcast emails: every email draft waiting for review moves to "scheduled".
 * WF-P3b then sends one every 10 minutes inside the send window, at most the podcast daily limit a day.
 */
export async function POST() {
  const auth = await requireRole(['owner'])
  if (!auth.ok) return auth.response
  const { supabase } = auth

  const { data, error } = await supabase
    .from('podcast_outreach')
    .select('id, channel, podcast:podcast_leads(email, status)')
    .eq('status', 'pending_review')
    .eq('channel', 'email')
    .limit(1000)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  type Row = { id: string; podcast: { email: string | null; status: string } | null }
  const ids = ((data ?? []) as unknown as Row[]).filter(r => r.podcast?.email && !PODCAST_DO_NOT_CONTACT.has(r.podcast.status)).map(r => r.id)
  if (!ids.length) return NextResponse.json({ ok: true, count: 0 })

  const { error: updateError } = await supabase
    .from('podcast_outreach')
    .update({ status: 'scheduled', approved_at: new Date().toISOString() })
    .in('id', ids)
    .eq('status', 'pending_review')
  if (updateError) return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 })
  await audit(supabase, 'podcast_approved_all', { via: 'dashboard', count: ids.length })
  return NextResponse.json({ ok: true, count: ids.length })
}
