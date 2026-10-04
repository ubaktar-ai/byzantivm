-- Order workflow for made-to-order furniture & lighting:
-- Inquiry → Costing → Proposal → Deposit → Drawings → Client approval → Production → Balance → Shipping → Delivered.
-- Adds products per order (with supplier cost), drawings per product, delivery address and shipments.
-- Run once in Supabase → SQL Editor (safe to run again).

-- ---------- New stages (old design stages are mapped onto them) ----------
alter table public.projects drop constraint if exists projects_stage_check;
alter table public.tasks    drop constraint if exists tasks_stage_check;
update public.projects set stage = case stage
  when 'brief' then 'inquiry' when 'concept' then 'costing' when 'design' then 'drawings'
  when 'client_review' then 'approval' when 'revisions' then 'drawings' else stage end;
update public.tasks set stage = case stage
  when 'brief' then 'inquiry' when 'concept' then 'costing' when 'design' then 'drawings'
  when 'client_review' then 'approval' when 'revisions' then 'drawings' else stage end;
alter table public.projects alter column stage set default 'inquiry';
alter table public.tasks    alter column stage set default 'inquiry';
alter table public.projects add constraint projects_stage_check check (stage in
  ('inquiry','costing','proposal','deposit','drawings','approval','production','balance','shipping','delivered'));
alter table public.tasks add constraint tasks_stage_check check (stage in
  ('inquiry','costing','proposal','deposit','drawings','approval','production','balance','shipping','delivered'));

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

-- ---------- Activity log: describe shipments by carrier / tracking ----------
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
