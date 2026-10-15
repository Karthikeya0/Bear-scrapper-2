-- ==============================================================================
-- 002 — n8n compatibility (ADDITIVE ONLY, safe to re-run)
--
-- The n8n workflows (WF-1 … WF-5) read/write columns that were missing from
-- schema.sql, so those inserts/updates failed at the database. This migration
-- adds the missing columns and relaxes constraints so the workflows work
-- WITHOUT any change to n8n. Nothing is dropped or renamed.
-- ==============================================================================

-- ---------- raw_leads (WF-1 inserts, WF-2 reads/updates) ----------
alter table public.raw_leads add column if not exists company_domain text;
alter table public.raw_leads add column if not exists bio           text;
alter table public.raw_leads add column if not exists post_content  text;
alter table public.raw_leads add column if not exists raw_json      jsonb;
alter table public.raw_leads add column if not exists status        text default 'raw';
alter table public.raw_leads add column if not exists processed_at  timestamptz;
update public.raw_leads set status = 'raw' where status is null;
create index if not exists idx_raw_leads_status on public.raw_leads (status);

-- ---------- leads (WF-2 inserts, WF-3b/WF-4 update, WF-5 reads/updates) ----------
alter table public.leads add column if not exists raw_lead_id        uuid;
alter table public.leads add column if not exists company_domain     text;
alter table public.leads add column if not exists bio                text;
alter table public.leads add column if not exists post_content       text;
alter table public.leads add column if not exists ai_reasoning       text;
alter table public.leads add column if not exists ai_signals         jsonb default '[]'::jsonb;
alter table public.leads add column if not exists first_contacted_at timestamptz;
alter table public.leads add column if not exists replied_at         timestamptz;
alter table public.leads add column if not exists feedback_exported  boolean default false;
update public.leads set feedback_exported = false where feedback_exported is null;

-- WF-5 uses the 'bounced' status.
alter table public.leads drop constraint if exists leads_status_check;
alter table public.leads add constraint leads_status_check check (status in
  ('scored', 'contacted', 'replied', 'converted', 'dead', 'unsubscribed', 'disqualified', 'bounced'));

-- ---------- outreach_history (WF-3b inserts, WF-4 reads) ----------
alter table public.outreach_history add column if not exists outreach_id   uuid;
alter table public.outreach_history add column if not exists thread_id     text;
alter table public.outreach_history add column if not exists message_id    text;
alter table public.outreach_history add column if not exists body_sent     text;
alter table public.outreach_history add column if not exists sequence_step integer default 1;
alter table public.outreach_history add column if not exists lead_status   text default 'contacted';
-- WF-3b writes body_sent (not body), so body must be optional.
alter table public.outreach_history alter column body drop not null;
alter table public.outreach_history alter column subject drop not null;
create index if not exists idx_outreach_history_thread on public.outreach_history (thread_id);
create index if not exists idx_outreach_history_lead on public.outreach_history (lead_id);

-- ---------- outreach_sequences (WF-3b inserts, WF-4 updates) ----------
alter table public.outreach_sequences add column if not exists sequence_step integer;
alter table public.outreach_sequences add column if not exists template_key  text;
alter table public.outreach_sequences add column if not exists sent          boolean default false;
alter table public.outreach_sequences add column if not exists cancelled     boolean default false;
alter table public.outreach_sequences add column if not exists cancel_reason text;
alter table public.outreach_sequences add column if not exists created_at    timestamptz default now();
update public.outreach_sequences set sent = false where sent is null;
update public.outreach_sequences set cancelled = false where cancelled is null;

-- ---------- prompt_examples (WF-5 inserts) ----------
alter table public.prompt_examples add column if not exists lead_bio      text;
alter table public.prompt_examples add column if not exists post_content  text;
alter table public.prompt_examples add column if not exists outcome       text;
alter table public.prompt_examples add column if not exists outcome_label numeric;
alter table public.prompt_examples alter column subject drop not null;
alter table public.prompt_examples alter column body drop not null;

-- ---------- Client-portal tables: reconcile schema.sql vs 001_portal_schema.sql ----------
alter table public.tasks add column if not exists description        text;
alter table public.tasks add column if not exists notes              text;
alter table public.tasks add column if not exists assigned_editor_id uuid references auth.users(id);
alter table public.communications add column if not exists subject text;
-- 001 restricted channel to a fixed list; the dashboard also logs Slack messages.
alter table public.communications drop constraint if exists communications_channel_check;
alter table public.communications add constraint communications_channel_check
  check (channel in ('email', 'portal', 'note', 'call', 'slack'));

create table if not exists public.deliverables (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid references public.projects(id) on delete cascade,
  client_id   uuid references public.clients(id) on delete cascade,
  title       text not null,
  file_url    text not null,
  file_type   text,
  status      text not null check (status in ('review', 'approved', 'revision_requested')) default 'review',
  notes       text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
alter table public.deliverables enable row level security;

-- ---------- Realtime for live dashboard updates ----------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['leads', 'outreach_queue', 'workflow_logs', 'tasks'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- ---------- Defensive: WF-2 may pass status = null/'raw' when inserting a lead ----------
create or replace function public.normalize_lead_status()
returns trigger language plpgsql as $$
begin
  if new.status is null or new.status not in
     ('scored', 'contacted', 'replied', 'converted', 'dead', 'unsubscribed', 'disqualified', 'bounced') then
    new.status := 'scored';
  end if;
  if new.ai_signals is not null and jsonb_typeof(new.ai_signals) = 'string' then
    -- n8n sometimes serialises arrays to a JSON string; unwrap it.
    begin
      new.ai_signals := (new.ai_signals #>> '{}')::jsonb;
    exception when others then
      null;
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_normalize_lead_status on public.leads;
create trigger trg_normalize_lead_status
  before insert on public.leads
  for each row execute procedure public.normalize_lead_status();
