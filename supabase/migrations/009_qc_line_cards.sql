-- Quality control, part 2: order & item numbers, report templates per company, three-party approval
-- (us + supplier + client), packing inspections, samples with tracking, supplier/client links,
-- change requests and supplier submissions. Needs 008_quality_control.sql first.
-- Run once in Supabase → SQL Editor (safe to run again).

-- ---------- Numbers & templates ----------
alter table public.projects  add column if not exists order_no text not null default '';
alter table public.items     add column if not exists item_no  text not null default '';
alter table public.companies add column if not exists qc_template jsonb not null default '{}'::jsonb;
alter table public.spec_versions add column if not exists request_id uuid;

-- ---------- Approval by us, packing inspections ----------
alter table public.qc_approvals drop constraint if exists qc_approvals_party_check;
alter table public.qc_approvals add constraint qc_approvals_party_check check (party in ('client','supplier','internal'));
alter table public.qc_inspections drop constraint if exists qc_inspections_stage_check;
alter table public.qc_inspections add constraint qc_inspections_stage_check
  check (stage in ('sample','production','final','packing','delivery'));

-- ---------- Samples (sent for approval, with tracking) ----------
create table if not exists public.qc_samples (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  item_id     uuid,
  item_name   text not null default '',
  title       text not null,
  description text not null default '',
  photos      jsonb not null default '[]'::jsonb,
  carrier     text not null default '',
  tracking    text not null default '',
  sent_on     date,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid()
);
create table if not exists public.qc_sample_updates (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  sample_id   uuid not null references public.qc_samples (id) on delete cascade,
  status      text not null check (status in ('sent','received','approved','rejected','note')),
  person      text not null default '',
  note        text not null default '',
  photos      jsonb not null default '[]'::jsonb,
  title       text not null default '',
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid()
);

-- ---------- Change requests (from the supplier, the client or us) ----------
create table if not exists public.qc_requests (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  item_id     uuid,
  item_name   text not null default '',
  version_id  uuid references public.spec_versions (id) on delete cascade,
  party       text not null check (party in ('supplier','client','us')),
  person      text not null default '',
  description text not null,
  photos      jsonb not null default '[]'::jsonb,
  link_id     uuid,
  title       text not null default '',
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid()
);
create table if not exists public.qc_request_updates (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  request_id  uuid not null references public.qc_requests (id) on delete cascade,
  status      text not null check (status in ('accepted','declined','done')),
  note        text not null default '',
  title       text not null default '',
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid()
);

-- ---------- Photos/videos sent in by the supplier or client through their link ----------
create table if not exists public.qc_submissions (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  item_id     uuid,
  item_name   text not null default '',
  party       text not null check (party in ('supplier','client')),
  person      text not null default '',
  purpose     text not null check (purpose in ('production','packing','sample','other')),
  note        text not null default '',
  photos      jsonb not null default '[]'::jsonb,
  link_id     uuid,
  title       text not null default '',
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid()
);

-- ---------- Private links for the supplier / client (no account needed) ----------
create table if not exists public.qc_links (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  token       text not null unique,
  party       text not null check (party in ('supplier','client')),
  item_ids    jsonb not null default '[]'::jsonb,   -- empty = every lighting product of the order
  label       text not null default '',
  revoked_at  timestamptz,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  updated_at  timestamptz not null default now()
);
alter table public.qc_links enable row level security;
drop policy if exists team_all on public.qc_links;
create policy team_all on public.qc_links for all to authenticated
  using (public.is_team_member()) with check (public.is_team_member());

create index if not exists qc_samples_project_idx on public.qc_samples (project_id);
create index if not exists qc_sample_updates_project_idx on public.qc_sample_updates (project_id);
create index if not exists qc_requests_project_idx on public.qc_requests (project_id);
create index if not exists qc_request_updates_project_idx on public.qc_request_updates (project_id);
create index if not exists qc_submissions_project_idx on public.qc_submissions (project_id);
create index if not exists qc_links_project_idx on public.qc_links (project_id);

-- ---------- Stamp (now also for the new tables) ----------
create or replace function public.qc_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.created_at := now();
  new.created_by := coalesce(auth.uid(), new.created_by);
  if tg_table_name = 'spec_versions' then
    select coalesce(max(version_no), 0) + 1 into new.version_no from public.spec_versions where item_id = new.item_id;
    new.title := new.item_name || ' — spec v' || new.version_no;
  elsif tg_table_name = 'qc_approvals' then
    new.title := (select v.item_name || ' v' || v.version_no from public.spec_versions v where v.id = new.version_id);
  elsif tg_table_name = 'qc_inspections' then
    new.title := initcap(new.stage) || ' inspection — ' || new.item_name;
  elsif tg_table_name = 'qc_issues' then
    select coalesce(max(number), 0) + 1 into new.number from public.qc_issues where project_id = new.project_id;
  elsif tg_table_name = 'qc_issue_updates' then
    new.title := (select '#' || i.number || ' ' || i.title from public.qc_issues i where i.id = new.issue_id);
  elsif tg_table_name = 'qc_overrides' then
    new.title := initcap(new.gate) || ' check overridden';
  elsif tg_table_name = 'qc_sample_updates' then
    new.title := (select s.title from public.qc_samples s where s.id = new.sample_id);
  elsif tg_table_name = 'qc_requests' then
    new.title := 'Change request — ' || coalesce(nullif(new.item_name, ''), 'order');
  elsif tg_table_name = 'qc_request_updates' then
    new.title := (select r.title from public.qc_requests r where r.id = new.request_id);
  elsif tg_table_name = 'qc_submissions' then
    new.title := initcap(new.purpose) || ' photos — ' || coalesce(nullif(new.item_name, ''), 'order');
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['qc_samples','qc_sample_updates','qc_requests','qc_request_updates','qc_submissions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists team_read on public.%I', t);
    execute format('create policy team_read on public.%I for select to authenticated using (public.is_team_member())', t);
    execute format('drop policy if exists team_add on public.%I', t);
    execute format('create policy team_add on public.%I for insert to authenticated with check (public.is_team_member())', t);
    execute format('drop trigger if exists stamp_%1$s on public.%1$I', t);
    execute format('create trigger stamp_%1$s before insert on public.%1$I for each row execute function public.qc_stamp()', t);
    execute format('drop trigger if exists locked_%1$s on public.%1$I', t);
    execute format('create trigger locked_%1$s before update or delete on public.%1$I for each row execute function public.qc_locked()', t);
    execute format('drop trigger if exists activity_%1$s on public.%1$I', t);
    execute format('create trigger activity_%1$s after insert on public.%1$I for each row execute function public.log_activity()', t);
  end loop;
  foreach t in array array['qc_samples','qc_sample_updates','qc_requests','qc_request_updates','qc_submissions','qc_links'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

drop trigger if exists touch_qc_links on public.qc_links;
create trigger touch_qc_links before update on public.qc_links for each row execute function public.touch_updated_at();
