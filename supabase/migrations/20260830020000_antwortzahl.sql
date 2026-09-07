-- ============================================================================
-- At most four options per poll
--
-- ----------------------------------------------------------------------------
-- Why four
--
-- The yardstick is again the image that goes out into the world - but this
-- time not its content, its FORMAT.
--
-- X shows an image in the timeline uncropped up to 16:9 and crops anything
-- taller at top and bottom. The card grows by one line with every option.
-- Measured with a single-line question (a multi-line one pushes the number
-- further down):
--
--        4 options    1.78 - exactly 16:9, nothing is lost
--        5 options    1.74 - a narrow strip
--        6 options    1.58
--       10 options    1.14 - nearly square, a good chunk is gone
--
-- Four is therefore the last number at which the posted image arrives
-- whole. That X's own polls also allow four is the same reason, not
-- imitation.
--
-- There is a second reason that has nothing to do with the image: this
-- weights by holdings. The more options, the more spread out the weight,
-- and the more likely a single large wallet decides it. At ten options a
-- result barely says anything anymore.
--
-- ----------------------------------------------------------------------------
-- Why a trigger and not a check
--
-- A check validates a ROW. But the number of options lives in no single
-- row - it follows from the other rows of the same poll. So it has to be
-- counted at insert time.
--
-- And why in the database at all, when only Ansem creates polls: the form
-- is the browser, and the browser is the part that can be bypassed.
-- PostgREST accepts any insert that passes the row policies. Whoever calls
-- the creation directly could attach fifty options and make any card that
-- shows this poll unusable.
--
-- The trigger runs AFTER INSERT and per STATEMENT, not per row: the app
-- creates all options in ONE insert. A before-trigger per row would not
-- yet see its own row counted and would have to compute around that;
-- after the statement, the finished number is already there. The abort
-- rolls back the whole insert - so a half-created result cannot occur.
--
-- ----------------------------------------------------------------------------
-- Existing polls
--
-- There can be test data with more than four options. It is NOT touched:
-- votes hang off an option, and deleting one would mean changing a result
-- after the fact. The trigger only fires on creation; old polls keep
-- running as before. The card copes with that, it just grows taller.
--
-- How many there are is noted in the log - whoever wants to get rid of
-- them deletes the poll as a whole.
-- ============================================================================

do $$
declare
  n integer;
begin
  select count(*) into n from (
    select poll_id from public.poll_options
     group by poll_id having count(*) > 4
  ) x;
  if n > 0 then
    raise notice 'Bestehende Abstimmungen mit mehr als 4 Antworten: % (bleiben unveraendert)', n;
  end if;
end $$;

create or replace function app.guard_option_count()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  zuviel bigint;
begin
  -- Only look at the polls that received options in THIS statement.
  -- Without that, every insert would count over the whole table, and
  -- existing polls with more options would block every further insert,
  -- even one for a different poll.
  select count(*) into zuviel
    from (
      select o.poll_id
        from public.poll_options o
       where o.poll_id in (select distinct n.poll_id from neu n)
       group by o.poll_id
      having count(*) > 4
    ) x;

  if zuviel > 0 then
    -- English: the message ends up as a toast in the interface.
    raise exception 'A poll can have at most 4 options';
  end if;
  return null;
end;
$$;

create or replace trigger trg_poll_options_anzahl
  after insert on public.poll_options
  referencing new table as neu
  for each statement execute function app.guard_option_count();
