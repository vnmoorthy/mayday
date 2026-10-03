// An embedded copy of match_site() from
// supabase/migrations/0003_match_by_error_code.sql. The matching page reads the
// migration file itself at request time and only falls back to this copy when
// the file is not on disk (for example inside a serverless bundle).

export const MATCH_SITE_MIGRATION = "supabase/migrations/0003_match_by_error_code.sql";

export const MATCH_SITE_SQL = `create function public.match_site(p_signature text, p_vendor text default null, p_codes text[] default '{}')
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
$$;`;
