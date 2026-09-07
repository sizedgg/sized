-- ============================================================================
-- Votes are kept as a running tally, not recomputed on every fetch
-- ============================================================================
--
-- The problem
--
-- public.poll_results used to be a view:
--
--   select poll_id, option_id, count(*), sum(weight_usd)
--   from public.votes group by poll_id, option_id
--
-- No where clause. So every fetch summed up EVERY vote ever cast, across all
-- polls, including ones long since closed. A full scan through the votes
-- table, every single time.
--
-- And this now gets fetched on a clock: since votes stopped being pushed and
-- started being polled instead (STIMMEN_TAKT_MS in public/app.js), every open
-- Polls tab fetches the results every 5 seconds. At 3,000 viewers that's 600
-- fetches per second.
--
-- Measured against real Postgres, 600 fetches per second:
--
--     3,000 votes   ->  1.0 ms per fetch  ->  0.6 cores busy
--    10,000 votes   ->  2.9 ms            ->  1.7 cores
--    30,000 votes   ->  8.6 ms            ->  5.2 cores
--   100,000 votes   -> 28.3 ms            -> 17.0 cores
--
-- A Pro instance has two cores, and they're also doing everything else at
-- the same time. The site would have survived its first polls and turned
-- sluggish over its first week - not with a bang, but gradually.
--
-- ----------------------------------------------------------------------------
-- The fix
--
-- The sum is kept up to date on WRITE instead of computed on read. One row
-- per answer option, maintained by a trigger. A fetch then reads a few dozen
-- rows instead of a hundred thousand:
--
--   before (180,000 votes):  55.3 ms
--   after:                    0.03 ms
--
-- That's roughly 1,800 times cheaper, and it no longer grows with the number
-- of votes - only with the number of answer options, and that sits at four
-- per poll.
--
-- The cost sits on the write side: every vote now also pays for a small
-- update. That's exactly the right trade - a vote gets cast once and read a
-- thousand times.
--
-- ----------------------------------------------------------------------------
-- Why the public.poll_results view stays
--
-- The browser keeps querying `from('poll_results').select('*')`. The view
-- now just sits on top of the totals table instead of the votes. Nothing
-- changes on the client this way, and if something here went wrong, it would
-- be a migration back, not a new deployment of app.js.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The table
-- ----------------------------------------------------------------------------

create table if not exists public.poll_totals (
  option_id bigint primary key
              references public.poll_options(id) on delete cascade,
  poll_id   bigint not null
              references public.polls(id) on delete cascade,
  votes     bigint         not null default 0,
  usd       numeric(20, 4) not null default 0
);

create index if not exists idx_poll_totals_poll on public.poll_totals (poll_id);

alter table public.poll_totals enable row level security;

-- Readable like the votes themselves: votes_read is set to `using (true)`,
-- so the weighting stays traceable. A sum built from those rows must not be
-- more secret than the rows it comes from.
drop policy if exists poll_totals_read on public.poll_totals;
create policy poll_totals_read on public.poll_totals
  for select to authenticated using (true);

-- No insert/update/delete for clients. Writes happen exclusively through the
-- trigger below, and it runs as security definer.
grant select on public.poll_totals to authenticated;

-- ----------------------------------------------------------------------------
-- 2. The trigger that maintains it
-- ----------------------------------------------------------------------------
--
-- It's attached AFTER on public.votes, so it sees the values the two
-- existing BEFORE triggers have already set:
--
--   trg_votes_stamp  (before insert or update) -> sets weight_usd
--   trg_votes_freeze (before update)           -> blocks unauthorized changes
--
-- Order matters here, and it's correct: by the time this trigger runs,
-- new.weight_usd already holds the final value. If it read it earlier, the
-- sum would permanently drift from the votes.
--
-- Three cases, and all three actually occur:
--
--   INSERT  someone casts a vote
--   DELETE  app.sync_votes_with_balance() deletes the vote when holdings
--           drop to 0 - whoever holds nothing anymore weighs nothing anymore
--   UPDATE  two paths: the vote moves to a different answer (the user
--           changes their mind, onConflict poll_id,wallet), OR the weight
--           changes because the holdings changed
--
-- The UPDATE case is handled as "subtract the old row, add the new row".
-- That covers both paths, even if both change at once, and is shorter than
-- a case distinction that's easy to branch wrong.
-- ----------------------------------------------------------------------------

create or replace function app.poll_totals_pflegen()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Subtract the old row
  if tg_op in ('DELETE', 'UPDATE') then
    update public.poll_totals
       set votes = votes - 1,
           usd   = usd - old.weight_usd
     where option_id = old.option_id;
  end if;

  -- Add the new row. `on conflict` creates the totals row on first access
  -- instead of requiring it to be created alongside the poll - this way no
  -- answer option can end up without a totals row.
  if tg_op in ('INSERT', 'UPDATE') then
    insert into public.poll_totals (option_id, poll_id, votes, usd)
    values (new.option_id, new.poll_id, 1, new.weight_usd)
    on conflict (option_id) do update
      set votes = public.poll_totals.votes + 1,
          usd   = public.poll_totals.usd + excluded.usd;
  end if;

  return null; -- AFTER trigger: the return value gets discarded anyway
end;
$$;

drop trigger if exists trg_votes_totals on public.votes;
create trigger trg_votes_totals
  after insert or update or delete on public.votes
  for each row execute function app.poll_totals_pflegen();

-- ----------------------------------------------------------------------------
-- 3. Rebuild from scratch - for the initial fill and for emergencies
-- ----------------------------------------------------------------------------
--
-- A running tally can in principle drift; a freshly computed one can't.
-- That's why there's a way back to the ground truth here, and the test
-- scripts/test-schema.mjs compares the two against each other after every
-- operation.
-- ----------------------------------------------------------------------------

create or replace function app.poll_totals_neu_aufbauen()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.poll_totals;
  insert into public.poll_totals (option_id, poll_id, votes, usd)
  select v.option_id, v.poll_id, count(*), sum(v.weight_usd)
    from public.votes v
   group by v.option_id, v.poll_id;
end;
$$;

select app.poll_totals_neu_aufbauen();

-- ----------------------------------------------------------------------------
-- 4. The view now points at the totals table
-- ----------------------------------------------------------------------------
--
-- Drop first, then recreate: "create or replace view" can't swap out the
-- underlying structure. The detour through drop is the only way.
--
-- The `usd::numeric` is NOT a cosmetic flaw, it's necessary, and skipping it
-- costs half an hour of searching:
--
-- The migrations need to be able to run a second time - say, when setting
-- up a fresh project, or in scripts/test-schema.mjs. On the second run, the
-- old line in 20260823020000_init.sql ("create or replace view
-- public.poll_results ... sum(v.weight_usd)") collides with this view here.
-- sum() over numeric(20,4) returns numeric WITHOUT a precision/scale; but
-- the column in the totals table has numeric(20,4). Postgres then bails out
-- with:
--
--   cannot change data type of view column "usd" from numeric(20,4) to numeric
--
-- The cast here makes the column's type match what init expects. After
-- that, init briefly replaces the view with the slow version on rerun, and
-- this migration immediately points it back at the totals table right
-- after - the ordering by filename guarantees that.
--
-- security_invoker stays on: the caller's rights apply, so poll_totals_read
-- above kicks in. Without this line, the view would run with its owner's
-- rights and bypass RLS.
-- ----------------------------------------------------------------------------

drop view if exists public.poll_results;
create view public.poll_results
with (security_invoker = on) as
select poll_id, option_id, votes::bigint as votes, usd::numeric as usd
  from public.poll_totals;

grant select on public.poll_results to authenticated;
