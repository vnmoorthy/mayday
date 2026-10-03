-- Mayday: crash reports from agents, rescues from the tower.
--
-- An agent that goes down on a product sends a mayday. Postgres matches it to a
-- crash site (trigram similarity on a normalized error signature), counts it,
-- and returns the flares earlier agents and the vendor left at that exact spot.
-- Vendors claim their airspace to pin official fixes and pay per rescue.

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.vendors (
  slug        text primary key,
  name        text not null,
  color       text not null default '#8b949e',
  domains     text[] not null default '{}',
  claimed     boolean not null default false,
  claimed_at  timestamptz,
  created_at  timestamptz not null default now()
);

-- Billing details live apart from vendors so the public map can never read them.
create table public.vendor_billing (
  vendor                       text primary key references public.vendors(slug) on delete cascade,
  stripe_customer_id           text,
  stripe_subscription_id       text,
  stripe_checkout_session_id   text,
  rate_cents                   int not null default 25,
  created_at                   timestamptz not null default now()
);

create table public.sites (
  id             uuid primary key default gen_random_uuid(),
  vendor         text not null references public.vendors(slug) on delete cascade,
  slug           text not null unique,
  title          text not null,
  surface        text not null,
  kind           text not null default 'endpoint' check (kind in ('endpoint','sdk','cli','config','docs')),
  signature      text not null,
  sample_error   text not null,
  maydays_count  int not null default 0,
  rescues_count  int not null default 0,
  minutes_lost   numeric not null default 0,
  first_seen     timestamptz not null default now(),
  last_seen      timestamptz not null default now()
);
create index sites_signature_trgm on public.sites using gin (signature extensions.gin_trgm_ops);
create index sites_vendor on public.sites (vendor);

create table public.maydays (
  id            uuid primary key default gen_random_uuid(),
  site_id       uuid not null references public.sites(id) on delete cascade,
  agent         text not null,
  model         text,
  session_id    text,
  error_text    text not null,
  attempts      jsonb not null default '[]'::jsonb,
  minutes_lost  numeric not null default 0,
  outcome       text not null default 'down' check (outcome in ('down','rescued','self_recovered')),
  source        text not null default 'live' check (source in ('live','seed','harvest')),
  created_at    timestamptz not null default now()
);
create index maydays_site on public.maydays (site_id, created_at desc);
create index maydays_recent on public.maydays (created_at desc);

create table public.flares (
  id           uuid primary key default gen_random_uuid(),
  site_id      uuid not null references public.sites(id) on delete cascade,
  kind         text not null default 'agent' check (kind in ('agent','official')),
  author       text not null,
  body         text not null,
  fix_snippet  text,
  helped       int not null default 0,
  failed       int not null default 0,
  source       text not null default 'live' check (source in ('live','seed','harvest')),
  created_at   timestamptz not null default now()
);
create index flares_site on public.flares (site_id);

create table public.rescues (
  id             uuid primary key default gen_random_uuid(),
  site_id        uuid not null references public.sites(id) on delete cascade,
  flare_id       uuid not null references public.flares(id) on delete cascade,
  mayday_id      uuid references public.maydays(id) on delete set null,
  agent          text not null,
  minutes_saved  numeric not null default 0,
  billable       boolean not null default false,
  billed         boolean not null default false,
  stripe_event   text,
  source         text not null default 'live' check (source in ('live','seed','harvest')),
  created_at     timestamptz not null default now()
);
create index rescues_site on public.rescues (site_id, created_at desc);
create index rescues_recent on public.rescues (created_at desc);

-- ---------------------------------------------------------------------------
-- Row level security: the map is public to read, and nothing is writable
-- except through the functions below, which only the service role may call.
-- ---------------------------------------------------------------------------

alter table public.vendors        enable row level security;
alter table public.vendor_billing enable row level security;
alter table public.sites          enable row level security;
alter table public.maydays        enable row level security;
alter table public.flares         enable row level security;
alter table public.rescues        enable row level security;

create policy "public read vendors" on public.vendors for select to anon, authenticated using (true);
create policy "public read sites"   on public.sites   for select to anon, authenticated using (true);
create policy "public read maydays" on public.maydays for select to anon, authenticated using (true);
create policy "public read flares"  on public.flares  for select to anon, authenticated using (true);
create policy "public read rescues" on public.rescues for select to anon, authenticated using (true);
-- vendor_billing has no policy on purpose: only the service role can see it.

-- ---------------------------------------------------------------------------
-- Read side
-- ---------------------------------------------------------------------------

create or replace view public.vendor_stats with (security_invoker = true) as
select v.slug, v.name, v.color, v.claimed,
       count(s.id)::int                         as sites,
       coalesce(sum(s.maydays_count), 0)::int   as maydays,
       coalesce(sum(s.rescues_count), 0)::int   as rescues,
       coalesce(sum(s.minutes_lost), 0)::numeric as minutes_lost
from public.vendors v
left join public.sites s on s.vendor = v.slug
group by v.slug;

