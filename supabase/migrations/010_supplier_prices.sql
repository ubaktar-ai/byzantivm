-- Supplier price requests for lights. Needs 009_qc_line_cards.sql first.
-- Run once in Supabase → SQL Editor (safe to run again).

-- ---------- Supplier price requests (lighting) ----------
-- A supplier link can be a price request: the supplier sees the pictures and details (never the original's
-- price, our price or the client) and sends a price per item. Every price is kept, with the name and the time.
alter table public.qc_links add column if not exists purpose text not null default 'qc';
alter table public.qc_links drop constraint if exists qc_links_purpose_check;
alter table public.qc_links add constraint qc_links_purpose_check check (purpose in ('qc','quote'));
alter table public.qc_links add column if not exists currency text not null default '';

create table if not exists public.supplier_prices (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  item_id     uuid,
  item_name   text not null default '',
  link_id     uuid,
  party       text not null default 'supplier' check (party in ('supplier','us')),  -- 'us' = typed in by the team
  person      text not null default '',
  unit_price  numeric(14,2) not null check (unit_price >= 0),
  currency    text not null default '',
  lead_time   text not null default '',
  notes       text not null default '',
  photos      jsonb not null default '[]'::jsonb,
  title       text not null default '',
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid()
);
create index if not exists supplier_prices_project_idx on public.supplier_prices (project_id);

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
  elsif tg_table_name = 'supplier_prices' then
    new.title := 'Price — ' || coalesce(nullif(new.item_name, ''), 'item');
  end if;
  return new;
end $$;

alter table public.supplier_prices enable row level security;
drop policy if exists team_read on public.supplier_prices;
create policy team_read on public.supplier_prices for select to authenticated using (public.is_team_member());
drop policy if exists team_add on public.supplier_prices;
create policy team_add on public.supplier_prices for insert to authenticated with check (public.is_team_member());
drop trigger if exists stamp_supplier_prices on public.supplier_prices;
create trigger stamp_supplier_prices before insert on public.supplier_prices for each row execute function public.qc_stamp();
drop trigger if exists locked_supplier_prices on public.supplier_prices;
create trigger locked_supplier_prices before update or delete on public.supplier_prices for each row execute function public.qc_locked();
drop trigger if exists activity_supplier_prices on public.supplier_prices;
create trigger activity_supplier_prices after insert on public.supplier_prices for each row execute function public.log_activity();
revoke execute on function public.qc_stamp() from public, anon, authenticated;

-- Live updates in the app.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'supplier_prices') then
    alter publication supabase_realtime add table public.supplier_prices;
  end if;
end $$;
