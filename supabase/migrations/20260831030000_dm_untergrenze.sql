-- ============================================================================
-- Die DM-Schwelle laesst sich nicht mehr unter $1.000 setzen
--
-- Bisher nahm set_min_dm_usd() jeden Wert ab 0 an, und 0 hiess: aus, jeder
-- verifizierte Nutzer darf schreiben. Das geht nicht mehr – unter 1000 wird
-- abgelehnt, null eingeschlossen.
--
-- ----------------------------------------------------------------------------
-- Warum es gar keinen Aus-Zustand mehr gibt
--
-- Der Posteingang ist der teurere Kanal. Eine DM landet nicht in einem Strom,
-- den man ueberfliegt, sondern bei einer einzelnen Person, die sie abarbeitet –
-- genau deshalb ist er das lohnendere Ziel fuer Spam. Eine Schwelle, die sich
-- versehentlich auf null stellen laesst, ist an dieser Stelle keine.
--
-- Und "versehentlich" ist hier woertlich gemeint: Im Formular hiess ein leeres
-- Feld bisher 0. Wer die Zahl markierte und loeschte, um eine neue zu tippen,
-- und dann wegklickte, hatte den Posteingang geoeffnet – ohne einen einzigen
-- Schritt, der danach aussah.
--
-- ----------------------------------------------------------------------------
-- Warum abgelehnt und nicht angehoben
--
-- Das Formular hebt an: Wer 500 tippt, bekommt 1000, ohne rote Meldung. Das
-- ist die richtige Antwort fuer jemanden, der gerade tippt.
--
-- Hier waere es die falsche. Diese Funktion ist die Sperre, und eine Sperre,
-- die stillschweigend etwas anderes tut als verlangt, ist keine Auskunft mehr:
-- Wer sie umgeht – und der Browser ist der Teil, den man umgehen kann –, soll
-- ein Nein bekommen und keine stille Korrektur. Sonst steht in der Datenbank
-- ein Wert, den niemand gesetzt hat.
--
-- ----------------------------------------------------------------------------
-- Die Obergrenze
--
-- Sie lag bei 1.000.000 und war als Tippfehlerbremse gedacht: eine
-- versehentlich angehaengte Null sollte nicht den Posteingang fuer alle
-- schliessen. Jetzt steht dort, was in zehn Stellen hineinpasst, weil das
-- Feld genau so lang ist. Die Bremse ist damit schwaecher – eine Null zu viel
-- auf 100.000 geht durch. Sichtbar wird so etwas trotzdem sofort, und zwar an
-- der Stelle, an der es auffaellt: Der Posteingang ist danach leer.
--
-- ----------------------------------------------------------------------------
-- Bestehende Zeilen
--
-- Die vorige Migration hat eine 0 bereits auf 1000 gehoben. Steht dort etwas
-- zwischen 0 und 1000 – von Hand gesetzt, bevor es diese Grenze gab –, wird es
-- ebenfalls angehoben: Sonst laesst sich der Wert zwar nicht mehr setzen, gilt
-- aber weiter.
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

  -- Untergrenze. Die Zahl steht auch in app.js (MIN_DM_SCHWELLE); dort haelt
  -- sie das Formular davon ab, etwas anzubieten, das hier abgelehnt wuerde.
  if p_usd is null or p_usd < 1000 then
    raise exception 'Minimum is $1,000';
  end if;

  -- Obergrenze: dieselbe Zahl, die oben ins Feld passt (zehn Stellen, siehe
  -- MAX_STELLEN in app.js). Sie ist keine Politik mehr, sondern nur noch die
  -- Laenge des Feldes – bis hierhin gilt, was getippt wurde.
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
