-- ============================================================================
-- Hoechstens vier Antworten je Abstimmung
--
-- ----------------------------------------------------------------------------
-- Warum vier
--
-- Der Massstab ist wieder das Bild, das nach draussen geht – diesmal aber nicht
-- sein Inhalt, sondern sein FORMAT.
--
-- X zeigt ein Bild in der Zeitleiste bis 16:9 ungeschnitten und beschneidet
-- alles Hoehere oben und unten. Die Karte waechst mit jeder Antwort um eine
-- Zeile. Gemessen bei einzeiliger Frage (eine mehrzeilige drueckt die Zahl
-- weiter nach unten):
--
--        4 Antworten   1,78 – genau 16:9, nichts faellt weg
--        5 Antworten   1,74 – ein schmaler Streifen
--        6 Antworten   1,58
--       10 Antworten   1,14 – fast quadratisch, ein gutes Stueck ist weg
--
-- Vier ist damit die letzte Zahl, bei der das gepostete Bild vollstaendig
-- ankommt. Dass Xs eigene Umfrage ebenfalls vier erlaubt, ist derselbe Grund
-- und keine Nachahmung.
--
-- Es gibt einen zweiten Grund, der nichts mit dem Bild zu tun hat: Hier wird
-- nach Bestand gewichtet. Je mehr Antworten, desto weiter verteilt sich das
-- Gewicht, und desto eher entscheidet eine einzelne grosse Wallet. Bei zehn
-- Antworten sagt ein Ergebnis kaum noch etwas.
--
-- ----------------------------------------------------------------------------
-- Warum ein Trigger und kein check
--
-- Ein check prueft eine ZEILE. Die Zahl der Antworten steht aber in keiner
-- Zeile – sie ergibt sich aus den anderen Zeilen derselben Abstimmung. Also
-- muss beim Einfuegen gezaehlt werden.
--
-- Und warum ueberhaupt in der Datenbank, wo doch nur Ansem Abstimmungen
-- anlegt: Das Formular ist der Browser, und der Browser ist der Teil, den man
-- umgehen kann. PostgREST nimmt jeden insert an, der durch die Zeilenregeln
-- kommt. Wer das Anlegen von Hand aufruft, koennte fuenfzig Antworten anhaengen
-- und damit jede Karte unbrauchbar machen, die diese Abstimmung zeigt.
--
-- Der Trigger laeuft AFTER INSERT und pro ANWEISUNG, nicht pro Zeile: Die App
-- legt alle Antworten in EINEM insert an. Ein before-Trigger pro Zeile saehe
-- die eigene Zeile noch nicht mitgezaehlt und muesste umstaendlich rechnen;
-- nach der Anweisung steht die fertige Zahl da. Der Abbruch dreht den ganzen
-- insert zurueck – ein halb angelegtes Ergebnis kann also nicht entstehen.
--
-- ----------------------------------------------------------------------------
-- Bestehende Abstimmungen
--
-- Es kann Testdaten mit mehr als vier Antworten geben. Sie werden NICHT
-- angefasst: An einer Antwort haengen Stimmen, und eine zu loeschen hiesse, ein
-- Ergebnis nachtraeglich zu aendern. Der Trigger greift nur beim Anlegen; alte
-- Abstimmungen laufen weiter wie bisher. Die Karte kommt damit zurecht, sie
-- wird nur hoeher.
--
-- Wie viele es sind, steht als Notiz im Protokoll – wer sie loswerden will,
-- loescht die Abstimmung als Ganzes.
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
  -- Nur die Abstimmungen ansehen, die in DIESER Anweisung Antworten bekommen
  -- haben. Ohne das waere es bei jedem insert eine Zaehlung ueber die ganze
  -- Tabelle, und bestehende Abstimmungen mit mehr Antworten wuerden jeden
  -- weiteren insert blockieren, auch einen fuer eine andere Abstimmung.
  select count(*) into zuviel
    from (
      select o.poll_id
        from public.poll_options o
       where o.poll_id in (select distinct n.poll_id from neu n)
       group by o.poll_id
      having count(*) > 4
    ) x;

  if zuviel > 0 then
    -- Englisch: Die Meldung landet als Toast in der Oberflaeche.
    raise exception 'A poll can have at most 4 options';
  end if;
  return null;
end;
$$;

create or replace trigger trg_poll_options_anzahl
  after insert on public.poll_options
  referencing new table as neu
  for each statement execute function app.guard_option_count();
