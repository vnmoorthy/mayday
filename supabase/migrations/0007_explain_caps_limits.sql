-- 1. match_candidates(): the scores behind a match, so anyone can see why an
--    error landed on a crash site.
-- 2. A daily spend cap per vendor, enforced where the rescue is recorded.
-- 3. A small fixed-window rate limiter for the open write API.
-- 4. sites.charted: whether a crash site came from the charted (seed) set, so
--    the interface can tell old folklore from failures first seen in the wild.

create or replace function public.match_candidates(
  p_signature text,
  p_vendor text default null,
  p_codes text[] default '{}',
  p_limit int default 5
) returns table (
  site_id uuid, slug text, title text, vendor text, maydays_count int,
  trigram real, signature_in_error real, error_in_signature real,
  code_match boolean, score real, matched boolean
)
language sql stable
set search_path = public, extensions
as $$
  with scored as (
    select s.id, s.slug, s.title, s.vendor, s.maydays_count,
           similarity(s.signature, p_signature)::real as trigram,
           word_similarity(s.signature, p_signature)::real as signature_in_error,
           (case when length(p_signature) >= 24
                 then word_similarity(p_signature, s.signature) else 0 end)::real as error_in_signature,
           exists (
             select 1 from unnest(p_codes) c
             where length(c) >= 6 and position(lower(c) in lower(s.sample_error)) > 0
           ) as code_match
    from public.sites s
    where p_vendor is null or s.vendor = p_vendor
  )
  select id, slug, title, vendor, maydays_count,
         trigram, signature_in_error, error_in_signature, code_match,
         greatest(trigram, signature_in_error, error_in_signature,
                  case when code_match then 0.8 else 0 end)::real as score,
         greatest(trigram, signature_in_error, error_in_signature,
                  case when code_match then 0.8 else 0 end) >= 0.55 as matched
  from scored
  order by score desc, maydays_count desc
  limit greatest(1, least(p_limit, 20));
$$;

alter table public.vendor_billing add column if not exists daily_cap_cents int not null default 2500;
alter table public.sites add column if not exists charted boolean not null default false;
update public.sites s set charted = true
 where exists (select 1 from public.maydays m where m.site_id = s.id and m.source = 'seed');

-- record_rescue, now with the spend cap. Everything else is unchanged from 0006.
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
  v_rescue    public.rescues;
  v_official  boolean;
  v_claimed   boolean;
  v_vendor    text;
  v_billable  boolean;
  v_real      boolean := false;
  v_rate      int;
  v_cap       int;
  v_today     int;
  v_note      text := null;
begin
  select (f.kind = 'official'), v.claimed, v.slug
    into v_official, v_claimed, v_vendor
  from public.flares f
  join public.sites s on s.id = f.site_id
  join public.vendors v on v.slug = s.vendor
  where f.id = p_flare_id and s.id = p_site_id;

  if v_vendor is null then
    raise exception 'flare % does not belong to crash site %', p_flare_id, p_site_id using errcode = 'P0002';
  end if;

  if p_mayday_id is not null then
    select * into v_rescue from public.rescues where mayday_id = p_mayday_id;
    if found then
      return jsonb_build_object('rescue', to_jsonb(v_rescue), 'vendor', v_vendor,
                                'billable', v_rescue.billable, 'duplicate', true);
    end if;
    select true into v_real
    from public.maydays m
    where m.id = p_mayday_id and m.site_id = p_site_id
      and m.created_at > now() - interval '6 hours';
  end if;

  v_billable := coalesce(v_official and v_claimed and v_real, false);
  if v_official and v_claimed and not coalesce(v_real, false) then
    v_note := 'not billable: the rescue is not tied to a recent mayday on this crash site';
  end if;

  -- Spend cap: a vendor is never billed past its daily limit, whatever arrives.
  if v_billable then
    select coalesce(b.rate_cents, 25), coalesce(b.daily_cap_cents, 2500)
      into v_rate, v_cap
    from public.vendors v left join public.vendor_billing b on b.vendor = v.slug
    where v.slug = v_vendor;
    select count(*) into v_today
    from public.rescues r join public.sites s on s.id = r.site_id
    where s.vendor = v_vendor and r.billable and r.created_at >= date_trunc('day', now());
    if (v_today + 1) * v_rate > v_cap then
      v_billable := false;
      v_note := 'not billable: the vendor''s daily spend cap is reached';
    end if;
  end if;

  begin
    insert into public.rescues (site_id, flare_id, mayday_id, agent, minutes_saved, billable, source)
    values (p_site_id, p_flare_id, p_mayday_id, p_agent, coalesce(p_minutes_saved, 0), v_billable, p_source)
    returning * into v_rescue;
  exception when unique_violation then
    select * into v_rescue from public.rescues where mayday_id = p_mayday_id;
    return jsonb_build_object('rescue', to_jsonb(v_rescue), 'vendor', v_vendor,
                              'billable', v_rescue.billable, 'duplicate', true);
  end;

  update public.flares set helped = helped + 1 where id = p_flare_id;
  update public.sites  set rescues_count = rescues_count + 1 where id = p_site_id;
  if p_mayday_id is not null then
    update public.maydays set outcome = 'rescued' where id = p_mayday_id;
  end if;

  return jsonb_build_object('rescue', to_jsonb(v_rescue), 'vendor', v_vendor,
                            'billable', v_billable, 'duplicate', false, 'note', v_note);
end $$;

-- Fixed-window rate limiter. Returns true while the caller is under the limit.
create table if not exists public.rate_windows (
  key          text not null,
  window_start timestamptz not null,
  hits         int not null default 0,
  primary key (key, window_start)
);
alter table public.rate_windows enable row level security;

create or replace function public.rate_limit(p_key text, p_max int default 300, p_window_seconds int default 60)
returns boolean
language plpgsql security definer
set search_path = public
as $$
declare
  v_start timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits  int;
begin
  insert into public.rate_windows (key, window_start, hits) values (p_key, v_start, 1)
  on conflict (key, window_start) do update set hits = public.rate_windows.hits + 1
  returning hits into v_hits;
  -- Old windows are swept opportunistically.
  if random() < 0.02 then
    delete from public.rate_windows where window_start < now() - interval '1 hour';
  end if;
  return v_hits <= p_max;
end $$;

revoke execute on function public.rate_limit(text, int, int) from public, anon, authenticated;
grant execute on function public.rate_limit(text, int, int) to service_role;
