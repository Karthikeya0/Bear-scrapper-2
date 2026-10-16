import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { DO_NOT_CONTACT } from '@/lib/outreach'

/**
 * "Approve all": moves every email draft waiting for review (with an address to send to) to
 * "scheduled". WF-3b then sends them one at a time inside its send window and daily limit.
 * DMs are not included — you send those yourself.
 */
export async function POST() {
  const auth = await requireRole(['owner'])
  if (!auth.ok) return auth.response
  const { supabase } = auth

  const { data, error } = await supabase
    .from('outreach_queue')
    .select('id, channel, lead:leads(email, status)')
    .eq('status', 'pending_review')
    .limit(1000)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  type Row = { id: string; channel: string | null; lead: { email: string | null; status: string | null } | null }
  const ids = ((data ?? []) as unknown as Row[])
    .filter(r => (r.channel ?? 'email') === 'email' && r.lead?.email && !DO_NOT_CONTACT.has(r.lead.status ?? ''))
    .map(r => r.id)
  if (!ids.length) return NextResponse.json({ ok: true, count: 0 })

  const { error: updateError } = await supabase
    .from('outreach_queue')
    .update({ status: 'scheduled', approved_at: new Date().toISOString() })
    .in('id', ids)
    .eq('status', 'pending_review')
  if (updateError) return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 })
  return NextResponse.json({ ok: true, count: ids.length })
}
