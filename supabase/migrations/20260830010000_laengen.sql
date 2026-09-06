-- ============================================================================
-- Frage und Antworten bekommen eine Laenge, die zum Bild passt
--
-- Bisher: Frage bis 300 Zeichen, Antwort bis 120. Beides war gegriffen, und
-- beides ist mehr, als je zu sehen ist.
--
-- ----------------------------------------------------------------------------
-- Warum 100 und 60 – die Zahlen sind gemessen, nicht geschaetzt
--
-- Eine Abstimmung wird als Bild gepostet (og_bilder). Dieses Bild ist die
-- Fassung, die draussen ankommt; das Formular ist nur die Eingabe. Was dort
-- nicht hineinpasst, kommt dort auch nicht an.
--
-- Auf der Karte:
--
--   * Die Frage bekommt DREI Zeilen. Schrift 700 54px
--     Schreibmaschine, Zelle 32,51 px, Inhaltsbreite 1428 px: 43 Zeichen je
--     Zeile, roh also 129 ueber drei Zeilen. Roh heisst: ohne Wortumbruch. Der
--     echte Umbruch verliert am Zeilenende Platz, und wie viel, haengt an den
--     Woertern und nicht an der Zeichenzahl. Gemessen mit 4000 Zufallssaetzen
--     je Laenge (scripts/mess-frage-laenge.mjs): 100 Zeichen brechen auch mit
--     ueberdurchschnittlich langen Woertern nicht um, 110 in 0,15 % der Faelle,
--     120 in 13 %. Genommen sind 100.
--
--     Nachtrag zur Sicherheit: zeichnePoll() verkleinert die Schrift
--     inzwischen, bis die Frage in drei Zeilen passt, statt die vierte still
--     wegzuschneiden. Die Grenze hier haelt also nicht mehr Text davon ab zu
--     verschwinden, sondern haelt die Ueberschrift gross genug, um in der
--     Zeitleiste noch eine zu sein.
--
--   * Eine Antwort laeuft durch kuerzen(...) auf EINE Zeile und bekommt sonst
--     drei Punkte. Schrift 500/650 27px, Zelle 16,26 px; neben dem laengsten
--     Betrag, mit dem zu rechnen ist ($12.345.678), bleiben 70 Zeichen.
--     Genommen sind 60.
--
-- ----------------------------------------------------------------------------
-- Warum das hier steht und nicht nur im Formular
--
-- Im Formular steht es auch – maxlength plus ein Zaehler rechts im Feld, damit
-- niemand erst tippt und dann eine Absage bekommt. Aber das Formular ist der
-- Browser, und der Browser ist der Teil, den man umgehen kann: PostgREST nimmt
-- jeden insert an, der durch die Zeilenregeln kommt. Die Grenze gehoert
-- deshalb hierher; das Formular ist die Hoeflichkeit davor.
--
-- ----------------------------------------------------------------------------
-- Bestehende Zeilen
--
-- Es gibt Testdaten von vor dieser Grenze. Eine neue Pruefung schlaegt beim
-- Anlegen fehl, wenn auch nur eine Zeile sie verletzt – die Migration kaeme
-- gar nicht durch. Also wird vorher gekuerzt, und zwar mit Ansage: Die Anzahl
-- steht als Notiz im Protokoll. Wer sie dort sieht, weiss, dass eine Frage
-- jetzt kuerzer ist als vorher, statt es irgendwann auf der Seite zu bemerken.
--
-- Gekuerzt und nicht geloescht: An einer Abstimmung haengen Stimmen.
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

-- Die alten Pruefungen tragen die Namen, die Postgres ihnen beim create table
-- gegeben hat. Sie werden ueber die Spalte gesucht statt ueber den Namen: Wer
-- die Tabelle einmal von Hand angelegt hat, hat womoeglich andere Namen, und
-- ein "constraint does not exist" mitten in einer Migration ist ein Abbruch.
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
