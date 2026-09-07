-- ============================================================================
-- The DM threshold defaults to $1,000
--
-- Until now: the column had 10 as its default, and this database had 0 -
-- meaning off. Any verified user could write.
--
-- ----------------------------------------------------------------------------
-- What this changes, and immediately
--
-- Anyone holding less than $1,000 in $ANSEM can NO LONGER write to Ansem
-- once this migration is applied. Existing conversations stay fully intact
-- - nothing gets deleted, and anyone who comes back above the threshold is
-- automatically back in. But new messages from below it get rejected, and
-- those conversations no longer show up in the inbox.
--
-- That's the purpose of the threshold, not a side effect. It's spelled out
-- here anyway, because this is the only migration in this project that
-- TAKES something away from people that they had before.
--
-- ----------------------------------------------------------------------------
-- Why the existing row also gets changed - and only the zero
--
-- A new default alone changes nothing: it applies to rows still to be
-- created, and app_config has exactly one, which has existed for a long
-- time already. Without the update, this migration would be inconsequential,
-- and nobody would notice until everyone keeps writing.
--
-- But it only changes rows where 0 is currently set - the value meant to
-- be replaced. If Ansem had set something himself in the meantime, that
-- would be his decision, and a migration overwriting it would be a bug.
-- ============================================================================

alter table public.app_config
  alter column min_dm_usd set default 1000;

comment on column public.app_config.min_dm_usd is
  'Mindestwert in USD an gehaltenen Token, um Ansem eine DM schreiben zu '
  'duerfen. Vorgabe 1000. 0 = aus, dann darf jeder verifizierte Nutzer '
  'schreiben.';

do $$
declare
  vorher numeric;
begin
  select min_dm_usd into vorher from public.app_config where id = 1;

  update public.app_config
     set min_dm_usd = 1000, updated_at = now()
   where id = 1 and min_dm_usd = 0;

  if found then
    raise notice 'DM-Schwelle von 0 auf 1000 gesetzt.';
  else
    raise notice 'DM-Schwelle bleibt bei % – nur die Vorgabe wurde geaendert.', vorher;
  end if;
end $$;
