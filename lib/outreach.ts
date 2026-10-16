/** Shared outreach rules, used by the dashboard and API routes (the n8n Config nodes hold the same defaults). */

/** WF-3 only drafts for leads at or above this AI score. */
export const MIN_SCORE = 60

/** WF-2 saves a lead with score 0 and one of these reasons when its Groq call fails (e.g. rate limit). */
export const FAILED_SCORING_PATTERNS = ['Groq error:%', 'Could not parse AI score%']

export function scoringFailed(reasoning: string | null | undefined) {
  return /^(Groq error:|Could not parse AI score)/.test(reasoning ?? '')
}

/** Lead statuses that must never receive another email. */
export const DO_NOT_CONTACT = new Set(['replied', 'bounced', 'unsubscribed', 'dead'])
