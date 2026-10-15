import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { APPROVE_AND_SEND_PATH, WORKFLOW_WEBHOOK_MAP, n8nConfig, pingN8n, probeWebhook } from '@/lib/n8n'

export const dynamic = 'force-dynamic'

/** Reports integration health without revealing any secret values. */
export async function GET() {
  const auth = await requireRole(['owner'])
  if (!auth.ok) return auth.response

  const config = n8nConfig()
  const ping = config.baseUrlConfigured ? await pingN8n() : { reachable: false, error: 'N8N_BASE_URL is not set.' }

  // Which webhook paths n8n actually has registered (non-executing probe).
  const targets = [['WF-3b-SendApproved', APPROVE_AND_SEND_PATH], ...Object.entries(WORKFLOW_WEBHOOK_MAP)]
  const webhooks = ping.reachable
    ? await Promise.all(targets.map(async ([workflow, path]) => ({ workflow, path, ...(await probeWebhook(path)) })))
    : []

  // A cheap authenticated query proves the DB schema + RLS work for this user.
  const { error: dbError } = await auth.supabase.from('leads').select('id', { count: 'exact', head: true })

  return NextResponse.json({
    supabase: { connected: !dbError, error: dbError?.message },
    n8n: {
      baseUrlConfigured: config.baseUrlConfigured,
      secretConfigured: config.secretConfigured,
      reachable: ping.reachable,
      error: ping.error,
      webhooks,
    },
  })
}
