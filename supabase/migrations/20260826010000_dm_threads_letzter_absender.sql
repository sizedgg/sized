-- ============================================================================
-- The inbox should show who wrote last
--
-- Until now, dm_threads only delivered the text of the last message.
-- Whether it came from Ansem or from the other side couldn't be told from
-- that - so the inbox showed "checking" next to "any chance of a mobile app
-- later" with no way to see that the first one is his own reply.
--
-- That's the piece of information that matters when working through it: is
-- the ball still in my court?
--
-- This is determined the same way the preview text itself is - via the
-- highest id, not via created_at. The id is strictly increasing, so two
-- messages in the same second stay unambiguously ordered.
--
-- create or replace on a view can only append columns, not rename or remove
-- them. That's why last_from_admin sits at the end.
-- ============================================================================

-- Drop first, then recreate. "create or replace view" can only APPEND
-- columns, not remove them - and a later migration extends this view. On
-- the second run of the migrations (which has to work, e.g. when setting up
-- a fresh project), this line would otherwise hit the wider version and
-- bail out with "cannot drop columns from view".
drop view if exists public.dm_threads;
create or replace view public.dm_threads
with (security_invoker = on) as
select
  d.wallet,
  count(*)::bigint                                    as total,
  max(d.created_at)                                   as last_at,
  count(*) filter (where not d.from_admin
                     and not d.read_by_admin)::bigint as unread,
  coalesce(w.ui_amount, 0)                            as tokens,
  coalesce(w.usd_value, 0)                            as usd,
  (array_agg(d.body       order by d.id desc))[1]     as preview,
  (array_agg(d.from_admin order by d.id desc))[1]     as last_from_admin
from public.dms d
left join public.wallets w on w.address = d.wallet
group by d.wallet, w.ui_amount, w.usd_value;

comment on view public.dm_threads is
  'Ein Eintrag je Gespraech: Vorschau, Bestand und wer zuletzt geschrieben hat.';

grant select on public.dm_threads to authenticated;
