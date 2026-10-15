-- ==============================================================================
-- 003 — Security hardening for Row Level Security (safe to re-run)
--
-- Fixes:
--  1. The "owner_all_profiles" policy queried user_profiles from inside a
--     user_profiles policy → "infinite recursion detected in policy" (42P17).
--     Every policy that checked roles failed with it, breaking clients/projects/tasks.
--  2. Lead-gen tables used `using (true)`, so ANYONE holding the public anon key
--     (it ships to every browser) could read/modify leads, outreach and settings.
--  3. New sign-ups became 'owner' (schema.sql) or could pick their own role via
--     signup metadata (001). New users now start as 'pending' (no access) —
--     except the very first user, who becomes owner.
--  4. Users could update their own profile row, including promoting their role.
--
-- IMPORTANT: n8n and the check-lead-exists Edge Function must use the
-- SERVICE ROLE key (it bypasses RLS). Verify that before running this file.
-- ==============================================================================

-- ---------- Role helpers (SECURITY DEFINER → no RLS recursion) ----------
create or replace function public.current_user_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.user_profiles where id = auth.uid()
$$;

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_user_role() = 'owner', false)
$$;

create or replace function public.is_team()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_user_role() in ('owner', 'editor'), false)
$$;

create or replace function public.is_client_of(p_client_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.clients c where c.id = p_client_id and c.portal_user_id = auth.uid())
$$;

revoke all on function public.current_user_role() from public, anon;
revoke all on function public.is_owner() from public, anon;
revoke all on function public.is_team() from public, anon;
revoke all on function public.is_client_of(uuid) from public, anon;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.is_owner() to authenticated;
grant execute on function public.is_team() to authenticated;
grant execute on function public.is_client_of(uuid) to authenticated;

-- ---------- 'pending' role for unapproved sign-ups ----------
alter table public.user_profiles drop constraint if exists user_profiles_role_check;
alter table public.user_profiles add constraint user_profiles_role_check
  check (role in ('owner', 'editor', 'client', 'pending'));
alter table public.user_profiles alter column role set default 'pending';

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  has_owner boolean;
begin
  select exists (select 1 from public.user_profiles where role = 'owner') into has_owner;
  insert into public.user_profiles (id, display_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'display_name', new.email),
    case when has_owner then 'pending' else 'owner' end  -- never trust client-supplied metadata for roles
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Backfill profiles for any auth users created before the trigger existed.
insert into public.user_profiles (id, display_name, role)
select u.id, u.email, 'pending' from auth.users u
where not exists (select 1 from public.user_profiles p where p.id = u.id)
on conflict (id) do nothing;

-- Only owners may change roles (service role / SQL editor have auth.uid() = null and are allowed).
create or replace function public.guard_role_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and auth.uid() is not null and not public.is_owner() then
    raise exception 'Only an owner can change user roles';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_role_change on public.user_profiles;
create trigger trg_guard_role_change
  before update on public.user_profiles
  for each row execute procedure public.guard_role_change();

-- ---------- Drop every old policy (names from schema.sql and 001) ----------
do $$
declare r record;
begin
  for r in
    select policyname, tablename from pg_policies
    where schemaname = 'public' and tablename in (
      'user_profiles', 'clients', 'projects', 'tasks', 'deliverables', 'communications',
      'raw_leads', 'leads', 'outreach_queue', 'outreach_history', 'outreach_sequences',
      'workflow_logs', 'settings', 'email_templates', 'prompt_examples')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- Make sure RLS is on everywhere.
alter table public.user_profiles      enable row level security;
alter table public.clients            enable row level security;
alter table public.projects           enable row level security;
alter table public.tasks              enable row level security;
alter table public.deliverables       enable row level security;
alter table public.communications     enable row level security;
alter table public.raw_leads          enable row level security;
alter table public.leads              enable row level security;
alter table public.outreach_queue     enable row level security;
alter table public.outreach_history   enable row level security;
alter table public.outreach_sequences enable row level security;
alter table public.workflow_logs      enable row level security;
alter table public.settings           enable row level security;
alter table public.email_templates    enable row level security;
alter table public.prompt_examples    enable row level security;

-- ---------- user_profiles ----------
create policy profiles_self_read   on public.user_profiles for select to authenticated using (id = auth.uid());
create policy profiles_owner_all   on public.user_profiles for all    to authenticated using (public.is_owner()) with check (public.is_owner());
create policy profiles_self_update on public.user_profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- ---------- Studio / client-portal tables ----------
create policy clients_team_all   on public.clients for all    to authenticated using (public.is_team()) with check (public.is_team());
create policy clients_portal_own on public.clients for select to authenticated using (portal_user_id = auth.uid());

create policy projects_team_all   on public.projects for all    to authenticated using (public.is_team()) with check (public.is_team());
create policy projects_portal_own on public.projects for select to authenticated using (public.is_client_of(client_id));

create policy tasks_team_all on public.tasks for all to authenticated using (public.is_team()) with check (public.is_team());

create policy deliverables_team_all    on public.deliverables for all    to authenticated using (public.is_team()) with check (public.is_team());
create policy deliverables_portal_read on public.deliverables for select to authenticated using (public.is_client_of(client_id));
create policy deliverables_portal_review on public.deliverables for update to authenticated
  using (public.is_client_of(client_id)) with check (public.is_client_of(client_id));

create policy comms_team_all      on public.communications for all    to authenticated using (public.is_team()) with check (public.is_team());
create policy comms_portal_read   on public.communications for select to authenticated
  using (public.is_client_of(client_id) and direction <> 'internal');  -- internal notes stay internal
create policy comms_portal_insert on public.communications for insert to authenticated
  with check (public.is_client_of(client_id) and direction = 'inbound' and author_id = auth.uid());

-- ---------- Lead-gen pipeline (n8n writes with the service role, which bypasses RLS) ----------
create policy raw_leads_owner_all on public.raw_leads for all to authenticated using (public.is_owner()) with check (public.is_owner());

create policy leads_team_read on public.leads for select to authenticated using (public.is_team());
create policy leads_owner_all on public.leads for all    to authenticated using (public.is_owner()) with check (public.is_owner());

create policy outreach_queue_owner_all     on public.outreach_queue     for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy outreach_history_owner_all   on public.outreach_history   for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy outreach_sequences_owner_all on public.outreach_sequences for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy workflow_logs_owner_all      on public.workflow_logs      for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy settings_owner_all           on public.settings           for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy email_templates_owner_all    on public.email_templates    for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy prompt_examples_owner_all    on public.prompt_examples    for all to authenticated using (public.is_owner()) with check (public.is_owner());
