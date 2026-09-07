-- ============================================================================
-- The question and answers get a length that matches the image
--
-- Before: question up to 300 characters, answer up to 120. Both were
-- guesses, and both are more than ever gets seen.
--
-- ----------------------------------------------------------------------------
-- Why 100 and 60 - the numbers are measured, not estimated
--
-- A poll gets posted as an image (og_bilder). That image is the version
-- that reaches the outside world; the form is only the input. Whatever
-- doesn't fit there doesn't arrive there either.
--
-- On the card:
--
--   * The question gets THREE lines. Font 700 54px monospace, cell
--     32.51 px, content width 1428 px: 43 characters per line, so 129 raw
--     over three lines. Raw means: without word wrap. The real wrap loses
--     space at the end of a line, and how much depends on the words, not
--     the character count. Measured with 4000 random sentences per length
--     (scripts/mess-frage-laenge.mjs): 100 characters don't wrap even with
--     above-average-length words, 110 wraps in 0.15% of cases, 120 in 13%.
--     100 is what was taken.
--
--     A safety note: zeichnePoll() now shrinks the font until the question
--     fits in three lines, instead of silently cutting off a fourth line.
--     So the limit here no longer keeps text from disappearing - it keeps
--     the headline large enough to still read as a headline in the
--     timeline.
--
--   * An answer runs through kuerzen(...) down to ONE line and otherwise
--     gets an ellipsis. Font 500/650 27px, cell 16.26 px; next to the
--     longest amount to expect ($12,345,678), 70 characters remain. 60 is
--     what was taken.
--
-- ----------------------------------------------------------------------------
-- Why this lives here and not only in the form
--
-- It's in the form too - maxlength plus a counter on the right of the
-- field, so nobody types first and gets rejected after. But the form is
-- the browser, and the browser is the part that can be bypassed: PostgREST
-- accepts any insert that gets past the row rules. So the limit belongs
-- here; the form is just the courtesy in front of it.
--
-- ----------------------------------------------------------------------------
-- Existing rows
--
-- There is test data from before this limit. A new check fails at creation
-- time if even one row violates it - the migration wouldn't go through at
-- all. So rows are truncated first, and with notice: the count is logged
-- as a notice. Anyone who sees it there knows a question is now shorter
-- than before, instead of noticing it on the page at some point.
--
-- Truncated, not deleted: votes are attached to a poll.
-- ============================================================================

do $$
declare
  n_fragen integer;
  n_antworten integer;
begin
  update public.polls
     set question = left(btrim(question), 100)
   where length(btrim(question)) > 100;
  get diagnostics n_fragen = row_count;

  update public.poll_options
     set label = left(btrim(label), 60)
   where length(btrim(label)) > 60;
  get diagnostics n_antworten = row_count;

  raise notice 'Gekuerzt: % Fragen, % Antworten', n_fragen, n_antworten;
end $$;

-- The old checks carry the names Postgres gave them at create table time.
-- They're looked up by column, not by name: whoever created the table by
-- hand once might have different names, and a "constraint does not exist"
-- in the middle of a migration is a hard stop.
do $$
declare
  c record;
begin
  for c in
    select rel.relname as tabelle, con.conname as name
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace ns on ns.oid = rel.relnamespace
     where ns.nspname = 'public'
       and con.contype = 'c'
       and ((rel.relname = 'polls'        and pg_get_constraintdef(con.oid) ilike '%question%')
         or (rel.relname = 'poll_options' and pg_get_constraintdef(con.oid) ilike '%label%'))
  loop
    execute format('alter table public.%I drop constraint %I', c.tabelle, c.name);
  end loop;
end $$;

alter table public.polls
  add constraint polls_frage_laenge
  check (length(btrim(question)) between 1 and 100);

alter table public.poll_options
  add constraint poll_options_antwort_laenge
  check (length(btrim(label)) between 1 and 60);
