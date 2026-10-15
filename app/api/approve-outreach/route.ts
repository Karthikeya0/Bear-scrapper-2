import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const { outreach_id, lead_id } = await request.json()

  if (!outreach_id || !lead_id) {
    return NextResponse.json({ error: 'Missing outreach_id or lead_id' }, { status: 400 })
  }

  const n8nUrl = `${process.env.N8N_BASE_URL}/webhook/approve-and-send`

  try {
    const response = await fetch(n8nUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Secret': process.env.N8N_WEBHOOK_SECRET || '',
      },
      body: JSON.stringify({ outreach_id, lead_id, approved_at: new Date().toISOString() }),
    })

    if (!response.ok) {
      return NextResponse.json({ ok: false, error: 'n8n webhook failed' }, { status: 502 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('approve-outreach error:', err)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
