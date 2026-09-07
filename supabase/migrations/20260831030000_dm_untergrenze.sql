-- ============================================================================
-- The DM threshold can no longer be set below $1,000
--
-- Until now, set_min_dm_usd() accepted any value from 0 up, and 0 meant:
-- off, any verified user may write. That no longer works - anything under
-- 1000 is rejected, null included.
--
-- ----------------------------------------------------------------------------
-- Why there's no "off" state at all anymore
--
-- The inbox is the more expensive channel. A DM doesn't land in a stream
-- you skim, it lands with a single person who works through it - that's
-- exactly why it's the more rewarding target for spam. A threshold that can
-- accidentally be set to zero isn't one, in this spot.
--
-- And "accidentally" is meant literally here: in the form, an empty field
-- used to mean 0. Anyone who selected the number and deleted it to type a
-- new one, then clicked away, had opened the inbox - without a single step
-- that looked like it.
--
-- ----------------------------------------------------------------------------
-- Why rejected and not raised
--
-- The form raises it: type 500, get 1000, no red error. That's the right
-- answer for someone in the middle of typing.
--
-- Here it would be the wrong one. This function is the block, and a block
-- that silently does something other than what was asked isn't an
-- authority anymore: anyone who bypasses it - and the browser is the part
-- that can be bypassed - should get a no, not a silent correction.
-- Otherwise there's a value sitting in the database that nobody set.
--
-- ----------------------------------------------------------------------------
-- The upper limit
--
-- It used to be 1,000,000 and was meant as a typo brake: an accidentally
-- added zero shouldn't close the inbox for everyone. Now it holds whatever
-- fits in ten digits, because that's exactly how long the field is. The
-- brake is weaker as a result - one zero too many on 100,000 gets through.
-- Still, something like that becomes visible immediately, right where it
-- would be noticed: the inbox is empty afterward.
--
-- ----------------------------------------------------------------------------
-- Existing rows
--
-- The previous migration already raised a 0 to 1000. If something between 0
-- and 1000 is sitting there - set by hand before this limit existed - it
-- gets raised too: otherwise the value could no longer be set, but would
-- still apply.
-- ============================================================================

create or replace function public.set_min_dm_usd(p_usd numeric)
returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v numeric;
begin
  if not app.is_admin() then
    raise exception 'Not allowed';
  end if;

  -- Lower limit. The number also lives in app.js (MIN_DM_SCHWELLE); there
  -- it keeps the form from offering something this would reject.
  if p_usd is null or p_usd < 1000 then
    raise exception 'Minimum is $1,000';
  end if;

  -- Upper limit: the same number that fits into the field above (ten
  -- digits, see MAX_STELLEN in app.js). It's no longer a policy, just the
  -- length of the field - up to here, whatever was typed stands.
  if p_usd > 9999999999 then
    raise exception 'Amount is too high';
  end if;

  v := round(p_usd, 2);

  update public.app_config
     set min_dm_usd = v,
         updated_at = now()
   where id = 1;

  return v;
end;
$$;

comment on function public.set_min_dm_usd(numeric) is
  'Setzt die DM-Schwelle. Nur fuer Ansem, aendert ausschliesslich min_dm_usd, '
  'nimmt nichts unter 1000 an und nichts ueber 9999999999.';

comment on column public.app_config.min_dm_usd is
  'Mindestwert in USD an gehaltenen Token, um Ansem eine DM schreiben zu '
  'duerfen. Vorgabe und Untergrenze 1000 – set_min_dm_usd() nimmt nichts '
  'Kleineres an. Ein direktes UPDATE auf diese Spalte umgeht das; das ist so '
  'gewollt, damit ein Besitzer im Notfall eingreifen kann.';

do $$
declare
  n integer;
begin
  update public.app_config
     set min_dm_usd = 1000, updated_at = now()
   where id = 1 and min_dm_usd < 1000;
  get diagnostics n = row_count;
  if n > 0 then
    raise notice 'Bestehende Schwelle lag unter 1000 und wurde angehoben.';
  end if;
end $$;