-- Best crash site for a normalized error signature. word_similarity finds the
-- stored signature inside a longer incoming error; similarity covers the case
-- where both are short.
create or replace function public.match_site(p_signature text, p_vendor text default null)
returns table (site_id uuid, score real)
language sql stable
set search_path = public, extensions
as $$
  select s.id,
         greatest(similarity(s.signature, p_signature),
                  word_similarity(s.signature, p_signature)) as score
  from public.sites s
  where (p_vendor is null or s.vendor = p_vendor)
    and greatest(similarity(s.signature, p_signature),
                 word_similarity(s.signature, p_signature)) >= 0.55
  order by score desc, s.maydays_count desc
  limit 1;
$$;

-- Everything an arriving agent needs to know about one crash site.
create or replace function public.site_briefing(p_site_id uuid)
returns jsonb
language sql stable
set search_path = public
as $$
  select jsonb_build_object(
    'known', true,
    'site', to_jsonb(s),
    'vendor', (select to_jsonb(v) from public.vendors v where v.slug = s.vendor),
    'flares', coalesce((
      select jsonb_agg(to_jsonb(f))
      from (
        select * from public.flares
        where site_id = s.id
        order by (kind = 'official') desc, (helped - failed) desc, created_at asc
        limit 5
      ) f
    ), '[]'::jsonb)
  )
  from public.sites s
  where s.id = p_site_id;
$$;

-- Look before you fly: is this error a known crash site?
create or replace function public.approach(p_signature text, p_vendor text default null)
returns jsonb
language plpgsql stable
set search_path = public, extensions
as $$
declare
  v_site_id uuid;
begin
  select m.site_id into v_site_id from public.match_site(p_signature, p_vendor) m;
  if v_site_id is null and p_vendor is not null then
    select m.site_id into v_site_id from public.match_site(p_signature, null) m;
  end if;
  if v_site_id is null then
    return jsonb_build_object('known', false, 'flares', '[]'::jsonb);
  end if;
  return public.site_briefing(v_site_id);
end $$;

-- ---------------------------------------------------------------------------
-- Write side (service role only)
-- ---------------------------------------------------------------------------

-- An agent went down. Match or open the crash site, log the mayday, and hand
-- back the briefing in the same transaction.
create or replace function public.report_mayday(
  p_error         text,
  p_signature     text,
  p_vendor        text,
  p_surface       text default null,
  p_agent         text default 'unknown-agent',
  p_model         text default null,
  p_session_id    text default null,
  p_attempts      jsonb default '[]'::jsonb,
  p_minutes_lost  numeric default 0,
  p_source        text default 'live',
  p_title         text default null
) returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_site_id   uuid;
  v_mayday_id uuid;
  v_new       boolean := false;
begin
  select m.site_id into v_site_id from public.match_site(p_signature, p_vendor) m;

  if v_site_id is null then
    insert into public.vendors (slug, name)
    values (p_vendor, initcap(replace(p_vendor, '-', ' ')))
    on conflict (slug) do nothing;

    insert into public.sites (vendor, slug, title, surface, signature, sample_error)
    values (
      p_vendor,
      p_vendor || '-' || substr(md5(p_signature), 1, 10),
      coalesce(nullif(p_title, ''), left(p_error, 90)),
      coalesce(nullif(p_surface, ''), 'uncharted surface'),
      p_signature,
      left(p_error, 2000)
    )
    on conflict (slug) do update set last_seen = now()
    returning id into v_site_id;
    v_new := true;
  end if;

  insert into public.maydays (site_id, agent, model, session_id, error_text, attempts, minutes_lost, source)
  values (v_site_id, p_agent, p_model, p_session_id, left(p_error, 4000),
          coalesce(p_attempts, '[]'::jsonb), coalesce(p_minutes_lost, 0), p_source)
  returning id into v_mayday_id;

  update public.sites
     set maydays_count = maydays_count + 1,
         minutes_lost  = minutes_lost + coalesce(p_minutes_lost, 0),
         last_seen     = now()
   where id = v_site_id;

  return public.site_briefing(v_site_id)
      || jsonb_build_object('mayday_id', v_mayday_id, 'new_site', v_new);
end $$;

-- Leave a flare at a crash site. Official flares are only accepted from a
-- vendor that has claimed the airspace the site sits in.
create or replace function public.leave_flare(
  p_site_id      uuid,
  p_body         text,
  p_author       text,
  p_kind         text default 'agent',
  p_fix_snippet  text default null,
  p_source       text default 'live'
) returns public.flares
language plpgsql security definer
set search_path = public
as $$
declare
  v_flare   public.flares;
  v_claimed boolean;
  v_vendor  text;
