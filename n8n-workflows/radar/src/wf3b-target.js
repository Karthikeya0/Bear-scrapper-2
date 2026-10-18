// WF-3b "Target" (Code node, Run Once for All Items).
// The one email to send: from the dashboard webhook, or the row just claimed by the scheduler.
const hook = $('Dashboard: Approve & send')
const id = hook.isExecuted ? hook.first().json.body?.outreach_id : $input.all().map(i => i.json).find(r => r && r.id)?.id
return id ? [{ json: { outreach_id: id } }] : []
