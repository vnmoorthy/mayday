-- 1. A rescue is exactly-once per stop signal. Confirming the same rescue twice
--    (a retried request, an agent calling twice) returns the first rescue instead
--    of inserting a second, so a vendor can never be billed twice for one
--    failure. A rescue is only billable when it points at a real, recent
--    stop signal on the same crash site.
-- 2. Incidents are pushed, not polled: a trigger on the maydays table (where
--    stop signals are stored) checks the site
--    against its own baseline and broadcasts over Realtime when it spikes.

delete from public.rescues r
using public.rescues keep
where r.mayday_id is not null
  and r.mayday_id = keep.mayday_id
  and (r.created_at, r.id) > (keep.created_at, keep.id);

create unique index if not exists rescues_one_per_mayday
  on public.rescues (mayday_id) where mayday_id is not null;

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

  -- Already confirmed for this stop signal: hand back the first rescue, change nothing.
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

  begin
    insert into public.rescues (site_id, flare_id, mayday_id, agent, minutes_saved, billable, source)
    values (p_site_id, p_flare_id, p_mayday_id, p_agent, coalesce(p_minutes_saved, 0), v_billable, p_source)
    returning * into v_rescue;
  exception when unique_violation then
    -- Two confirmations raced: the other one won.
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
                            'billable', v_billable, 'duplicate', false);
end $$;

-- Broadcast a spike the moment the stop signal that causes it is inserted.
create or replace function public.broadcast_incident()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v record;
begin
  select * into v from public.site_incidents(30, 3) i where i.site_id = new.site_id;
  if found then
    perform realtime.send(
      jsonb_build_object(
        'site_id', v.site_id, 'slug', v.slug, 'title', v.title, 'vendor', v.vendor,
        'surface', v.surface, 'recent', v.recent, 'baseline', v.baseline, 'ratio', v.ratio,
        'first_recent', v.first_recent, 'last_recent', v.last_recent),
      'incident',   -- event
      'incidents',  -- topic
      false         -- public channel
    );
  end if;
  return new;
exception when others then
  -- A failed broadcast must never fail the stop signal itself.
  return new;
end $$;

drop trigger if exists maydays_broadcast_incident on public.maydays;
create trigger maydays_broadcast_incident
  after insert on public.maydays
  for each row execute function public.broadcast_incident();
