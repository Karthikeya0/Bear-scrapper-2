import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { callWebhook, WORKFLOW_WEBHOOK_MAP } from '@/lib/n8n'
import { audit, loadSettings } from '@/lib/settings'

// Allowed while paused: reading replies (and RESUME commands) and the digest only report, they never send to leads.
const ALLOWED_WHILE_PAUSED = new Set(['WF-4-ReplyMonitor', 'WF-6-Digest'])

export async function POST(request: NextRequest) {
  const auth = await requireRole(['owner'])
  if (!auth.ok) return auth.response

  const body = await request.json().catch(() => null)
  const workflow = typeof body?.workflow === 'string' ? body.workflow : ''
  const webhookPath = WORKFLOW_WEBHOOK_MAP[workflow]
  if (!webhookPath) {
    return NextResponse.json({ ok: false, error: 'Unknown workflow.' }, { status: 400 })
  }

  if (!ALLOWED_WHILE_PAUSED.has(workflow)) {
    const { settings } = await loadSettings(auth.supabase)
    if (settings.paused) {
      return NextResponse.json({ ok: false, error: 'Outreach is paused (STOP ALL). Resume it from the banner at the top or in Settings first.' }, { status: 423 })
    }
  }

  // Payload format is unchanged from the original integration.
  const result = await callWebhook(webhookPath, {
    triggered_by: 'dashboard',
    timestamp: new Date().toISOString(),
  })

  if (!result.ok) {
    console.error(`[trigger] ${workflow} failed:`, result.error)
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status >= 400 ? result.status : 502 })
  }
  await audit(auth.supabase, 'workflow_started', { workflow })
  return NextResponse.json({ ok: true, status: result.status })
}
