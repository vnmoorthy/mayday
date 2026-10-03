-- A claimed airspace is not a verified vendor. `verified` is set only by
-- Mayday itself (service role), after checking that the claimant controls the
-- vendor's domain. Until then every pinned fix is shown as an unverified claim.
alter table public.vendors add column if not exists verified boolean not null default false;
