-- ============================================================================
-- Remove load-test leftovers
--
-- The wallets table holds 27,477 rows. A handful of those are real - the
-- rest come from the load test, which generated random addresses.
--
-- Why this costs more than just storage:
--
--   * The price tick rewrites every wallet each minute whose usd_value
--     changes with the new price. With 27,000 rows and a price that keeps
--     moving, that is roughly 27,000 writes per minute - around 39 million
--     a day, for addresses that do not exist.
--
--   * Job 3 (refresh-holdings) takes the 120 oldest wallets per run and
--     reads their balance from the chain. With 27,000 entries a full pass
--     takes a good four hours and starts right over from the beginning.
--     That is 172,800 RPC calls a day, all for invented addresses.
--
-- This is very likely the reason for the warning in the dashboard.
--
-- INSTRUCTIONS: Run section 1 alone first and look at the numbers. Only
-- then section 2. Section 1 changes nothing.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. PREVIEW - what would disappear, what stays?
-- ----------------------------------------------------------------------------
-- Kept is every address that shows up anywhere else: as the sender of a
-- message, in a DM thread, with a vote in a poll, with an open payment
-- request - and Ansem himself.
with behalten as (
  select wallet from public.messages
  union select wallet from public.dms
  union select wallet from public.votes
  union select wallet from public.challenges where status = 'pending'
  union select admin_wallet from public.app_config where admin_wallet is not null
)
select
  count(*) filter (where w.address in (select wallet from behalten)) as bleibt,
  count(*) filter (where w.address not in (select wallet from behalten)) as wird_geloescht,
  count(*)                                                            as gesamt
from public.wallets w;

-- And for safety: which addresses stay? These should be few, and ones you
-- recognize.
with behalten as (
  select wallet from public.messages
  union select wallet from public.dms
  union select wallet from public.votes
  union select wallet from public.challenges where status = 'pending'
  union select admin_wallet from public.app_config where admin_wallet is not null
)
select w.address, w.ui_amount, w.usd_value, w.updated_at
from public.wallets w
where w.address in (select wallet from behalten)
order by w.usd_value desc nulls last;


-- ----------------------------------------------------------------------------
-- 2. CLEANUP - run only once section 1 looked plausible
-- ----------------------------------------------------------------------------

-- Messages from the load test. They all carry the same marker.
delete from public.messages where body like '[loadtest]%';

-- Payment requests that were never redeemed.
delete from public.challenges where status = 'pending';

-- And the wallets themselves.
delete from public.wallets w
where w.address not in (
  select wallet from public.messages
  union select wallet from public.dms
  union select wallet from public.votes
  union select wallet from public.challenges where status = 'pending'
  union select admin_wallet from public.app_config where admin_wallet is not null
);

-- After a delete of this size Postgres first needs to release the space
-- and rebuild its statistics. Without that it keeps planning for 27,000
-- rows and picks poor access paths.
vacuum full analyze public.wallets;
vacuum full analyze public.messages;

-- Responses from net.http_post pile up here - pg_net cleans them up, but
-- with a delay. Anything older than an hour is no longer needed.
delete from net._http_response where created < now() - interval '1 hour';


-- ----------------------------------------------------------------------------
-- 3. AFTER - the same overview as in the diagnosis
-- ----------------------------------------------------------------------------
select
  relname as tabelle,
  n_live_tup as zeilen,
  pg_size_pretty(pg_total_relation_size(relid)) as groesse
from pg_stat_user_tables
order by pg_total_relation_size(relid) desc
limit 10;
