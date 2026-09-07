-- ============================================================================
-- Zeroing out before launch
--
-- Removes all test and load-test data. Kept back are exactly two wallet
-- entries: the test address and the address entered in app_config as
-- administrator. Both stay so existing sessions keep working and nobody
-- has to verify (and pay) again.
--
-- What disappears:
--   * around 27,400 load-test addresses from wallets
--   * all messages (105 from the load test, 76 from manual testing)
--   * all DMs (the 50 seeded threads)
--   * the three test polls, options included
--   * all payment requests
--
-- There are no votes (checked: 0), so no poll results get lost.
--
-- INSTRUCTIONS
--   Run section 1 alone first - it only displays.
--   Then section 2.
--   Run section 3 ONE STATEMENT AT A TIME: VACUUM can't run inside a
--   transaction, and the SQL editor bundles multiple statements into one.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- BEFORE RUNNING: replace DEIN_TEST_WALLET
-- ----------------------------------------------------------------------------
-- A real address used to sit here. It's gone because this repo is public:
-- a wallet that sits in a project's source code is the operator's wallet -
-- and therefore a thread someone can pull on.
--
-- Whoever doesn't want to spare a test wallet enters a value instead that
-- doesn't exist. The query stays correct then, it just keeps nothing.

-- ----------------------------------------------------------------------------
-- 1. PREVIEW
-- ----------------------------------------------------------------------------
select
  (select count(*) from public.wallets)    as wallets_jetzt,
  (select count(*) from public.wallets
     where address = 'DEIN_TEST_WALLET'
        or address = (select admin_wallet from public.app_config where id = 1))
                                            as wallets_bleiben,
  (select count(*) from public.messages)   as nachrichten,
  (select count(*) from public.dms)        as dms,
  (select count(*) from public.polls)      as polls,
  (select count(*) from public.votes)      as stimmen,
  (select count(*) from public.challenges) as challenges,
  (select admin_wallet from public.app_config where id = 1) as admin_wallet;


-- ----------------------------------------------------------------------------
-- 2. CLEARING
-- ----------------------------------------------------------------------------
-- Order isn't arbitrary: polls clears its options and votes along with it
-- via "on delete cascade", so it has to come before wallets.

delete from public.votes;
delete from public.polls;          -- takes poll_options with it
delete from public.messages;       -- reply_to is "on delete set null"
delete from public.dms;
delete from public.challenges;
delete from public.seen_txs;

delete from public.wallets
where address <> 'DEIN_TEST_WALLET'
  and address is distinct from (select admin_wallet from public.app_config where id = 1);

-- Responses from net.http_post - these pile up from the cron jobs.
delete from net._http_response where created < now() - interval '1 hour';


-- ----------------------------------------------------------------------------
-- 3. RECLAIMING SPACE - please run ONE AT A TIME, one line after the other
-- ----------------------------------------------------------------------------
-- Without this, Postgres keeps holding the 11 MB and keeps planning around
-- 27,000 rows, so it picks bad access paths for a table that now has two.

vacuum full analyze public.wallets;
vacuum full analyze public.messages;
vacuum full analyze public.dms;


-- ----------------------------------------------------------------------------
-- 4. AFTERWARD
-- ----------------------------------------------------------------------------
select
  relname as tabelle,
  n_live_tup as zeilen,
  pg_size_pretty(pg_total_relation_size(relid)) as groesse
from pg_stat_user_tables
order by pg_total_relation_size(relid) desc
limit 10;
