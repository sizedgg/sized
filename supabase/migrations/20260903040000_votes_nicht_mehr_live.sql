-- ----------------------------------------------------------------------------
-- public.votes leaves the Realtime publication
--
-- Why
--
-- Realtime counts deliveries, not changes: one row going out to 500
-- listeners is 500 messages. And votes_read is `using (true)` -
-- votes are deliberately visible to everyone, so the weighting stays
-- verifiable. So not a single listener drops out of the permission check.
--
-- The case the site is built for: Ansem puts up a poll, 500 people are
-- there and vote within half a minute. About 17 votes per second times
-- 500 browsers is roughly 8,300 messages per second. The quota is 500 or
-- 2,500 depending on plan. Above that, Supabase closes the channels with
-- "Too many messages per second", every browser rejoins at once and they
-- all pile up against the join-rate limit.
--
-- A vote count is a counter, not an event. The polls tab already polls
-- for it itself every 5 seconds (STIMMEN_TAKT_MS in public/app.js).
-- Ordinary queries don't count against any Realtime quota.
--
-- What stays live
--
--   polls, poll_options -> a new or closed poll, a few times a day,
--                          should appear immediately
--   dms                 -> a message to a single person waiting for
--                          a reply
--   messages            -> unchanged
--
-- HEADS UP for later
--
-- Whoever adds the `.on(… table: 'votes' …)` line back into public/app.js
-- must also add the table back here. Otherwise nothing arrives at all -
-- no error, no warning, no console entry. This migration is the only
-- place that says so.
--
-- replica identity full stays
--
-- It costs nothing as long as the table isn't published, and would be
-- the silent trap when switching it back on. So leave it in place.
-- ----------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public' and tablename = 'votes'
     )
  then
    alter publication supabase_realtime drop table public.votes;
  end if;
end $$;
