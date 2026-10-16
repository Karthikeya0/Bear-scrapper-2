-- Bear Radar outreach v2: scheduled sending (Approve all + daily limit) and X/LinkedIn DM drafts.
-- Additive and safe to run more than once. Nothing is deleted.

-- ---------- outreach_queue.status: add 'scheduled' ----------
-- 'scheduled' = approved in bulk; WF-3b sends these one at a time inside the send window and daily limit.
do $$
declare c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public' and rel.relname = 'outreach_queue' and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%status%'
  loop
    execute format('alter table public.outreach_queue drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.outreach_queue add constraint outreach_queue_status_check
  check (status in ('pending_review', 'scheduled', 'approved', 'sent', 'rejected'));

-- ---------- outreach_queue.channel: email (sent by n8n) or dm (you paste it on X / LinkedIn) ----------
alter table public.outreach_queue add column if not exists channel text not null default 'email';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'outreach_queue_channel_check') then
    alter table public.outreach_queue add constraint outreach_queue_channel_check check (channel in ('email', 'dm'));
  end if;
end $$;

create index if not exists idx_outreach_queue_lead_status on public.outreach_queue (lead_id, status);
create index if not exists idx_outreach_queue_sent_at on public.outreach_queue (sent_at desc);
