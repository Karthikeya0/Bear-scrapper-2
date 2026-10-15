import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { n8nConfig, pingN8n } from '@/lib/n8n'

export const dynamic = 'force-dynamic'

/** Reports integration health without revealing any secret values. */
export async function GET() {
  const auth = await requireRole(['owner'])
  if (!auth.ok) return auth.response

  const config = n8nConfig()
  const ping = config.baseUrlConfigured ? await pingN8n() : { reachable: false, error: 'N8N_BASE_URL is not set.' }

  // A cheap authenticated query proves the DB schema + RLS work for this user.
  const { error: dbError } = await auth.supabase.from('leads').select('id', { count: 'exact', head: true })

  return NextResponse.json({
    supabase: { connected: !dbError, error: dbError?.message },
    n8n: {
      baseUrlConfigured: config.baseUrlConfigured,
      secretConfigured: config.secretConfigured,
      reachable: ping.reachable,
      error: ping.error,
    },
  })
}
