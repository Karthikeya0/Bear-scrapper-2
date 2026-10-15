-- ==============================================================================
-- Bear Studios — Unified Database Schema
-- Run this complete file in Supabase SQL Editor (https://supabase.com/dashboard/project/_/sql)
-- ==============================================================================

-- 1. Enable Required Extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pg_trgm";

-- ==============================================================================
-- PART A: USER PROFILES & ROLES
-- ==============================================================================

create table if not exists public.user_profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  role         text not null check (role in ('owner', 'editor', 'client')) default 'editor',
  display_name text,
  avatar_url   text,
  created_at   timestamptz default now()
);

alter table public.user_profiles enable row level security;

create policy "owner_all_profiles" on public.user_profiles
  for all using (
    exists (select 1 from public.user_profiles p where p.id = auth.uid() and p.role = 'owner')
  );

create policy "self_read_profile" on public.user_profiles
  for select using (id = auth.uid());

create policy "self_update_profile" on public.user_profiles
  for update using (id = auth.uid());

-- Automatically create user profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.user_profiles (id, display_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    'owner' -- Default first users to owner
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ==============================================================================
-- PART B: CLIENT PORTAL & PRODUCTION MANAGEMENT
-- ==============================================================================

create table if not exists public.clients (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid references auth.users(id),
  portal_user_id  uuid references auth.users(id),
  company         text not null,
  contact_name    text,
  contact_email   text,
  status          text not null check (status in ('lead', 'active', 'past')) default 'lead',
  contract_notes  text,
  monthly_value   numeric(10,2),
  currency        text default 'USD',
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

alter table public.clients enable row level security;

create policy "owner_all_clients" on public.clients
  for all using (
    exists (select 1 from public.user_profiles p where p.id = auth.uid() and p.role in ('owner', 'editor'))
  );

create policy "client_self" on public.clients
  for select using (portal_user_id = auth.uid());

create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid references public.clients(id) on delete cascade,
  title       text not null,
  description text,
  status      text not null check (status in ('todo', 'in_progress', 'review', 'delivered')) default 'todo',
  priority    text not null check (priority in ('low', 'medium', 'high', 'urgent')) default 'medium',
  deadline    date,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

alter table public.projects enable row level security;

create policy "team_all_projects" on public.projects
  for all using (
    exists (select 1 from public.user_profiles p where p.id = auth.uid() and p.role in ('owner', 'editor'))
  );

create policy "client_read_projects" on public.projects
  for select using (
    exists (select 1 from public.clients c where c.id = projects.client_id and c.portal_user_id = auth.uid())
  );

create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid references public.projects(id) on delete cascade,
  title       text not null,
  description text,
  status      text not null check (status in ('todo', 'in_progress', 'review', 'delivered')) default 'todo',
  priority    text not null check (priority in ('low', 'medium', 'high', 'urgent')) default 'medium',
  deadline    date,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

alter table public.tasks enable row level security;

create policy "team_all_tasks" on public.tasks
  for all using (
    exists (select 1 from public.user_profiles p where p.id = auth.uid() and p.role in ('owner', 'editor'))
  );

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

create policy "team_all_deliverables" on public.deliverables
  for all using (
    exists (select 1 from public.user_profiles p where p.id = auth.uid() and p.role in ('owner', 'editor'))
  );

create policy "client_read_update_deliverables" on public.deliverables
  for all using (
    exists (select 1 from public.clients c where c.id = deliverables.client_id and c.portal_user_id = auth.uid())
  );

create table if not exists public.communications (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid references public.clients(id) on delete cascade,
  author_id   uuid references auth.users(id),
  direction   text not null check (direction in ('inbound', 'outbound', 'internal')),
  channel     text not null default 'portal',
  subject     text,
  body        text not null,
  created_at  timestamptz default now()
);

alter table public.communications enable row level security;

create policy "team_all_comms" on public.communications
  for all using (
    exists (select 1 from public.user_profiles p where p.id = auth.uid() and p.role in ('owner', 'editor'))
  );

create policy "client_portal_comms" on public.communications
  for all using (
    exists (select 1 from public.clients c where c.id = communications.client_id and c.portal_user_id = auth.uid())
  );

-- ==============================================================================
-- PART C: LEAD GENERATION & N8N AUTOMATION PIPELINE
-- ==============================================================================

create table if not exists public.raw_leads (
  id          uuid primary key default gen_random_uuid(),
  source      text not null,
  source_id   text,
  name        text,
  company     text,
  email       text,
  domain      text,
  profile_url text,
  data        jsonb default '{}'::jsonb,
  created_at  timestamptz default now()
);

alter table public.raw_leads enable row level security;

create policy "team_all_raw_leads" on public.raw_leads
  for all using (true);

create index if not exists idx_raw_leads_email on public.raw_leads (email);
create index if not exists idx_raw_leads_profile_url on public.raw_leads (profile_url);

create table if not exists public.leads (
  id                 uuid primary key default gen_random_uuid(),
  name               text,
  company            text,
  email              text,
  source             text,
  source_id          text,
  profile_url        text,
  ai_score           integer default 0,
  status             text not null default 'scored' check (status in ('scored', 'contacted', 'replied', 'converted', 'dead', 'unsubscribed', 'disqualified')),
  outreach_eligible  boolean default true,
  enrichment_data    jsonb default '{}'::jsonb,
  score_breakdown    jsonb default '{}'::jsonb,
  notes              text,
  converted_at       timestamptz,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

alter table public.leads enable row level security;

create policy "team_all_leads" on public.leads
  for all using (true);

create index if not exists idx_leads_email on public.leads (email);
create index if not exists idx_leads_profile_url on public.leads (profile_url);
create index if not exists idx_leads_status on public.leads (status);
create index if not exists idx_leads_ai_score on public.leads (ai_score);

create table if not exists public.outreach_queue (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid not null references public.leads(id) on delete cascade,
  subject       text not null,
  body          text not null,
  status        text not null default 'pending_review' check (status in ('pending_review', 'approved', 'sent', 'rejected')),
  sequence_step integer default 1,
  approved_at   timestamptz,
  sent_at       timestamptz,
  rejected_at   timestamptz,
  created_at    timestamptz default now()
);

alter table public.outreach_queue enable row level security;

create policy "team_all_outreach" on public.outreach_queue
  for all using (true);

create index if not exists idx_outreach_status on public.outreach_queue (status);
create index if not exists idx_outreach_lead_id on public.outreach_queue (lead_id);

create table if not exists public.outreach_history (
  id             uuid primary key default gen_random_uuid(),
  lead_id        uuid not null references public.leads(id) on delete cascade,
  subject        text not null,
  body           text not null,
  sent_at        timestamptz default now(),
  open_count     integer default 0,
  reply_detected boolean default false
);

alter table public.outreach_history enable row level security;
create policy "team_all_outreach_history" on public.outreach_history for all using (true);

create table if not exists public.outreach_sequences (
  id         uuid primary key default gen_random_uuid(),
  lead_id    uuid not null references public.leads(id) on delete cascade,
  step       integer default 1,
  send_at    timestamptz not null,
  status     text default 'scheduled'
);

alter table public.outreach_sequences enable row level security;
create policy "team_all_outreach_sequences" on public.outreach_sequences for all using (true);

create table if not exists public.workflow_logs (
  id               uuid primary key default gen_random_uuid(),
  workflow_name    text not null,
  status           text not null check (status in ('success', 'failed', 'running')),
  leads_scraped    integer default 0,
  leads_skipped    integer default 0,
  leads_scored     integer default 0,
  emails_sent      integer default 0,
  replies_detected integer default 0,
  errors           jsonb,
  started_at       timestamptz default now(),
  finished_at      timestamptz
);

alter table public.workflow_logs enable row level security;
create policy "team_all_workflow_logs" on public.workflow_logs for all using (true);
create index if not exists idx_workflow_logs_started on public.workflow_logs (started_at desc);

create table if not exists public.settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz default now()
);

alter table public.settings enable row level security;
create policy "team_all_settings" on public.settings for all using (true);

create table if not exists public.email_templates (
  id               uuid primary key default gen_random_uuid(),
  key              text unique not null,
  name             text not null,
  subject_template text not null,
  body_template    text not null,
  active           boolean default true,
  created_at       timestamptz default now()
);

alter table public.email_templates enable row level security;
create policy "team_all_templates" on public.email_templates for all using (true);

create table if not exists public.prompt_examples (
  id                uuid primary key default gen_random_uuid(),
  lead_id           uuid references public.leads(id) on delete set null,
  subject           text not null,
  body              text not null,
  performance_notes text,
  created_at        timestamptz default now()
);

alter table public.prompt_examples enable row level security;
create policy "team_all_prompts" on public.prompt_examples for all using (true);

-- ==============================================================================
-- PART D: RPC FUNCTIONS (FUZZY DEDUPLICATION)
-- ==============================================================================

create or replace function public.fuzzy_lead_exists(p_domain text, p_name text)
returns table ("exists" boolean, lead_id uuid) as $$
begin
  return query
  select true, l.id
  from public.leads l
  where (
    (p_domain is not null and l.email ilike '%' || p_domain || '%')
    or (p_name is not null and similarity(l.name, p_name) > 0.7)
  )
  limit 1;
end;
$$ language plpgsql;

create or replace function public.fuzzy_raw_lead_exists(p_domain text, p_name text)
returns table ("exists" boolean, raw_lead_id uuid) as $$
begin
  return query
  select true, r.id
  from public.raw_leads r
  where (
    (p_domain is not null and r.email ilike '%' || p_domain || '%')
    or (p_name is not null and similarity(r.name, p_name) > 0.7)
  )
  limit 1;
end;
$$ language plpgsql;

-- ==============================================================================
-- PART E: INITIAL SEED CONFIGURATION
-- ==============================================================================

insert into public.settings (key, value)
values
  ('icp_filter', '{
    "min_score": 60,
    "sources": ["reddit", "producthunt", "yc", "twitter"],
    "exclude_domains": ["gmail.com", "yahoo.com", "hotmail.com"],
    "keywords_include": ["saas", "startup", "founder", "launch", "product", "funding"],
    "keywords_exclude": ["hiring", "job", "recruiter", "agency", "intern"]
  }'::jsonb),
  ('sending_limits', '{
    "daily_max": 25,
    "hourly_max": 3,
    "min_gap_minutes": 5,
    "send_window_start_hour": 9,
    "send_window_end_hour": 17,
    "send_on_weekends": false,
    "follow_up_days": [7, 14, 21]
  }'::jsonb)
on conflict (key) do nothing;

insert into public.email_templates (key, name, subject_template, body_template, active)
values
  ('initial_outreach', 'Initial Outreach', 'Quick idea for {{company}} content strategy', 'Hi {{name}},

I came across {{company}} on {{source}} and was really impressed by {{hook}}.

We help early-stage founders like you build content and video that actually converts — no generic stock footage, just sharp, high-impact creative.

Would love to share a quick 2-min concept we put together for a similar company last month. Worth a look?

Best,
Bear Studios', true),
  ('follow_up_1', 'Follow-up #1 (Day 7)', 'Re: content strategy for {{company}}', 'Hey {{name}},

Following up on my last note. Wanted to share a quick case study that might be relevant: our last client saw a 40% reduction in landing page bounce rates within 14 days of launch.

Open to a 15-min chat this week?

Cheers,
Bear Studios', true),
  ('follow_up_2', 'Follow-up #2 (Day 14)', 'Last note — {{company}} + Bear Studios', 'Hi {{name}},

I will keep this brief — if timing is not right, no worries at all. Just wanted to leave the door open.

We would love to help {{company}} with creative that moves the needle when you are ready. Here is our portfolio: bear.studio/work

Best,
Bear Studios', true)
on conflict (key) do nothing;
