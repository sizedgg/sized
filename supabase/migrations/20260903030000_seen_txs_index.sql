-- ----------------------------------------------------------------------------
-- An index for the sieve in the treasury scan
--
-- Before every run, scanTreasury() fetches the last 600 recorded
-- signatures and passes them to recentTreasuryPayments() as a sieve:
-- whatever's already recorded then costs no detail lookup against the RPC.
--
-- This query reads "order by seen_at desc limit 600". Without an index
-- that means a full scan plus sort over public.seen_txs - unnoticeable
-- right now, but the table grows by one row per payment and is never
-- cleaned up. At a launch with many sign-ins, this query runs every 5
-- seconds.
--
-- Descending, because the query reads descending: that way it's a look at
-- just the first 600 entries of the index and nothing more.
-- ----------------------------------------------------------------------------

create index if not exists seen_txs_seen_at_idx
  on public.seen_txs (seen_at desc);
