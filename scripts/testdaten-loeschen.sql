-- ============================================================================
-- Clear out everything that piled up from trying things
-- ============================================================================
--
-- Run this in the SQL editor, BEFORE start-konfiguration.sql. Afterward the
-- database looks as if nobody has ever used it: Ansem's first poll gets
-- number 1, his first message too.
--
-- TWO STEPS. This script clears the database. The preview images don't live
-- in the database, they live in Storage, and that can't be touched via SQL -
-- see the section "The preview images" below for that. Without it the job
-- isn't done, even though everything here reads 0.
--
-- ----------------------------------------------------------------------------
-- Why truncate and not delete
--
-- Two reasons, and the second is the real one:
--
--   1. restart identity resets the counters. After a delete, the next poll
--      keeps going from the next free number - with seventeen test polls,
--      Ansem would start at 18. That's exactly what shouldn't happen.
--
--   2. truncate doesn't fire row-level triggers. Since migration
--      20260907020000, an answer option can no longer be deleted once
--      someone has voted on it - and that's correct behavior. A delete on
--      poll_options would fail here as a result.
--
-- Everything in one transaction: either everything is empty afterward, or
-- nothing was touched at all. A half-cleared state would be worse than a
-- full one, because you'd mistake it for empty.
-- ============================================================================

begin;

-- Polls, messages, conversations. cascade cleans up whatever hangs off
-- them; the counters go back to the start.
truncate
  public.votes,
  public.poll_options,
  public.polls,
  public.poll_totals,
  public.dms,
  public.dm_hidden,
  public.messages
  restart identity cascade;

-- Open and expired login attempts. No counter, hence delete.
delete from public.challenges;

-- The holdings data of the test wallets.
--
-- No real loss: wallets isn't a source, it's a snapshot of the chain.
-- Anyone signing in again gets their holdings re-read at sign-in. If you'd
-- rather keep your own test wallets around, strike this line.
delete from public.wallets;

commit;


-- ----------------------------------------------------------------------------
-- The preview images - the second step, NOT via SQL
-- ----------------------------------------------------------------------------
-- This used to say:
--
--   delete from storage.objects where bucket_id = 'og';
--
-- That doesn't work. Supabase hangs a trigger in front of storage.objects
-- (storage.protect_delete) and rejects every direct delete:
--
--   ERROR: 42501: Direct deletion from storage tables is not allowed.
--          Use the Storage API instead.
--
-- And rightly so: the row in storage.objects is just the directory entry,
-- the file itself lives elsewhere. Deleting the row doesn't delete the
-- file, it only makes it unfindable - it still sits there and is still
-- publicly reachable. That's exactly why it's locked down.
--
-- Instead, in the dashboard: Storage -> bucket "og" -> select all -> Delete.
-- There are as many files as there were test polls.
--
-- WHY THIS ISN'T OPTIONAL, even though nothing of it shows in the app: the
-- images are named poll-<id>-v9.png, and the numbers start over at 1 after
-- this script. If poll-1-v9.png is left behind, Ansem's first real poll
-- shows up on X under the image of a test poll. It would first be noticed
-- in his timeline.


-- ----------------------------------------------------------------------------
-- What DELIBERATELY stays: seen_txs
-- ----------------------------------------------------------------------------
-- It holds the signatures of transfers that have already been counted
-- toward a sign-in. The primary key on signature is what blocks the same
-- payment from counting twice.
--
-- Clearing it wouldn't be dramatic: a payment gets matched to a sign-in by
-- amount AND sender (see verify/index.ts), so an old test payment could at
-- most log your own test wallet in again, and it wouldn't take anything
-- from anyone else. But leaving it alone costs nothing, and it's the one
-- table whose entire purpose is "never twice".
--
-- If you still want a database that's completely empty:
--
--   delete from public.seen_txs;


-- ----------------------------------------------------------------------------
-- Verification
-- ----------------------------------------------------------------------------
-- Two columns deserve a second look.
--
-- naechste_abstimmung_ist_1 doesn't ask whether the table is empty - it asks
-- the counter what it would hand out next. That's the real answer to "does
-- Ansem start at 1?".
--
-- vorschaubilder will NOT yet read 0 after this script, because the
-- dashboard is what clears those (see above). Run this same query again
-- after cleaning up there - then it must say 0.
select
  (select count(*) from public.polls)        as abstimmungen,
  (select count(*) from public.poll_options) as antwortmoeglichkeiten,
  (select count(*) from public.votes)        as stimmen,
  (select count(*) from public.dms)          as dms,
  (select count(*) from public.messages)     as chatnachrichten,
  (select count(*) from public.challenges)   as offene_anmeldungen,
  (select count(*) from public.wallets)      as wallets,
  (select count(*) from storage.objects
     where bucket_id = 'og')                 as vorschaubilder,
  (select count(*) from public.seen_txs)     as gesehene_zahlungen_bleiben,
  pg_get_serial_sequence('public.polls', 'id') is not null
    and (select last_value = 1 and is_called = false
         from public.polls_id_seq)           as naechste_abstimmung_ist_1;
