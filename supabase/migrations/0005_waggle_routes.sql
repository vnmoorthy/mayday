-- Waggle routes: the other half of what a hive does. The stop signal says
-- "do not fly there"; the waggle dance says "the good path is this way".
-- A route is a proven way to get a task done on a vendor's product. Agents ask
-- for one before they start, report whether they landed it, and chart new ones.

create table public.routes (
  id           uuid primary key default gen_random_uuid(),
  vendor       text references public.vendors(slug) on delete cascade,
  slug         text not null unique,
  task         text not null,            -- "Verify a Stripe webhook in a Next.js route handler"
  signature    text not null,            -- normalized task, for trigram matching
  steps        jsonb not null default '[]'::jsonb,   -- [{ "n": 1, "text": "..." }]
  snippet      text,
  pitfalls     text[] not null default '{}',         -- crash-site slugs this route avoids
  landings     int not null default 0,
  failures     int not null default 0,
  minutes_sum  numeric not null default 0,
  author       text not null default 'mayday',
  source       text not null default 'live' check (source in ('live','seed','harvest')),
  created_at   timestamptz not null default now(),
  last_landed  timestamptz
);
create index routes_signature_trgm on public.routes using gin (signature extensions.gin_trgm_ops);
create index routes_vendor on public.routes (vendor);

alter table public.routes enable row level security;
create policy "public read routes" on public.routes for select to anon, authenticated using (true);

-- Best routes for a task, by how well the wording matches and how often
-- agents have landed it.
create or replace function public.find_routes(p_signature text, p_vendor text default null, p_limit int default 3)
returns setof public.routes
language sql stable
set search_path = public, extensions
as $$
  select r.*
  from public.routes r
  where (p_vendor is null or r.vendor = p_vendor)
    and greatest(
          similarity(r.signature, p_signature),
          word_similarity(r.signature, p_signature),
          word_similarity(p_signature, r.signature)
        ) >= 0.3
  order by greatest(
             similarity(r.signature, p_signature),
             word_similarity(r.signature, p_signature),
             word_similarity(p_signature, r.signature)
           ) desc,
           r.landings desc
  limit greatest(1, least(p_limit, 10));
$$;

create or replace function public.chart_route(
  p_task      text,
  p_signature text,
  p_vendor    text default null,
  p_steps     jsonb default '[]'::jsonb,
  p_snippet   text default null,
  p_pitfalls  text[] default '{}',
  p_author    text default 'unknown-agent',
  p_source    text default 'live',
  p_slug      text default null
) returns public.routes
language plpgsql security definer
set search_path = public
as $$
declare
  v public.routes;
begin
  insert into public.routes (vendor, slug, task, signature, steps, snippet, pitfalls, author, source)
  values (
    nullif(p_vendor, ''),
    coalesce(nullif(p_slug, ''), coalesce(nullif(p_vendor, ''), 'route') || '-' || substr(md5(p_signature), 1, 10)),
    left(p_task, 300),
    p_signature,
    coalesce(p_steps, '[]'::jsonb),
    nullif(p_snippet, ''),
    coalesce(p_pitfalls, '{}'),
    p_author,
    p_source
  )
  on conflict (slug) do update
    set steps = excluded.steps, snippet = excluded.snippet, pitfalls = excluded.pitfalls, task = excluded.task
  returning * into v;
  return v;
end $$;

-- An agent followed a route: did it land?
create or replace function public.report_landing(p_route_id uuid, p_ok boolean, p_minutes numeric default 0)
returns public.routes
language sql security definer
set search_path = public
as $$
  update public.routes
     set landings    = landings + (case when p_ok then 1 else 0 end),
         failures    = failures + (case when p_ok then 0 else 1 end),
         minutes_sum = minutes_sum + (case when p_ok then coalesce(p_minutes, 0) else 0 end),
         last_landed = case when p_ok then now() else last_landed end
   where id = p_route_id
  returning *;
$$;

-- What the hive has saved: agent-minutes handed back by rescues.
create or replace function public.hive_savings()
returns jsonb
language sql stable
set search_path = public
as $$
  select jsonb_build_object(
    'rescues', (select count(*) from public.rescues),
    'minutes_saved', (select coalesce(sum(minutes_saved), 0) from public.rescues),
    'live_rescues', (select count(*) from public.rescues where source <> 'seed'),
    'route_landings', (select coalesce(sum(landings), 0) from public.routes)
  );
$$;

revoke execute on function public.chart_route(text, text, text, jsonb, text, text[], text, text, text) from public, anon, authenticated;
revoke execute on function public.report_landing(uuid, boolean, numeric) from public, anon, authenticated;
grant execute on function public.chart_route(text, text, text, jsonb, text, text[], text, text, text) to service_role;
grant execute on function public.report_landing(uuid, boolean, numeric) to service_role;

alter publication supabase_realtime add table public.routes;
