import 'server-only'

// Webhook paths registered in n8n. These must stay in sync with the n8n workflows — do not rename.
export const APPROVE_AND_SEND_PATH = 'approve-and-send'

export const WORKFLOW_WEBHOOK_MAP: Record<string, string> = {
  'WF-1-Scraper': 'wf1-scraper',
  'WF-2-Processor': 'wf2-processor',
  'WF-3-Outreach': 'wf3-outreach',
  'WF-4-ReplyMonitor': 'wf4-reply-monitor',
  'WF-5-Feedback': 'wf5-feedback',
  'WF-6-Digest': 'wf6-digest',
}

export type N8nResult = { ok: boolean; status: number; error?: string; url?: string }

function baseUrl(): string {
  return (process.env.N8N_BASE_URL ?? '').trim().replace(/\/+$/, '')
}

function secret(): string {
  return process.env.N8N_WEBHOOK_SECRET ?? ''
}

export function n8nConfig() {
  return { baseUrlConfigured: baseUrl().length > 0, secretConfigured: secret().length > 0 }
}

/**
 * POSTs a JSON payload to an n8n production webhook, authenticated with the shared
 * X-Webhook-Secret header (validated inside the n8n workflow).
 */
export async function callWebhook(path: string, payload: Record<string, unknown>, timeoutMs = 15000): Promise<N8nResult> {
  const base = baseUrl()
  if (!base) return { ok: false, status: 503, error: 'N8N_BASE_URL is not set on the server.' }
  if (!secret()) return { ok: false, status: 503, error: 'N8N_WEBHOOK_SECRET is not set on the server.' }

  const url = `${base}/webhook/${path}`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': secret() },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    })
    if (res.ok) return { ok: true, status: res.status }

    const text = (await res.text().catch(() => '')).slice(0, 400)
    let error = `n8n responded with HTTP ${res.status}.`
    if (res.status === 404) {
      error = /not registered for POST/i.test(text)
        ? `n8n has a webhook at "/webhook/${path}" but not for POST. Set that Webhook node's HTTP Method to POST.`
        : `n8n has no active webhook at "/webhook/${path}". The workflow needs a Webhook trigger node ` +
          `(HTTP Method POST, Path "${path}") and must be published/active in n8n.`
    } else if (res.status === 401 || res.status === 403) {
      error = `n8n rejected the request for "/webhook/${path}" (HTTP ${res.status}). Check that N8N_WEBHOOK_SECRET matches the secret configured in n8n.`
    } else if (text) {
      error += ` ${text}`
    }
    return { ok: false, status: res.status, error }
  } catch (err) {
    const reason = err instanceof Error && err.name === 'TimeoutError' ? `timed out after ${timeoutMs / 1000}s` : String(err)
    return { ok: false, status: 502, error: `Could not reach n8n (${reason}).` }
  }
}

export type WebhookState = 'ready' | 'missing' | 'wrong_method' | 'unknown'

/**
 * Checks whether a POST webhook is registered WITHOUT running its workflow: sends a GET with no
 * secret. For a POST-only webhook n8n answers 404 "not registered for GET requests. Did you mean
 * … POST"; for an unknown path it answers 404 "… is not registered". Never sends the secret, so a
 * secret-protected workflow cannot be started by this probe.
 */
export async function probeWebhook(path: string): Promise<{ state: WebhookState; detail?: string }> {
  const base = baseUrl()
  if (!base) return { state: 'unknown', detail: 'N8N_BASE_URL is not set.' }
  try {
    const res = await fetch(`${base}/webhook/${path}`, { method: 'GET', signal: AbortSignal.timeout(5000), cache: 'no-store' })
    const text = (await res.text().catch(() => '')).slice(0, 400)
    if (res.status === 404 && /not registered for GET/i.test(text)) {
      return /POST/.test(text) ? { state: 'ready' } : { state: 'wrong_method', detail: 'Registered, but not for POST.' }
    }
    if (res.status === 404) return { state: 'missing' }
    // Anything else means a GET webhook exists at this path; the app sends POST.
    return { state: 'wrong_method', detail: `Responds to GET (HTTP ${res.status}); the app sends POST.` }
  } catch (err) {
    return { state: 'unknown', detail: err instanceof Error ? err.message : String(err) }
  }
}

/** Lightweight reachability probe using n8n's built-in /healthz endpoint. */
export async function pingN8n(): Promise<{ reachable: boolean; status?: number; error?: string }> {
  const base = baseUrl()
  if (!base) return { reachable: false, error: 'N8N_BASE_URL is not set.' }
  try {
    const res = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(5000), cache: 'no-store' })
    return { reachable: res.ok, status: res.status, error: res.ok ? undefined : `HTTP ${res.status}` }
  } catch (err) {
    return { reachable: false, error: err instanceof Error ? err.message : String(err) }
  }
}
