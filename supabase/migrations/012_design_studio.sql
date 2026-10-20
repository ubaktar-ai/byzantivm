-- Design studio: private links for designers (design.html#<token>). A designer uploads a sketch, references and a
-- photo of the room; the "design-studio" function turns them into concept images and shows a concept in the room.
-- Safe to run more than once.

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
