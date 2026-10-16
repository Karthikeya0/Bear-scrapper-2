// WF-3b "Send result" (Code node, Run Once for Each Item).
// Normalises the output of either Gmail node (new email or reply in thread).
const r = $json || {}
return {
  json: {
    ok: !!r.id && !r.error,
    message_id: r.id || null,
    thread_id: r.threadId || null,
    error: r.error ? String(r.error.message || r.error).slice(0, 300) : null,
  },
}
