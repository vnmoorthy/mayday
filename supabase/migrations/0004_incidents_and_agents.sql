-- Incidents: a crash site where agents are suddenly going down faster than
-- its own history says they should, the way a bad release would cause.
-- Agents: which agents and models go down where, and how often they are rescued.

create or replace function public.site_incidents(p_window_minutes int default 30, p_min_recent int default 3)
returns table (
  site_id uuid,
  slug text,
  title text,
  vendor text,
  surface text,
  recent int,
  baseline numeric,
  ratio numeric,
  first_recent timestamptz,
  last_recent timestamptz
)
language sql stable
set search_path = public
as $$
  with recent as (
    select m.site_id,
           count(*)::int as recent,
           min(m.created_at) as first_recent,
           max(m.created_at) as last_recent
    from public.maydays m
    where m.created_at >= now() - make_interval(mins => p_window_minutes)
    group by m.site_id
  ),
  history as (
    -- The same-length window, averaged over the previous 7 days.
    select m.site_id,
           count(*)::numeric
             / greatest(1, (7 * 24 * 60) / p_window_minutes) as baseline
    from public.maydays m
    where m.created_at <  now() - make_interval(mins => p_window_minutes)
      and m.created_at >= now() - interval '7 days'
    group by m.site_id
  )
  select s.id, s.slug, s.title, s.vendor, s.surface,
         r.recent,
         round(coalesce(h.baseline, 0), 2) as baseline,
         round(r.recent / greatest(coalesce(h.baseline, 0), 0.25), 1) as ratio,
         r.first_recent, r.last_recent
  from recent r
  join public.sites s on s.id = r.site_id
  left join history h on h.site_id = r.site_id
  where r.recent >= p_min_recent
    and r.recent >= 3 * greatest(coalesce(h.baseline, 0), 0.25)
  order by ratio desc, r.recent desc;
$$;

create or replace function public.agent_breakdown()
returns table (
  agent text,
  model text,
  vendor text,
  maydays int,
  rescued int,
  minutes_lost numeric,
  sites int,
  live int
)
language sql stable
set search_path = public
as $$
  select m.agent,
         coalesce(m.model, 'unknown') as model,
         s.vendor,
         count(*)::int as maydays,
         count(*) filter (where m.outcome = 'rescued')::int as rescued,
         coalesce(sum(m.minutes_lost), 0) as minutes_lost,
         count(distinct m.site_id)::int as sites,
         count(*) filter (where m.source <> 'seed')::int as live
  from public.maydays m
  join public.sites s on s.id = m.site_id
  group by m.agent, coalesce(m.model, 'unknown'), s.vendor;
$$;
