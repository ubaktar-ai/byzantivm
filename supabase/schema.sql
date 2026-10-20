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
  (kind is null or kind in ('inquiry','supplier_quote','drawing','money','shipping','general','qc'));

create index if not exists attachments_item_idx on public.attachments (item_id);

-- ---------- Social (Demya): posts and networking ----------

-- How the company sounds on social media; the AI writes every post in this voice.
alter table public.companies add column if not exists social_voice text not null default '';

-- ---------- Posts ----------
create table if not exists public.social_posts (
  id             uuid primary key default gen_random_uuid(),
  company_id     text not null references public.companies (id) on delete cascade,
  project_id     uuid references public.projects (id) on delete set null,   -- the order the post is about, if any
  platform       text not null check (platform in ('linkedin','instagram')),
  status         text not null default 'draft' check (status in ('draft','approved','posted')),
  title          text not null default '',          -- short idea, e.g. "Behind the build: oak conference table"
  idea           text not null default '',          -- what to show and say (the brief the AI writes from)
  body           text not null default '',          -- the post text / caption
  hashtags       text not null default '',
  photo_ids      uuid[] not null default '{}',      -- attachments (project photos) to post with it
  language       text not null default 'en' check (language in ('en','nl')),
  scheduled_for  date,
  posted_at      timestamptz,
  posted_url     text not null default '',
  sort_order     double precision not null default 0,
  created_at     timestamptz not null default now(),
  created_by     uuid default auth.uid(),
  updated_at     timestamptz not null default now()
);
create index if not exists social_posts_company_idx on public.social_posts (company_id);
create index if not exists social_posts_project_idx on public.social_posts (project_id);

-- ---------- Network: people to connect with and follow up ----------
create table if not exists public.social_contacts (
  id              uuid primary key default gen_random_uuid(),
  company_id      text not null references public.companies (id) on delete cascade,
  name            text not null,
  role            text not null default '',          -- e.g. "Interior architect"
  organisation    text not null default '',
  category        text not null default 'other'
                  check (category in ('architect','interior','hospitality','developer','retail','press','supplier','other')),
  platform        text not null default 'linkedin' check (platform in ('linkedin','instagram','both')),
  profile_url     text not null default '',
  status          text not null default 'to_connect'
                  check (status in ('to_connect','requested','connected','talking','client')),
  message         text not null default '',          -- drafted connection note / follow-up message
  next_follow_up  date,
  notes           text not null default '',
  created_at      timestamptz not null default now(),
  created_by      uuid default auth.uid(),
  updated_at      timestamptz not null default now()
);
create index if not exists social_contacts_company_idx on public.social_contacts (company_id);

-- ---------- Security, timestamps, live updates ----------
do $$
declare t text;
begin
  foreach t in array array['social_posts','social_contacts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists team_all on public.%I', t);
    execute format('create policy team_all on public.%I for all to authenticated
                    using (public.is_team_member()) with check (public.is_team_member())', t);
    execute format('drop trigger if exists touch_%1$s on public.%1$I', t);
    execute format('create trigger touch_%1$s before update on public.%1$I
                    for each row execute function public.touch_updated_at()', t);
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------- Quality control for lighting (permanent records) ----------
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

-- The stored files themselves (kept under <project>/qc/...) can't be removed from storage either:
-- an extra rule that blocks deleting QC files, next to the normal team rule.
drop policy if exists qc_files_permanent on storage.objects;
create policy qc_files_permanent on storage.objects as restrictive for delete to authenticated
  using (not (bucket_id = 'files' and name like '%/qc/%'));

-- ---------- Quality control, part 2: line cards, samples, links, change requests ----------
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

-- The stamp only runs from the database itself; nobody can call it directly.
revoke execute on function public.qc_stamp() from public, anon, authenticated;

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
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'supplier_prices') then
    alter publication supabase_realtime add table public.supplier_prices;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Starting data
-- ---------------------------------------------------------------------

insert into public.companies (id, name, color, sort_order, country, default_currency, default_vat) values
  ('byzantivm', 'Byzantivm', '#4a5d23', 0, 'US', 'USD', 0),
  ('demya',     'Demya',     '#0d9488', 1, 'NL', 'EUR', 21)
on conflict (id) do nothing;

-- >>> Replace with YOUR sign-in email, then run. Add teammates later in the app (Team screen).
insert into public.team_members (email) values (lower('YOUR_EMAIL@example.com'))
on conflict (email) do nothing;

-- ---------------------------------------------------------------------
-- Client PO and supplier payouts (also in migrations/011_payouts.sql)
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- Design studio links for designers (also in migrations/012_design_studio.sql)
-- ---------------------------------------------------------------------

create table if not exists public.design_links (
  id           uuid primary key default gen_random_uuid(),
  token        text not null unique,
  company_id   text not null default 'demya' references public.companies (id),
  label        text not null default '',               -- who it is for, e.g. "Studio Noord — Anna"
  image_limit  integer not null default 60 check (image_limit >= 0),
  images_used  integer not null default 0,               -- every image the AI made through this link
  revoked_at   timestamptz,
  created_at   timestamptz not null default now(),
  created_by   uuid default auth.uid(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.design_requests (
  id           uuid primary key default gen_random_uuid(),
  link_id      uuid references public.design_links (id) on delete set null,
  company_id   text not null default 'demya' references public.companies (id),
  status       text not null default 'draft' check (status in ('draft','sent')),
  brief        jsonb not null default '{}'::jsonb,       -- piece, quantity, size, materials, notes, needed_by, budget, country
  inputs       jsonb not null default '[]'::jsonb,       -- [{path, name, role: 'reference'|'room', width, height}]
  summary      text not null default '',                 -- the AI's reading of the brief
  concepts     jsonb not null default '[]'::jsonb,       -- [{title, description, tags[], prompt, path, room_path}]
  chosen       integer,                                  -- index into concepts
  person       text not null default '',
  email        text not null default '',
  studio       text not null default '',
  note         text not null default '',
  sent_at      timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists design_requests_link_idx on public.design_requests (link_id);

alter table public.design_links enable row level security;
drop policy if exists team_all on public.design_links;
create policy team_all on public.design_links for all to authenticated
  using (public.is_team_member()) with check (public.is_team_member());

alter table public.design_requests enable row level security;
drop policy if exists team_all on public.design_requests;
create policy team_all on public.design_requests for all to authenticated
  using (public.is_team_member()) with check (public.is_team_member());

drop trigger if exists touch_design_links on public.design_links;
create trigger touch_design_links before update on public.design_links
  for each row execute function public.touch_updated_at();
drop trigger if exists touch_design_requests on public.design_requests;
create trigger touch_design_requests before update on public.design_requests
  for each row execute function public.touch_updated_at();

do $$ declare t text; begin
  foreach t in array array['design_links','design_requests'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
