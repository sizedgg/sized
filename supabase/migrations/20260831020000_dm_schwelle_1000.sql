-- ============================================================================
-- Die DM-Schwelle steht standardmaessig auf $1.000
--
-- Bisher: Die Spalte hatte 10 als Vorgabe, und in dieser Datenbank stand 0 –
-- also aus. Jeder verifizierte Nutzer konnte schreiben.
--
-- ----------------------------------------------------------------------------
-- Was das aendert, und zwar sofort
--
-- Wer weniger als $1.000 in $ANSEM haelt, kann Ansem ab dem Einspielen dieser
-- Migration NICHT mehr schreiben. Bestehende Gespraeche bleiben vollstaendig
-- erhalten – geloescht wird nichts, und wer wieder ueber die Schwelle kommt,
-- ist von selbst zurueck. Aber neue Nachrichten von darunter werden abgelehnt,
-- und im Posteingang stehen diese Gespraeche nicht mehr.
--
-- Das ist der Zweck der Schwelle und keine Nebenwirkung. Es steht hier
-- trotzdem ausgeschrieben, weil es die einzige Migration in diesem Projekt
-- ist, die Leuten etwas WEGNIMMT, das sie vorher hatten.
--
-- ----------------------------------------------------------------------------
-- Warum die bestehende Zeile mitgeaendert wird – und nur die Null
--
-- Eine neue Vorgabe allein aendert nichts: Sie gilt fuer Zeilen, die noch
-- angelegt werden, und app_config hat genau eine, die es laengst gibt. Ohne
-- das update waere diese Migration folgenlos, und man wuerde es erst merken,
-- wenn weiter jeder schreibt.
--
-- Geaendert wird aber nur, wo noch 0 steht – der Wert, der ersetzt werden
-- soll. Haette Ansem inzwischen selbst etwas eingestellt, waere es seine
-- Entscheidung, und eine Migration, die sie ueberschreibt, waere ein Fehler.
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
