import { NextRequest, NextResponse } from 'next/server'

const WORKFLOW_WEBHOOK_MAP: Record<string, string> = {
  'WF-1-Scraper':       'wf1-scraper',
  'WF-2-Processor':     'wf2-processor',
  'WF-3-Outreach':      'wf3-outreach',
  'WF-4-ReplyMonitor':  'wf4-reply-monitor',
  'WF-5-Feedback':      'wf5-feedback',
}

export async function POST(request: NextRequest) {
  const { workflow } = await request.json()

  const webhookPath = WORKFLOW_WEBHOOK_MAP[workflow]
  if (!webhookPath) {
    return NextResponse.json({ error: 'Unknown workflow' }, { status: 400 })
  }

  const n8nUrl = `${process.env.N8N_BASE_URL}/webhook/${webhookPath}`

  try {
    const response = await fetch(n8nUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Secret': process.env.N8N_WEBHOOK_SECRET || '',
      },
      body: JSON.stringify({ triggered_by: 'dashboard', timestamp: new Date().toISOString() }),
    })

    return NextResponse.json({ ok: true, status: response.status })
  } catch (err) {
    console.error('n8n trigger error:', err)
    // Return 200 anyway — n8n might not be reachable right now
    return NextResponse.json({ ok: false, error: String(err) })
  }
}
