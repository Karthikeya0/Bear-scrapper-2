import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// SOP section 3 columns A–N (plus O "Niche"), in order. Same layout WF-P5 writes to the Google Sheet,
// so this CSV can also be imported into the sheet by hand (File → Import).
const COLUMNS: [string, (r: Row) => unknown][] = [
  ['Date added', r => (r.created_at ? r.created_at.slice(0, 10) : '')],
  ['Podcast name', r => r.podcast_name],
  ['Host name', r => r.host_name],
  ['YouTube channel URL', r => r.youtube_channel_url],
  ['Instagram URL', r => r.instagram_url],
  ['Host YouTube / other account', r => r.host_other_url || 'same'],
  ['Sample episode URL', r => r.sample_episode_url],
  ['Subscribers', r => r.subscribers],
  ['Uploads per month', r => r.uploads_30d],
  ['Has shorts?', r => r.has_shorts],
  ['Contact method', r => [r.contact_method, r.email].filter(Boolean).join(' · ')],
  ['Why a fit', r => r.why_fit],
  ['Status', r => r.status],
  ['Added by', r => r.added_by],
  ['Niche', r => r.niche],
]

type Row = Record<string, string | number | null> & { created_at: string | null }

function cell(v: unknown) {
  let s = v === null || v === undefined ? '' : String(v)
  // Spreadsheet formula injection guard.
  if (/^[=+\-@]/.test(s)) s = `'${s}`
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export async function GET() {
  const auth = await requireRole(['owner'])
  if (!auth.ok) return auth.response
  const { data, error } = await auth.supabase
    .from('podcast_leads')
    .select('*')
    .eq('stage', 'qualified')
    .order('created_at', { ascending: true })
    .limit(10000)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  const lines = [COLUMNS.map(c => c[0]).map(cell).join(','), ...((data ?? []) as Row[]).map(r => COLUMNS.map(([, f]) => cell(f(r))).join(','))]
  const day = new Date().toISOString().slice(0, 10)
  return new NextResponse('﻿' + lines.join('\r\n') + '\r\n', {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="podcast-leads-${day}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