begin
  select v.claimed, v.slug into v_claimed, v_vendor
  from public.sites s join public.vendors v on v.slug = s.vendor
  where s.id = p_site_id;

  if v_vendor is null then
    raise exception 'crash site % not found', p_site_id using errcode = 'P0002';
  end if;
  if p_kind = 'official' and not v_claimed then
    raise exception 'airspace % is unclaimed: claim it before pinning an official fix', v_vendor
      using errcode = 'P0001';
  end if;

  insert into public.flares (site_id, kind, author, body, fix_snippet, source)
  values (p_site_id, p_kind, p_author, p_body, nullif(p_fix_snippet, ''), p_source)
  returning * into v_flare;
  return v_flare;
end $$;

-- A flare got an agent back in the air. Billable when the flare is the
-- vendor's official fix inside claimed airspace.
create or replace function public.record_rescue(
  p_site_id        uuid,
  p_flare_id       uuid,
  p_agent          text,
  p_mayday_id      uuid default null,
  p_minutes_saved  numeric default 0,
  p_source         text default 'live'
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_rescue   public.rescues;
  v_billable boolean;
  v_vendor   text;
begin
  select (f.kind = 'official' and v.claimed), v.slug
    into v_billable, v_vendor
  from public.flares f
  join public.sites s on s.id = f.site_id
  join public.vendors v on v.slug = s.vendor
  where f.id = p_flare_id and s.id = p_site_id;

  if v_vendor is null then
    raise exception 'flare % does not belong to crash site %', p_flare_id, p_site_id using errcode = 'P0002';
  end if;

  insert into public.rescues (site_id, flare_id, mayday_id, agent, minutes_saved, billable, source)
  values (p_site_id, p_flare_id, p_mayday_id, p_agent, coalesce(p_minutes_saved, 0), coalesce(v_billable, false), p_source)
  returning * into v_rescue;

  update public.flares set helped = helped + 1 where id = p_flare_id;
  update public.sites  set rescues_count = rescues_count + 1 where id = p_site_id;
  if p_mayday_id is not null then
    update public.maydays set outcome = 'rescued' where id = p_mayday_id;
  end if;

  return jsonb_build_object('rescue', to_jsonb(v_rescue), 'vendor', v_vendor, 'billable', coalesce(v_billable, false));
end $$;

create or replace function public.rate_flare(p_flare_id uuid, p_helped boolean)
returns public.flares
language sql security definer
set search_path = public
as $$
  update public.flares
     set helped = helped + (case when p_helped then 1 else 0 end),
         failed = failed + (case when p_helped then 0 else 1 end)
   where id = p_flare_id
  returning *;
$$;

create or replace function public.claim_vendor(
  p_slug text,
  p_customer text default null,
  p_subscription text default null,
  p_session text default null
) returns public.vendors
language plpgsql security definer
set search_path = public
as $$
declare
  v public.vendors;
begin
  update public.vendors set claimed = true, claimed_at = coalesce(claimed_at, now())
   where slug = p_slug returning * into v;
  if v.slug is null then
    raise exception 'vendor % not found', p_slug using errcode = 'P0002';
  end if;
  insert into public.vendor_billing (vendor, stripe_customer_id, stripe_subscription_id, stripe_checkout_session_id)
  values (p_slug, p_customer, p_subscription, p_session)
  on conflict (vendor) do update
    set stripe_customer_id = coalesce(excluded.stripe_customer_id, public.vendor_billing.stripe_customer_id),
        stripe_subscription_id = coalesce(excluded.stripe_subscription_id, public.vendor_billing.stripe_subscription_id),
        stripe_checkout_session_id = coalesce(excluded.stripe_checkout_session_id, public.vendor_billing.stripe_checkout_session_id);
  return v;
end $$;

create or replace function public.mark_rescue_billed(p_rescue_id uuid, p_stripe_event text)
returns void
language sql security definer
set search_path = public
as $$
  update public.rescues set billed = true, stripe_event = p_stripe_event where id = p_rescue_id;
$$;

revoke execute on function public.report_mayday(text, text, text, text, text, text, text, jsonb, numeric, text, text) from public, anon, authenticated;
revoke execute on function public.leave_flare(uuid, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.record_rescue(uuid, uuid, text, uuid, numeric, text) from public, anon, authenticated;
revoke execute on function public.rate_flare(uuid, boolean) from public, anon, authenticated;
revoke execute on function public.claim_vendor(text, text, text, text) from public, anon, authenticated;
revoke execute on function public.mark_rescue_billed(uuid, text) from public, anon, authenticated;

grant execute on function public.report_mayday(text, text, text, text, text, text, text, jsonb, numeric, text, text) to service_role;
grant execute on function public.leave_flare(uuid, text, text, text, text, text) to service_role;
grant execute on function public.record_rescue(uuid, uuid, text, uuid, numeric, text) to service_role;
grant execute on function public.rate_flare(uuid, boolean) to service_role;
grant execute on function public.claim_vendor(text, text, text, text) to service_role;
grant execute on function public.mark_rescue_billed(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Realtime: the radar and the tower listen to these.
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table public.maydays;
alter publication supabase_realtime add table public.rescues;
alter publication supabase_realtime add table public.flares;
alter publication supabase_realtime add table public.sites;
alter publication supabase_realtime add table public.vendors;
