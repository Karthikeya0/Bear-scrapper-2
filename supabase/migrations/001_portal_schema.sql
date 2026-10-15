-- Bear Studios Client Portal — Schema Migration
-- Run this in the Supabase SQL editor

-- ============================================
-- USER PROFILES (role extension of auth.users)
-- ============================================
create table if not exists public.user_profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  role        text not null check (role in ('owner', 'editor', 'client')) default 'editor',
  display_name text,
  avatar_url  text,
  created_at  timestamptz default now()
);

alter table public.user_profiles enable row level security;

-- Owners can read all profiles; users can read/update their own
create policy "owner_all_profiles" on public.user_profiles
  for all using (
    exists (select 1 from public.user_profiles p where p.id = auth.uid() and p.role = 'owner')
  );
create policy "self_read_profile" on public.user_profiles
  for select using (id = auth.uid());
create policy "self_update_profile" on public.user_profiles
  for update using (id = auth.uid());

-- ============================================
-- CLIENTS
-- ============================================
create table if not exists public.clients (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid references auth.users(id),
  portal_user_id  uuid references auth.users(id), -- the client's login account (nullable)
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
    exists (select 1 from public.user_profiles p where p.id = auth.uid() and p.role = 'owner')
  );
-- Clients can see their own record
create policy "client_self" on public.clients
  for select using (portal_user_id = auth.uid());

-- ============================================
-- PROJECTS
-- ============================================
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

-- ============================================
-- TASKS
-- ============================================
create table if not exists public.tasks (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid references public.projects(id) on delete cascade,
  assigned_editor_id  uuid references auth.users(id),
  title               text not null,
  status              text not null check (status in ('todo', 'in_progress', 'review', 'delivered')) default 'todo',
  priority            text not null check (priority in ('low', 'medium', 'high', 'urgent')) default 'medium',
  notes               text,
  deadline            date,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

alter table public.tasks enable row level security;

create policy "owner_all_tasks" on public.tasks
  for all using (
    exists (select 1 from public.user_profiles p where p.id = auth.uid() and p.role = 'owner')
  );
-- Editors can see + update their assigned tasks
create policy "editor_assigned_tasks" on public.tasks
  for select using (assigned_editor_id = auth.uid());
create policy "editor_update_assigned" on public.tasks
  for update using (assigned_editor_id = auth.uid());

-- PROJECT POLICIES
create policy "owner_all_projects" on public.projects
  for all using (
    exists (select 1 from public.user_profiles p where p.id = auth.uid() and p.role = 'owner')
  );
-- Editors can see projects with tasks assigned to them
create policy "editor_assigned_projects" on public.projects
  for select using (
    exists (
      select 1 from public.tasks t
      where t.project_id = projects.id
      and t.assigned_editor_id = auth.uid()
    )
  );
-- Clients can see their own projects
create policy "client_own_projects" on public.projects
  for select using (
    exists (
      select 1 from public.clients c
      where c.id = projects.client_id
      and c.portal_user_id = auth.uid()
    )
  );

-- ============================================
-- COMMUNICATION LOG
-- ============================================
create table if not exists public.communications (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid references public.clients(id) on delete cascade,
  author_id   uuid references auth.users(id),
  direction   text check (direction in ('inbound', 'outbound', 'internal')),
  channel     text check (channel in ('email', 'portal', 'note', 'call')),
  subject     text,
  body        text,
  created_at  timestamptz default now()
);

alter table public.communications enable row level security;

create policy "owner_all_comms" on public.communications
  for all using (
    exists (select 1 from public.user_profiles p where p.id = auth.uid() and p.role = 'owner')
  );
create policy "client_own_comms" on public.communications
  for select using (
    exists (
      select 1 from public.clients c
      where c.id = communications.client_id
      and c.portal_user_id = auth.uid()
    )
  );
create policy "client_insert_comms" on public.communications
  for insert with check (
    exists (
      select 1 from public.clients c
      where c.id = communications.client_id
      and c.portal_user_id = auth.uid()
    )
  );

-- ============================================
-- HELPER: auto-create user_profiles on signup
-- ============================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.user_profiles (id, role, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'role', 'editor'), new.raw_user_meta_data->>'display_name');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================
-- SEED: mark yourself as owner
-- (run after you're logged in — replace with your actual user id)
-- ============================================
-- update public.user_profiles set role = 'owner' where id = '<your-user-uuid>';
