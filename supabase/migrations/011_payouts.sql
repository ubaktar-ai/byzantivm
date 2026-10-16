-- Client PO and supplier payouts. Needs 010_supplier_prices.sql first.
-- Run once in Supabase → SQL Editor (safe to run again).

-- The client's purchase order on the project (number and date).
alter table public.projects add column if not exists client_po text not null default '';
alter table public.projects add column if not exists client_po_date date;

-- What the client actually paid on an invoice (may differ from the invoice amount).
alter table public.invoices add column if not exists received_amount numeric(14,2);

-- Supplier payouts: after a client payment, what we pay the supplier (deposit, balance).
-- Kept apart from costs: the supplier's price is already counted in the product costs.
create table if not exists public.supplier_payouts (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  kind        text not null default 'deposit' check (kind in ('deposit','balance','other')),
  number      text not null default '',
  title       text not null default '',
  supplier    text not null default '',
  pct         numeric(5,2),
  amount      numeric(14,2) not null default 0 check (amount >= 0),
  invoice_id  uuid references public.invoices (id) on delete set null,
  status      text not null default 'to_pay' check (status in ('to_pay','paid','cancelled')),
  paid_date   date,
  notes       text not null default '',
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  updated_at  timestamptz not null default now()
);
create index if not exists supplier_payouts_project_idx on public.supplier_payouts (project_id);

alter table public.supplier_payouts enable row level security;
drop policy if exists team_all on public.supplier_payouts;
create policy team_all on public.supplier_payouts for all to authenticated
  using (public.is_team_member()) with check (public.is_team_member());
drop trigger if exists touch_supplier_payouts on public.supplier_payouts;
create trigger touch_supplier_payouts before update on public.supplier_payouts
  for each row execute function public.touch_updated_at();
drop trigger if exists activity_supplier_payouts on public.supplier_payouts;
create trigger activity_supplier_payouts after insert or update or delete on public.supplier_payouts
  for each row execute function public.log_activity();

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'supplier_payouts') then
    alter publication supabase_realtime add table public.supplier_payouts;
  end if;
end $$;
