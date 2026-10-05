-- Social (Demya): LinkedIn & Instagram posts drafted with AI, and the people Demya wants to build a network with.
-- Run once in Supabase → SQL Editor (safe to run again).

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
