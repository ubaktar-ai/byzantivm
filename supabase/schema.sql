-- =====================================================================
-- Byzantivm & Demya — studio manager database
--
-- Run once in Supabase: Dashboard → SQL Editor → New query → paste → Run.
-- BEFORE running, replace YOUR_EMAIL@example.com (near the bottom) with
-- the email you will sign in with. Only emails on the team list can see
-- or change any data.
-- Safe to re-run: everything is created "if not exists" / "or replace".
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Team access
-- ---------------------------------------------------------------------

create table if not exists public.team_members (
  email      text primary key check (email = lower(email)),
  added_at   timestamptz not null default now(),
  added_by   uuid default auth.uid()
);

create or replace function public.is_team_member()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.team_members
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text not null default '',
  color       text not null default '#64748b',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Create a profile automatically when someone signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    lower(new.email),
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Core: companies, clients, projects, tasks, comments
-- ---------------------------------------------------------------------

create table if not exists public.companies (
  id          text primary key,
  name        text not null,
  color       text not null default '#64748b',
  sort_order  int not null default 0,
  updated_at  timestamptz not null default now()
);

create table if not exists public.clients (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text not null default '',
  phone       text not null default '',
  website     text not null default '',
  address     text not null default '',
  notes       text not null default '',
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.contacts (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients (id) on delete cascade,
  name        text not null,
  role        text not null default '',
  email       text not null default '',
  phone       text not null default '',
  notes       text not null default '',
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.projects (
  id           uuid primary key default gen_random_uuid(),
  company_id   text not null references public.companies (id),
  client_id    uuid references public.clients (id) on delete set null,
  name         text not null,
  description  text not null default '',
  stage        text not null default 'inquiry'
               check (stage in ('inquiry','costing','proposal','deposit','drawings','approval','production','balance','shipping','delivered')),
  status       text not null default 'active'
               check (status in ('active','on_hold','completed','cancelled')),
  currency     text not null default 'EUR' check (currency in ('EUR','USD')),
  lead_id      uuid references public.profiles (id) on delete set null,
  start_date   date,
  due_date     date,
  sort_order   double precision not null default 0,
  created_at   timestamptz not null default now(),
  created_by   uuid default auth.uid(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.tasks (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  title        text not null,
  notes        text not null default '',
  stage        text not null default 'inquiry'
               check (stage in ('inquiry','costing','proposal','deposit','drawings','approval','production','balance','shipping','delivered')),
  done         boolean not null default false,
  priority     text not null default 'medium' check (priority in ('low','medium','high','urgent')),
  assignee_id  uuid references public.profiles (id) on delete set null,
  due_date     date,
  completed_at timestamptz,
  sort_order   double precision not null default 0,
  created_at   timestamptz not null default now(),
  created_by   uuid default auth.uid(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.comments (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  task_id     uuid references public.tasks (id) on delete cascade,
  author_id   uuid default auth.uid() references public.profiles (id) on delete set null,
  body        text not null,
  mentions    uuid[] not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Deliverables & client feedback rounds
-- ---------------------------------------------------------------------

create table if not exists public.deliverables (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  name        text not null,
  description text not null default '',
  max_rounds  int not null default 3 check (max_rounds between 1 and 20),
  status      text not null default 'in_progress' check (status in ('in_progress','approved','cancelled')),
  due_date    date,
  sort_order  double precision not null default 0,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.feedback_rounds (
  id             uuid primary key default gen_random_uuid(),
  deliverable_id uuid not null references public.deliverables (id) on delete cascade,
  round_no       int not null,
  sent_date      date,
  received_date  date,
  status         text not null default 'awaiting'
                 check (status in ('awaiting','changes_requested','approved')),
  feedback       text not null default '',
  created_at     timestamptz not null default now(),
  created_by     uuid default auth.uid(),
  updated_at     timestamptz not null default now(),
  unique (deliverable_id, round_no)
);

create table if not exists public.attachments (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  task_id     uuid references public.tasks (id) on delete cascade,
  round_id    uuid references public.feedback_rounds (id) on delete cascade,
  path        text not null unique,          -- path inside the "files" storage bucket
  name        text not null,
  mime        text not null default '',
  size        bigint not null default 0,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Money: quotes → costs → invoices (amounts use the project's currency)
-- ---------------------------------------------------------------------

create table if not exists public.quotes (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  number      text not null default '',
  title       text not null default '',
  issue_date  date,
  valid_until date,
  status      text not null default 'draft' check (status in ('draft','sent','approved','rejected')),
  notes       text not null default '',
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.quote_items (
  id          uuid primary key default gen_random_uuid(),
  quote_id    uuid not null references public.quotes (id) on delete cascade,
  description text not null,
  quantity    numeric(12,2) not null default 1,
  unit_price  numeric(14,2) not null default 0,
  sort_order  double precision not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.costs (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  date        date not null default current_date,
  description text not null,
  category    text not null default 'other'
              check (category in ('freelancer','printing','production','software','travel','other')),
  vendor      text not null default '',
  amount      numeric(14,2) not null default 0,
  paid        boolean not null default false,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.invoices (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  number      text not null default '',
  title       text not null default '',          -- e.g. "50% deposit", "Final delivery"
  issue_date  date,
  due_date    date,
  amount      numeric(14,2) not null default 0,
  status      text not null default 'draft' check (status in ('draft','sent','paid','cancelled')),
  paid_date   date,
  notes       text not null default '',
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Activity feed (written only by triggers)
-- ---------------------------------------------------------------------

create table if not exists public.activity (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor_id    uuid references public.profiles (id) on delete set null,
  entity      text not null,
  entity_id   text not null,
  project_id  uuid,
  action      text not null,
  summary     text not null default '',
  details     jsonb not null default '{}'
);

create index if not exists activity_at_idx on public.activity (at desc);
create index if not exists tasks_project_idx on public.tasks (project_id);
create index if not exists comments_task_idx on public.comments (task_id);
create index if not exists comments_project_idx on public.comments (project_id);
create index if not exists projects_client_idx on public.projects (client_id);
create index if not exists contacts_client_idx on public.contacts (client_id);
create index if not exists deliverables_project_idx on public.deliverables (project_id);
create index if not exists rounds_deliverable_idx on public.feedback_rounds (deliverable_id);
create index if not exists attachments_project_idx on public.attachments (project_id);
create index if not exists costs_project_idx on public.costs (project_id);
create index if not exists invoices_project_idx on public.invoices (project_id);
create index if not exists quotes_project_idx on public.quotes (project_id);
create index if not exists quote_items_quote_idx on public.quote_items (quote_id);

-- ---------------------------------------------------------------------
-- Triggers: updated_at + activity log
-- ---------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.log_activity()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  rec      jsonb := to_jsonb(coalesce(new, old));
  prev     jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else null end;
  changed  text[];
  act      text;
  proj     uuid;
begin
  if tg_op = 'INSERT' then act := 'created';
  elsif tg_op = 'DELETE' then act := 'deleted';
  else act := 'updated';
  end if;

  if tg_op = 'UPDATE' then
    select coalesce(array_agg(key order by key), '{}') into changed
    from jsonb_each(rec) n
    where key not in ('updated_at','sort_order')
      and n.value is distinct from prev -> key;
    if array_length(changed, 1) is null then
      return null;   -- only ordering/timestamps changed: not worth logging
    end if;
    if tg_table_name = 'tasks' and changed = array['completed_at','done'] then
      act := case when (rec ->> 'done')::boolean then 'completed' else 'reopened' end;
    elsif rec ? 'stage' and 'stage' = any (changed) then
      act := 'moved';
    end if;
  end if;

  proj := case
    when tg_table_name = 'projects' then (rec ->> 'id')::uuid
    when rec ? 'project_id' then (rec ->> 'project_id')::uuid
    when tg_table_name = 'feedback_rounds' then
      (select d.project_id from public.deliverables d where d.id = (rec ->> 'deliverable_id')::uuid)
    else null
  end;

  insert into public.activity (actor_id, entity, entity_id, project_id, action, summary, details)
  values (
    auth.uid(),
    tg_table_name,
    rec ->> 'id',
    proj,
    act,
    coalesce(rec ->> 'name', rec ->> 'title', nullif(rec ->> 'number', ''), rec ->> 'description',
             left(rec ->> 'body', 140), 'Round ' || (rec ->> 'round_no'),
             nullif(concat_ws(' ', rec ->> 'carrier', rec ->> 'tracking'), ''), ''),
    case
      when tg_op = 'UPDATE' then jsonb_build_object('changed', to_jsonb(changed),
                                   'stage', rec -> 'stage', 'from_stage', prev -> 'stage',
                                   'status', rec -> 'status')
      else '{}'::jsonb
    end
  );
  return null;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['profiles','companies','clients','contacts','projects','tasks','comments',
                           'deliverables','feedback_rounds','attachments','quotes','quote_items',
                           'costs','invoices']
  loop
    execute format('drop trigger if exists touch_%1$s on public.%1$I', t);
    execute format('create trigger touch_%1$s before update on public.%1$I
                    for each row execute function public.touch_updated_at()', t);
  end loop;

  foreach t in array array['clients','projects','tasks','comments','deliverables','feedback_rounds',
                           'attachments','quotes','costs','invoices']
  loop
    execute format('drop trigger if exists activity_%1$s on public.%1$I', t);
    execute format('create trigger activity_%1$s after insert or update or delete on public.%1$I
                    for each row execute function public.log_activity()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Row level security: signed-in team members can do everything,
-- nobody else can see anything.
-- ---------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['companies','clients','contacts','projects','tasks','comments',
                           'deliverables','feedback_rounds','attachments','quotes','quote_items',
                           'costs','invoices']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists team_all on public.%I', t);
    execute format('create policy team_all on public.%I for all to authenticated
                    using (public.is_team_member()) with check (public.is_team_member())', t);
  end loop;
end $$;

alter table public.team_members enable row level security;
drop policy if exists team_read on public.team_members;
create policy team_read on public.team_members for select to authenticated using (public.is_team_member());
drop policy if exists team_add on public.team_members;
create policy team_add on public.team_members for insert to authenticated with check (public.is_team_member());
drop policy if exists team_remove on public.team_members;
create policy team_remove on public.team_members for delete to authenticated using (public.is_team_member());

alter table public.profiles enable row level security;
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (public.is_team_member() or id = auth.uid());
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

alter table public.activity enable row level security;
drop policy if exists activity_read on public.activity;
create policy activity_read on public.activity for select to authenticated using (public.is_team_member());

-- ---------------------------------------------------------------------
-- Live updates
-- ---------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['profiles','team_members','companies','clients','contacts','projects','tasks',
                           'comments','deliverables','feedback_rounds','attachments','quotes',
                           'quote_items','costs','invoices','activity']
  loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- File storage (private bucket, team only)
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('files', 'files', false)
on conflict (id) do nothing;

drop policy if exists files_team_read on storage.objects;
create policy files_team_read on storage.objects for select to authenticated
  using (bucket_id = 'files' and public.is_team_member());
drop policy if exists files_team_write on storage.objects;
create policy files_team_write on storage.objects for insert to authenticated
  with check (bucket_id = 'files' and public.is_team_member());
drop policy if exists files_team_delete on storage.objects;
create policy files_team_delete on storage.objects for delete to authenticated
  using (bucket_id = 'files' and public.is_team_member());

-- ---------------------------------------------------------------------
-- Document details (also in migrations/002_documents.sql)
-- ---------------------------------------------------------------------

-- Company details printed on documents
alter table public.companies
  add column if not exists legal_name    text not null default '',
  add column if not exists address       text not null default '',
  add column if not exists email         text not null default '',
  add column if not exists phone         text not null default '',
  add column if not exists website       text not null default '',
  add column if not exists tax_id        text not null default '',   -- VAT number (BTW-id)
  add column if not exists registration  text not null default '',   -- Chamber of Commerce (KvK) number
  add column if not exists bank_name     text not null default '',
  add column if not exists iban          text not null default '',
  add column if not exists swift         text not null default '',
  add column if not exists default_vat   numeric(5,2) not null default 0,
  add column if not exists doc_language  text not null default 'en',
  add column if not exists payment_terms text not null default '',
  add column if not exists logo_path     text not null default '';

-- Client tax details (needed on business invoices)
alter table public.clients
  add column if not exists tax_id     text not null default '';

-- VAT and language per document (amounts stay net/excl. VAT)
alter table public.quotes
  add column if not exists vat_rate numeric(5,2) not null default 0,
  add column if not exists language text not null default 'en';
alter table public.invoices
  add column if not exists vat_rate numeric(5,2) not null default 0,
  add column if not exists language text not null default 'en';

-- ---------------------------------------------------------------------
-- Company country, currencies, VAT treatment (also in migrations/004_company_country.sql)
-- ---------------------------------------------------------------------

alter table public.companies
  add column if not exists country          text not null default 'NL',
  add column if not exists default_currency text not null default 'EUR';
alter table public.companies drop constraint if exists companies_country_check;
alter table public.companies add constraint companies_country_check check (country in ('NL','US'));
alter table public.companies drop constraint if exists companies_default_currency_check;
alter table public.companies add constraint companies_default_currency_check check (default_currency in ('EUR','USD'));

-- Set the two companies up (only if they still have the initial defaults).
update public.companies set country = 'US', default_currency = 'USD', default_vat = 0, doc_language = 'en'
  where id = 'byzantivm' and country = 'NL' and default_currency = 'EUR';
update public.companies set country = 'NL', default_currency = 'EUR'
  where id = 'demya' and default_currency = 'EUR';

-- Only US dollars and euros.
update public.projects set currency = 'EUR' where currency not in ('EUR','USD');
alter table public.projects drop constraint if exists projects_currency_check;
alter table public.projects add constraint projects_currency_check check (currency in ('EUR','USD'));

-- How VAT / sales tax applies to each quote and invoice.
--   standard        : the document's rate is charged (21%, 9% in NL; sales tax % in the US)
--   reverse_charge  : EU business client outside NL, VAT reverse-charged (0%)
--   outside_eu      : client outside the EU, no Dutch VAT (0%)
--   kor             : Dutch small business scheme (KOR), exempt (0%)
alter table public.quotes   add column if not exists vat_treatment text not null default 'standard';
alter table public.invoices add column if not exists vat_treatment text not null default 'standard';
alter table public.quotes   drop constraint if exists quotes_vat_treatment_check;
alter table public.quotes   add constraint quotes_vat_treatment_check check (vat_treatment in ('standard','reverse_charge','outside_eu','kor'));
alter table public.invoices drop constraint if exists invoices_vat_treatment_check;
alter table public.invoices add constraint invoices_vat_treatment_check check (vat_treatment in ('standard','reverse_charge','outside_eu','kor'));

-- ---------------------------------------------------------------------
-- Orders: products, drawings per product, shipments (also in migrations/005_order_workflow.sql)
-- ---------------------------------------------------------------------
-- ---------- Order details ----------
alter table public.projects
  add column if not exists delivery_address text not null default '',
  add column if not exists deposit_pct numeric(5,2) not null default 50;

-- Which invoice is the deposit and which the balance (drawings wait for the deposit, shipping for the balance)
alter table public.invoices add column if not exists kind text not null default 'other';
alter table public.invoices drop constraint if exists invoices_kind_check;
alter table public.invoices add constraint invoices_kind_check check (kind in ('deposit','balance','other'));

-- ---------- Products in an order ----------
create table if not exists public.items (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects (id) on delete cascade,
  name          text not null,
  description   text not null default '',
  quantity      numeric(12,2) not null default 1,
  dimensions    text not null default '',
  materials     text not null default '',
  weight_kg     numeric(10,2),
  supplier      text not null default '',
  supplier_ref  text not null default '',          -- supplier's quote number
  unit_cost     numeric(14,2) not null default 0,  -- supplier price per unit
  unit_price    numeric(14,2) not null default 0,  -- our price to the client per unit
  production    text not null default 'not_started' check (production in ('not_started','in_production','ready')),
  sort_order    double precision not null default 0,
  created_at    timestamptz not null default now(),
  created_by    uuid default auth.uid(),
  updated_at    timestamptz not null default now()
);
create index if not exists items_project_idx on public.items (project_id);

-- Drawings belong to a product
alter table public.deliverables add column if not exists item_id uuid references public.items (id) on delete cascade;

-- ---------- Shipments ----------
create table if not exists public.shipments (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects (id) on delete cascade,
  carrier         text not null default '',
  tracking        text not null default '',
  status          text not null default 'preparing' check (status in ('preparing','shipped','delivered')),
  shipped_date    date,
  delivered_date  date,
  cost            numeric(14,2) not null default 0,
  packages        text not null default '',          -- e.g. "2 crates, 1 box"
  notes           text not null default '',
  created_at      timestamptz not null default now(),
  created_by      uuid default auth.uid(),
  updated_at      timestamptz not null default now()
);
create index if not exists shipments_project_idx on public.shipments (project_id);

-- ---------- Security, timestamps, activity, live updates ----------
do $$
declare t text;
begin
  foreach t in array array['items','shipments'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists team_all on public.%I', t);
    execute format('create policy team_all on public.%I for all to authenticated
                    using (public.is_team_member()) with check (public.is_team_member())', t);
    execute format('drop trigger if exists touch_%1$s on public.%1$I', t);
    execute format('create trigger touch_%1$s before update on public.%1$I
                    for each row execute function public.touch_updated_at()', t);
    execute format('drop trigger if exists activity_%1$s on public.%1$I', t);
    execute format('create trigger activity_%1$s after insert or update or delete on public.%1$I
                    for each row execute function public.log_activity()', t);
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------- Files per tab (client inquiry, supplier quote, drawings, money, shipping) ----------
alter table public.attachments
  add column if not exists kind    text,
  add column if not exists item_id uuid references public.items (id) on delete set null;

alter table public.attachments drop constraint if exists attachments_kind_check;
alter table public.attachments add constraint attachments_kind_check check
  (kind is null or kind in ('inquiry','supplier_quote','drawing','money','shipping','general'));

create index if not exists attachments_item_idx on public.attachments (item_id);

-- ---------------------------------------------------------------------
-- Starting data
-- ---------------------------------------------------------------------

insert into public.companies (id, name, color, sort_order, country, default_currency, default_vat) values
  ('byzantivm', 'Byzantivm', '#7c3aed', 0, 'US', 'USD', 0),
  ('demya',     'Demya',     '#0d9488', 1, 'NL', 'EUR', 21)
on conflict (id) do nothing;

-- >>> Replace with YOUR sign-in email, then run. Add teammates later in the app (Team screen).
insert into public.team_members (email) values (lower('YOUR_EMAIL@example.com'))
on conflict (email) do nothing;
