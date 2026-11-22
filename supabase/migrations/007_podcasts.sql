-- Podcast outreach (Bear Studios Podcast Lead Research SOP).
-- A separate pipeline from the startup (SaaS) one: its own leads table and its own outreach queue, so the
-- existing WF-1 … WF-6 workflows never see podcast rows and keep working exactly as before.
-- Additive and safe to run more than once. Nothing is deleted.
--
--   WF-P1 (find on YouTube)  -> podcast_leads (stage 'found')
--   WF-P2 (SOP checks + AI)  -> podcast_leads (stage 'qualified' or 'skipped')
--   WF-P3 (draft)            -> podcast_outreach (pending_review)
--   WF-P3b (send, max/day)   -> podcast_outreach (sent), podcast_leads.status 'Email sent'
--   WF-P4 (replies)          -> podcast_leads.status 'Replied' / 'Dead'
--   WF-P5 (Google Sheet)     -> "Podcast Leads" sheet, columns A–N of the SOP

create table if not exists public.podcast_leads (
  id                   uuid primary key default gen_random_uuid(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  -- pipeline stage (internal): found -> qualified | skipped
  stage                text not null default 'found',
  skip_reason          text,
  source_query         text,
  niche                text,

  -- SOP columns A–N
  podcast_name         text,
  host_name            text,
  youtube_channel_id   text not null,
  youtube_channel_url  text,
  instagram_url        text,
  host_other_url       text,          -- the host's own channel / other account, or 'same'
  sample_episode_url   text,
  subscribers          integer,
  uploads_30d          integer,
  has_shorts           text,          -- None | Poor | Good
  contact_method       text,          -- e.g. "Email on About page · IG DM"
  why_fit              text,
  status               text not null default 'New',
  added_by             text not null default 'Bear Radar',

  -- extra facts used for checks and drafting
  email                text,
  sample_episode_title text,
  sample_clip_url      text,          -- the free sample short, once made
  avg_minutes          integer,
  shorts_30d           integer,
  last_upload_at       timestamptz,
  language             text,
  format               text,
  network_owned        boolean,
  ig_verified          boolean,       -- Instagram has no public API: someone confirms "posted in the last 30 days"
  checks_failed        jsonb not null default '[]'::jsonb,
  ai_score             integer,
  description          text,

  first_contacted_at   timestamptz,
  replied_at           timestamptz,
  sheet_synced_at      timestamptz
);

create unique index if not exists podcast_leads_channel_key on public.podcast_leads (youtube_channel_id);
create index if not exists idx_podcast_leads_stage on public.podcast_leads (stage, created_at desc);
create index if not exists idx_podcast_leads_status on public.podcast_leads (status);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'podcast_leads_stage_check') then
    alter table public.podcast_leads add constraint podcast_leads_stage_check check (stage in ('found', 'qualified', 'skipped'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'podcast_leads_status_check') then
    alter table public.podcast_leads add constraint podcast_leads_status_check
      check (status in ('New', 'Sample made', 'DM sent', 'Email sent', 'Replied', 'Won', 'Dead'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'podcast_leads_shorts_check') then
    alter table public.podcast_leads add constraint podcast_leads_shorts_check check (has_shorts is null or has_shorts in ('None', 'Poor', 'Good'));
  end if;
end $$;

create or replace function public.touch_podcast_lead()
returns trigger language plpgsql as $$
begin
  -- Writing only sheet_synced_at (WF-P5) must not count as a change, or every sync would re-sync the row.
  if new.sheet_synced_at is distinct from old.sheet_synced_at
     and (to_jsonb(new) - 'sheet_synced_at' - 'updated_at') = (to_jsonb(old) - 'sheet_synced_at' - 'updated_at') then
    new.updated_at = old.updated_at;
  else
    new.updated_at = now();
  end if;
  return new;
end $$;

drop trigger if exists podcast_leads_touch on public.podcast_leads;
create trigger podcast_leads_touch before update on public.podcast_leads
  for each row execute function public.touch_podcast_lead();

create table if not exists public.podcast_outreach (
  id            uuid primary key default gen_random_uuid(),
  podcast_id    uuid not null references public.podcast_leads(id) on delete cascade,
  channel       text not null default 'email',
  sequence_step integer not null default 1,
  subject       text not null,
  body          text not null,
  status        text not null default 'pending_review',
  created_at    timestamptz not null default now(),
  approved_at   timestamptz,
  sent_at       timestamptz,
  rejected_at   timestamptz,
  thread_id     text,
  message_id    text,
  error         text
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'podcast_outreach_status_check') then
    alter table public.podcast_outreach add constraint podcast_outreach_status_check
      check (status in ('pending_review', 'scheduled', 'approved', 'sent', 'rejected'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'podcast_outreach_channel_check') then
    alter table public.podcast_outreach add constraint podcast_outreach_channel_check check (channel in ('email', 'dm'));
  end if;
end $$;

create index if not exists idx_podcast_outreach_status on public.podcast_outreach (status, created_at);
create index if not exists idx_podcast_outreach_podcast on public.podcast_outreach (podcast_id, status);
create index if not exists idx_podcast_outreach_sent_at on public.podcast_outreach (sent_at desc);
create index if not exists idx_podcast_outreach_thread on public.podcast_outreach (thread_id);

-- ---------- Row level security: owner only (n8n uses the service role and bypasses RLS) ----------
alter table public.podcast_leads enable row level security;
alter table public.podcast_outreach enable row level security;

drop policy if exists podcast_leads_owner_all on public.podcast_leads;
drop policy if exists podcast_outreach_owner_all on public.podcast_outreach;
create policy podcast_leads_owner_all    on public.podcast_leads    for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy podcast_outreach_owner_all on public.podcast_outreach for all to authenticated using (public.is_owner()) with check (public.is_owner());

-- ---------- Realtime (dashboard updates live) ----------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'podcast_leads') then
      alter publication supabase_realtime add table public.podcast_leads;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'podcast_outreach') then
      alter publication supabase_realtime add table public.podcast_outreach;
    end if;
  end if;
end $$;

-- ---------- Settings: podcast row (edited on the dashboard's Podcasts page) ----------
insert into public.settings (key, value)
values ('podcast', '{"daily_max": 10, "min_subscribers": 1000, "max_subscribers": 25000, "min_uploads_30d": 2, "min_episode_minutes": 30, "searches_per_run": 20, "follow_up_days": [4, 7], "draft_dms": true, "autopilot": "manual", "sheet_url": "", "added_by": "Bear Radar"}'::jsonb)
on conflict (key) do nothing;

-- ---------- SaaS emails: 10 a day (was 20). Total stays at 20: 10 startups + 10 podcasts. ----------
-- Only lowers the saved limit if it is above 10; WF-3 / WF-3b already read daily_max from this row.
insert into public.settings (key, value) values ('outreach', '{"daily_max": 10}'::jsonb) on conflict (key) do nothing;
update public.settings
set value = jsonb_set(coalesce(value, '{}'::jsonb), '{daily_max}', '10'::jsonb), updated_at = now()
where key = 'outreach' and coalesce((value->>'daily_max')::int, 20) > 10;
