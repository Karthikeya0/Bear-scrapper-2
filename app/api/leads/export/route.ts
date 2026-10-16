import ExcelJS from 'exceljs'
import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type QueueRow = { status: string | null; sent_at: string | null }
type LeadRow = {
  name: string | null; company: string | null; email: string | null; website: string | null
  x_handle: string | null; linkedin_url: string | null; source: string | null; ai_score: number | null
  status: string | null; team_size: number | null; launched_at: string | null; signals: unknown
  ai_reasoning: string | null; created_at: string | null; outreach_queue: QueueRow[] | null
}

const EMAILED = new Set(['contacted', 'replied', 'converted'])
const GREEN = 'FFD9F2E3'
const AMBER = 'FFFFF4D6'
const PAGE = 1000
const MAX_ROWS = 20000

function outreachStatus(lead: LeadRow): { label: string; fill: string | null } {
  const queue = lead.outreach_queue ?? []
  if (EMAILED.has(lead.status ?? '') || queue.some(q => q.status === 'sent')) return { label: 'Emailed', fill: GREEN }
  if (queue.some(q => q.status === 'pending_review' || q.status === 'approved')) return { label: 'Draft waiting for approval', fill: AMBER }
  return { label: 'Not contacted', fill: null }
}

/** Downloads every lead as an .xlsx; emailed leads are shaded green, drafted ones amber. */
export async function GET() {
  const auth = await requireRole(['owner'])
  if (!auth.ok) return auth.response

  const leads: LeadRow[] = []
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await auth.supabase
      .from('leads')
      .select('name, company, email, website, x_handle, linkedin_url, source, ai_score, status, team_size, launched_at, signals, ai_reasoning, created_at, outreach_queue(status, sent_at)')
      .order('created_at', { ascending: false })
      .range(from, from + PAGE - 1)
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    leads.push(...((data ?? []) as unknown as LeadRow[]))
    if (!data || data.length < PAGE) break
  }

  const wb = new ExcelJS.Workbook()
  wb.creator = 'Bear Studios'
  const ws = wb.addWorksheet('Leads', { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.columns = [
    { header: 'Outreach', key: 'outreach', width: 24 },
    { header: 'Name', key: 'name', width: 22 },
    { header: 'Company', key: 'company', width: 24 },
    { header: 'Email', key: 'email', width: 30 },
    { header: 'Website', key: 'website', width: 32 },
    { header: 'X', key: 'x', width: 18 },
    { header: 'LinkedIn', key: 'linkedin', width: 32 },
    { header: 'Source', key: 'source', width: 13 },
    { header: 'AI score', key: 'score', width: 10 },
    { header: 'Lead status', key: 'status', width: 14 },
    { header: 'Team size', key: 'team', width: 10 },
    { header: 'Launched', key: 'launched', width: 13 },
    { header: 'Signals', key: 'signals', width: 34 },
    { header: 'Why it qualified', key: 'reason', width: 60 },
    { header: 'Added', key: 'added', width: 13 },
  ]

  const day = (v: string | null) => (v ? new Date(v) : null)
  for (const l of leads) {
    const o = outreachStatus(l)
    const row = ws.addRow({
      outreach: o.label,
      name: l.name,
      company: l.company,
      email: l.email,
      website: l.website ? { text: l.website, hyperlink: l.website } : null,
      x: l.x_handle ? { text: `@${l.x_handle}`, hyperlink: `https://x.com/${l.x_handle}` } : null,
      linkedin: l.linkedin_url ? { text: l.linkedin_url, hyperlink: l.linkedin_url } : null,
      source: l.source,
      score: l.ai_score,
      status: l.status,
      team: l.team_size,
      launched: day(l.launched_at),
      signals: Array.isArray(l.signals) ? l.signals.join(', ') : null,
      reason: l.ai_reasoning,
      added: day(l.created_at),
    })
    if (o.fill) row.eachCell({ includeEmpty: true }, c => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: o.fill! } }))
  }

  const header = ws.getRow(1)
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  header.eachCell(c => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF18181B' } }))
  ws.getColumn('launched').numFmt = 'dd mmm yyyy'
  ws.getColumn('added').numFmt = 'dd mmm yyyy'
  ws.autoFilter = { from: 'A1', to: 'O1' }

  const buffer = await wb.xlsx.writeBuffer()
  const stamp = new Date().toISOString().slice(0, 10)
  return new NextResponse(Buffer.from(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="bear-leads-${stamp}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  })
}
