-- ==============================================================================
-- 004 — Bear Radar lead fields (ADDITIVE ONLY, safe to re-run)
--
-- Supports the new WF-1 "Lead Radar – Sources" and WF-2 "Qualify & Enrich"
-- workflows: launch-site sources, small/new-team qualification, social links.
-- Nothing is dropped or renamed; existing rows are untouched.
-- ==============================================================================

-- ---------- raw_leads: what WF-1 collects ----------
alter table public.raw_leads add column if not exists website           text;
alter table public.raw_leads add column if not exists x_handle          text;
alter table public.raw_leads add column if not exists linkedin_url      text;
alter table public.raw_leads add column if not exists launched_at       timestamptz;
alter table public.raw_leads add column if not exists team_size         integer;
alter table public.raw_leads add column if not exists source_score      integer;  -- PH votes / HN points
alter table public.raw_leads add column if not exists disqualify_reason text;
-- One row per startup: lower(domain) when known, else "<source>:<source_id>".
-- WF-1 inserts with ON CONFLICT (dedup_key) DO NOTHING, so re-runs never duplicate.
alter table public.raw_leads add column if not exists dedup_key         text;
create unique index if not exists raw_leads_dedup_key_uq on public.raw_leads (dedup_key);

-- ---------- leads: what WF-2 qualifies ----------
alter table public.leads add column if not exists website           text;
alter table public.leads add column if not exists x_handle          text;
alter table public.leads add column if not exists linkedin_url      text;
alter table public.leads add column if not exists launched_at       timestamptz;
alter table public.leads add column if not exists team_size         integer;
alter table public.leads add column if not exists domain_created_at timestamptz;
alter table public.leads add column if not exists has_video         boolean;
alter table public.leads add column if not exists signals           jsonb default '[]'::jsonb;
alter table public.leads add column if not exists founder_role      text;

-- WF-2 inserts with ON CONFLICT (raw_lead_id) DO NOTHING. Only add the unique index
-- if existing data allows it (never deletes anything).
do $$
begin
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'leads_raw_lead_id_uq') then
    if exists (select raw_lead_id from public.leads where raw_lead_id is not null group by raw_lead_id having count(*) > 1) then
      raise notice 'leads has duplicate raw_lead_id values; unique index not created. WF-2 will still work but may insert duplicates on retries.';
    else
      create unique index leads_raw_lead_id_uq on public.leads (raw_lead_id);
    end if;
  end if;
end $$;

create index if not exists idx_leads_launched_at on public.leads (launched_at desc);
