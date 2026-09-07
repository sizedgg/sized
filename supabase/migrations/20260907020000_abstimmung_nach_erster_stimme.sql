-- ============================================================================
-- A poll that's already running no longer changes its wording
-- ============================================================================
--
-- The case this is about: Ansem creates "A or B?", thirty wallets vote,
-- then he edits the question to "C or D?". The votes stay, the numbers
-- stay - they just answer a different question now. Whoever voted for A
-- ends up standing under C afterward.
--
-- Up to now this was allowed. polls_admin_write grants Ansem "for all",
-- and that includes update on every column. This is the last spot in the
-- project where a result could later mean something different from what
-- the voters actually saw.
--
-- ----------------------------------------------------------------------------
-- Why a trigger and not a policy
--
-- An RLS policy sees the old row via "using" and the new row via "with
-- check", but it can't say "this column may not change, the one next to
-- it may". That's exactly what's needed here: closed and closes_at MUST
-- stay changeable - closing a running poll is the normal case, not the
-- exception. A trigger compares old and new column by column and is the
-- only place that gets this exactly right.
--
-- security definer, because the function needs to count how many votes
-- REALLY exist. Without it, it would only count what the caller is
-- allowed to see under RLS - and a lock that gets defeated by seeing less
-- isn't a lock.
--
-- ----------------------------------------------------------------------------
-- What gets locked and what doesn't
--
--   locked        rewriting the question once a vote exists
--   locked        renaming an answer option
--   locked        deleting an answer option (takes its votes with it)
--   locked        adding an answer option (earlier voters never saw it)
--   allowed       closing, setting or moving the deadline
--   allowed       all of the above as long as NOBODY has voted yet
--   allowed       deleting the whole poll and creating it anew
--
-- That last point is deliberate and not a hole: deleting visibly takes the
-- votes with it. It's a fresh start, not a silent reinterpretation, and
-- that's exactly the distinction this migration is about.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Does this poll already have votes?
-- ----------------------------------------------------------------------------
-- exists instead of count(*): the question is answered at the first row
-- found, and the answer doesn't depend on how many there are.
create or replace function app.abstimmung_laeuft(p_poll_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.votes where poll_id = p_poll_id);
$$;

comment on function app.abstimmung_laeuft(bigint) is
  'True, wenn zu dieser Abstimmung mindestens eine Stimme vorliegt.';


-- ----------------------------------------------------------------------------
-- The question itself
-- ----------------------------------------------------------------------------
create or replace function app.frage_nach_erster_stimme_fest()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Only when the wording actually changes. An update that writes the
  -- question back unchanged (the normal case for "closed = true" coming
  -- from a form) is meant to go through.
  if new.question is distinct from old.question
     and app.abstimmung_laeuft(old.id) then
    raise exception
      'Die Frage kann nicht mehr geaendert werden, es wurde bereits abgestimmt.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_polls_frage_fest on public.polls;
create trigger trg_polls_frage_fest
  before update on public.polls
  for each row execute function app.frage_nach_erster_stimme_fest();


-- ----------------------------------------------------------------------------
-- The answer options
-- ----------------------------------------------------------------------------
-- Three ways to reinterpret a running poll through its options, and all
-- three need their own trigger, because update, delete and insert see
-- different rows (old, old, new).

create or replace function app.option_nach_erster_stimme_fest()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.label is distinct from old.label
     and app.abstimmung_laeuft(old.poll_id) then
    raise exception
      'Die Antwortmoeglichkeit kann nicht mehr umbenannt werden, es wurde bereits abgestimmt.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_optionen_label_fest on public.poll_options;
create trigger trg_optionen_label_fest
  before update on public.poll_options
  for each row execute function app.option_nach_erster_stimme_fest();


create or replace function app.option_nicht_wegloeschen()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- When the whole poll is deleted, the foreign key clears out the options
  -- along with it, and this trigger fires too in that case. It shouldn't
  -- block that: discarding the poll as a whole is allowed.
  if exists (select 1 from public.polls where id = old.poll_id)
     and app.abstimmung_laeuft(old.poll_id) then
    raise exception
      'Die Antwortmoeglichkeit kann nicht mehr geloescht werden, es wurde bereits abgestimmt.'
      using errcode = 'check_violation';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_optionen_nicht_loeschen on public.poll_options;
create trigger trg_optionen_nicht_loeschen
  before delete on public.poll_options
  for each row execute function app.option_nicht_wegloeschen();


create or replace function app.option_nicht_nachschieben()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if app.abstimmung_laeuft(new.poll_id) then
    raise exception
      'Es kann keine Antwortmoeglichkeit mehr hinzugefuegt werden, es wurde bereits abgestimmt.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_optionen_nicht_nachschieben on public.poll_options;
create trigger trg_optionen_nicht_nachschieben
  before insert on public.poll_options
  for each row execute function app.option_nicht_nachschieben();


comment on trigger trg_polls_frage_fest on public.polls is
  'Sperrt den Wortlaut der Frage, sobald die erste Stimme vorliegt.';
comment on trigger trg_optionen_label_fest on public.poll_options is
  'Sperrt den Wortlaut einer Antwortmoeglichkeit ab der ersten Stimme.';
comment on trigger trg_optionen_nicht_loeschen on public.poll_options is
  'Verhindert das Loeschen einer Antwortmoeglichkeit ab der ersten Stimme.';
comment on trigger trg_optionen_nicht_nachschieben on public.poll_options is
  'Verhindert das Nachschieben einer Antwortmoeglichkeit ab der ersten Stimme.';
