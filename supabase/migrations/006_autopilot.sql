-- Bear Radar autopilot: an audit log of every automated or owner action.
-- Additive and safe to run more than once. Nothing is deleted.
--
-- Written by n8n (service role) and by the dashboard (owner). Rows are never updated or deleted by the app.
--   actor:  'n8n:WF-6' | 'n8n:WF-4' | 'n8n:WF-3' | 'dashboard' | 'owner-email'
--   action: 'digest_sent' | 'owner_command' | 'auto_scheduled' | 'approved' | 'approved_all' | 'paused' | 'resumed' | ...

create table if not exists public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  actor       text not null,
  action      text not null,
  lead_id     uuid references public.leads(id) on delete set null,
  outreach_id uuid references public.outreach_queue(id) on delete set null,
  details     jsonb not null default '{}'::jsonb
);

create index if not exists idx_audit_log_created on public.audit_log (created_at desc);
create index if not exists idx_audit_log_action on public.audit_log (action, created_at desc);

alter table public.audit_log enable row level security;

drop policy if exists audit_log_owner_read on public.audit_log;
drop policy if exists audit_log_owner_insert on public.audit_log;
create policy audit_log_owner_read   on public.audit_log for select to authenticated using (public.is_owner());
create policy audit_log_owner_insert on public.audit_log for insert to authenticated with check (public.is_owner());
-- No update/delete policies: the log is append-only for dashboard users. n8n uses the service role.
