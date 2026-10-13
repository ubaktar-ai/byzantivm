-- Quality control for lighting (QA/QC).
-- Spec versions, approvals, inspection reports, issue updates and overrides are PERMANENT:
-- the database refuses to change or delete them, and stamps who saved them and when.
-- (They disappear only if the whole order is deleted.) QC photos can't be deleted either.
-- Run once in Supabase → SQL Editor (safe to run again).

-- ---------- Products: category + working (draft) spec ----------
alter table public.items
  add column if not exists category text not null default 'furniture',
  add column if not exists spec jsonb not null default '{}'::jsonb;
alter table public.items drop constraint if exists items_category_check;
alter table public.items add constraint items_category_check check (category in ('furniture','lighting','other'));

-- ---------- Permanent records ----------
-- item_id has no foreign key on purpose: the history stays even if a product is removed.
create table if not exists public.spec_versions (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects (id) on delete cascade,
  item_id       uuid not null,
  item_name     text not null default '',
  version_no    int not null default 1,
  spec          jsonb not null default '{}'::jsonb,
  change_reason text not null default '',
  requested_by  text not null default '',
  title         text not null default '',
  created_at    timestamptz not null default now(),
  created_by    uuid default auth.uid(),
  unique (item_id, version_no)
);

create table if not exists public.qc_approvals (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  item_id     uuid,
  version_id  uuid not null references public.spec_versions (id) on delete cascade,
  party       text not null check (party in ('client','supplier')),
  decision    text not null check (decision in ('approved','rejected')),
  person      text not null default '',
  method      text not null default '',
  note        text not null default '',
  files       jsonb not null default '[]'::jsonb,
  title       text not null default '',
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid()
);

create table if not exists public.qc_inspections (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects (id) on delete cascade,
  item_id        uuid,
  item_name      text not null default '',
  version_id     uuid references public.spec_versions (id) on delete cascade,
  stage          text not null check (stage in ('sample','production','final','delivery')),
  inspector      text not null check (inspector in ('supplier','us','third_party','client')),
  inspector_name text not null default '',
  inspected_on   date,
  units_checked  numeric(12,2),
  results        jsonb not null default '[]'::jsonb,
  photos         jsonb not null default '[]'::jsonb,
  outcome        text not null check (outcome in ('pass','fail')),
  notes          text not null default '',
  title          text not null default '',
  created_at     timestamptz not null default now(),
  created_by     uuid default auth.uid()
);

create table if not exists public.qc_issues (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects (id) on delete cascade,
  item_id         uuid,
  item_name       text not null default '',
  inspection_id   uuid references public.qc_inspections (id) on delete cascade,
  number          int not null default 1,
  title           text not null,
  description     text not null default '',
  expected        text not null default '',
  found           text not null default '',
  severity        text not null default 'major' check (severity in ('minor','major','critical')),
  responsible     text not null default 'supplier' check (responsible in ('supplier','us','client','carrier')),
  required_action text not null default '',
  due_date        date,
  photos          jsonb not null default '[]'::jsonb,
  created_at      timestamptz not null default now(),
  created_by      uuid default auth.uid()
);

create table if not exists public.qc_issue_updates (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  issue_id    uuid not null references public.qc_issues (id) on delete cascade,
  status      text not null check (status in ('open','fixing','fixed','verified','accepted','closed')),
  note        text not null default '',
  cost        numeric(12,2),
  paid_by     text not null default '',
  photos      jsonb not null default '[]'::jsonb,
  title       text not null default '',
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid()
);

create table if not exists public.qc_overrides (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  item_id     uuid,
  gate        text not null check (gate in ('production','shipping')),
  reason      text not null check (length(trim(reason)) >= 5),
  title       text not null default '',
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid()
);

create index if not exists spec_versions_item_idx on public.spec_versions (item_id);
create index if not exists spec_versions_project_idx on public.spec_versions (project_id);
create index if not exists qc_approvals_project_idx on public.qc_approvals (project_id);
create index if not exists qc_inspections_project_idx on public.qc_inspections (project_id);
create index if not exists qc_issues_project_idx on public.qc_issues (project_id);
create index if not exists qc_issue_updates_project_idx on public.qc_issue_updates (project_id);
create index if not exists qc_overrides_project_idx on public.qc_overrides (project_id);

-- ---------- Stamp: server time, signed-in person, numbering, readable title ----------
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
  end if;
  return new;
end $$;

-- ---------- Lock: no changes, no deletes (except when the whole order is deleted) ----------
create or replace function public.qc_locked()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.projects where id = old.project_id) then
    return old;
  end if;
  raise exception 'Quality-control records are permanent and cannot be changed or deleted (% on %)', lower(tg_op), tg_table_name;
end $$;

do $$
declare t text;
begin
  foreach t in array array['spec_versions','qc_approvals','qc_inspections','qc_issues','qc_issue_updates','qc_overrides'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists team_read on public.%I', t);
    execute format('create policy team_read on public.%I for select to authenticated using (public.is_team_member())', t);
    execute format('drop policy if exists team_add on public.%I', t);
    execute format('create policy team_add on public.%I for insert to authenticated with check (public.is_team_member())', t);
    -- no update/delete policies: nobody may change these rows
    execute format('drop trigger if exists stamp_%1$s on public.%1$I', t);
    execute format('create trigger stamp_%1$s before insert on public.%1$I for each row execute function public.qc_stamp()', t);
    execute format('drop trigger if exists locked_%1$s on public.%1$I', t);
    execute format('create trigger locked_%1$s before update or delete on public.%1$I for each row execute function public.qc_locked()', t);
    execute format('drop trigger if exists activity_%1$s on public.%1$I', t);
    execute format('create trigger activity_%1$s after insert on public.%1$I for each row execute function public.log_activity()', t);
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------- QC photos & proof files: permanent too ----------
alter table public.attachments drop constraint if exists attachments_kind_check;
alter table public.attachments add constraint attachments_kind_check check
  (kind is null or kind in ('inquiry','supplier_quote','drawing','money','shipping','general','qc'));

create or replace function public.qc_file_locked()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.kind is distinct from 'qc' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' and not exists (select 1 from public.projects where id = old.project_id) then
    return old;
  end if;
  if tg_op = 'UPDATE' and new.kind = 'qc' and new.path = old.path and new.project_id = old.project_id then
    return new;   -- e.g. linking to a product is fine
  end if;
  raise exception 'Quality-control photos and proof files are permanent and cannot be deleted';
end $$;
drop trigger if exists qc_file_locked on public.attachments;
create trigger qc_file_locked before update or delete on public.attachments
  for each row execute function public.qc_file_locked();

-- The stored files themselves (kept under <project>/qc/...) can't be removed from storage either.
drop policy if exists files_team_delete on storage.objects;
create policy files_team_delete on storage.objects for delete to authenticated
  using (bucket_id = 'files' and public.is_team_member() and name not like '%/qc/%');
