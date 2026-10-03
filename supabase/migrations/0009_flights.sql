-- Flight log: every hosted test flight (a real model flying a scenario, with
-- or without Pioneer) leaves one row, so the comparison between flying alone
-- and flying with the hive is measured, not claimed.
create table public.flights (
  id               uuid primary key default gen_random_uuid(),
  scenario         text not null,
  mode             text not null check (mode in ('solo', 'pioneer', 'follower')),
  agent            text not null,
  model            text not null,
  landed           boolean not null default false,
  failed_attempts  int not null default 0,   -- refused calls before landing (or giving up)
  tool_calls       int not null default 0,
  seconds          numeric not null default 0,
  events           jsonb not null default '[]'::jsonb,  -- the step-by-step log, for replay
  created_at       timestamptz not null default now()
);
create index flights_recent on public.flights (scenario, created_at desc);

alter table public.flights enable row level security;
create policy "public read flights" on public.flights for select to anon, authenticated using (true);

create or replace view public.flight_stats with (security_invoker = true) as
select scenario, mode,
       count(*)::int                                   as flights,
       count(*) filter (where landed)::int             as landed,
       round(avg(failed_attempts), 1)                  as avg_failed_attempts,
       round(avg(tool_calls), 1)                       as avg_tool_calls,
       round(avg(seconds), 1)                          as avg_seconds
from public.flights
group by scenario, mode;

alter publication supabase_realtime add table public.flights;
