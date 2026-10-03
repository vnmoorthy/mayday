-- An agent often reports only part of an error (one line of a longer message).
-- Match in both directions: the stored signature inside the incoming error, or
-- the incoming error inside the stored signature. The second direction is only
-- trusted for queries long enough to be specific.

create or replace function public.match_site(p_signature text, p_vendor text default null)
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
                  else 0 end
           ) as score
    from public.sites s
    where p_vendor is null or s.vendor = p_vendor
  )
  select id, score
  from scored
  where score >= 0.55
  order by score desc, maydays_count desc
  limit 1;
$$;
