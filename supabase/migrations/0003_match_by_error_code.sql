-- Error codes (PGRST116, FUNCTION_INVOCATION_TIMEOUT, overloaded_error) are the
-- most stable part of an error: the wording around them changes between
-- versions. When an incoming error carries a code that a crash site's sample
-- error also carries, treat that as a match even if the trigrams disagree.
-- Also: when the vendor guess finds nothing, look across every airspace before
-- opening a new crash site.

drop function if exists public.approach(text, text);
drop function if exists public.report_mayday(text, text, text, text, text, text, text, jsonb, numeric, text, text);
drop function if exists public.match_site(text, text);

create function public.match_site(p_signature text, p_vendor text default null, p_codes text[] default '{}')
returns table (site_id uuid, score real)
language sql stable
set search_path = public, extensions
as $$
  with scored as (
    select s.id,
           s.maydays_count,
           greatest(
             similarity(s.signature, p_signature),
             word_similarity(s.signature, p_signature),
             case when length(p_signature) >= 24
                  then word_similarity(p_signature, s.signature)
                  else 0 end,
             case when exists (
                    select 1 from unnest(p_codes) c
                    where length(c) >= 6 and position(lower(c) in lower(s.sample_error)) > 0
                  ) then 0.8 else 0 end
           )::real as score
    from public.sites s
    where p_vendor is null or s.vendor = p_vendor
  )
  select id, score
  from scored
  where score >= 0.55
  order by score desc, maydays_count desc
  limit 1;
$$;

create function public.approach(p_signature text, p_vendor text default null, p_codes text[] default '{}')
returns jsonb
language plpgsql stable
set search_path = public, extensions
as $$
declare
  v_site_id uuid;
begin
  select m.site_id into v_site_id from public.match_site(p_signature, p_vendor, p_codes) m;
  if v_site_id is null and p_vendor is not null then
    select m.site_id into v_site_id from public.match_site(p_signature, null, p_codes) m;
  end if;
  if v_site_id is null then
    return jsonb_build_object('known', false, 'flares', '[]'::jsonb);
  end if;
  return public.site_briefing(v_site_id);
end $$;

create function public.report_mayday(
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
  p_title         text default null,
  p_codes         text[] default '{}'
) returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_site_id   uuid;
  v_mayday_id uuid;
  v_new       boolean := false;
begin
  select m.site_id into v_site_id from public.match_site(p_signature, p_vendor, p_codes) m;
  if v_site_id is null then
    select m.site_id into v_site_id from public.match_site(p_signature, null, p_codes) m;
  end if;

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

revoke execute on function public.report_mayday(text, text, text, text, text, text, text, jsonb, numeric, text, text, text[]) from public, anon, authenticated;
grant execute on function public.report_mayday(text, text, text, text, text, text, text, jsonb, numeric, text, text, text[]) to service_role;
