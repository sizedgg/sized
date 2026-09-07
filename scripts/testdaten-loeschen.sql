-- ============================================================================
-- Alles wegraeumen, was zum Ausprobieren entstanden ist
-- ============================================================================
--
-- Einzuspielen im SQL-Editor, VOR start-konfiguration.sql. Danach steht die
-- Datenbank so da, als haette sie noch nie jemand benutzt: Ansems erste
-- Abstimmung bekommt die 1, seine erste Nachricht ebenfalls.
--
-- ----------------------------------------------------------------------------
-- Warum truncate und nicht delete
--
-- Zwei Gruende, und der zweite ist der eigentliche:
--
--   1. restart identity setzt die Zaehler zurueck. Nach einem delete laeuft
--      die naechste Abstimmung auf der naechsten freien Nummer weiter – bei
--      siebzehn Testabstimmungen faengt Ansem bei 18 an. Genau das soll nicht
--      sein.
--
--   2. truncate loest keine Zeilen-Trigger aus. Seit der Migration
--      20260907020000 laesst sich eine Antwortmoeglichkeit nicht mehr
--      loeschen, sobald jemand abgestimmt hat – und das ist auch richtig so.
--      Ein delete auf poll_options wuerde hier also scheitern.
--
-- Alles in einer Transaktion: Entweder ist danach alles leer, oder es ist
-- nichts angefasst worden. Ein halb geraeumter Stand waere schlimmer als der
-- volle, weil man ihn fuer leer haelt.
-- ============================================================================

begin;

-- Abstimmungen, Nachrichten, Gespraeche. cascade raeumt mit, was daran
-- haengt; die Zaehler gehen auf Anfang zurueck.
truncate
  public.votes,
  public.poll_options,
  public.polls,
  public.poll_totals,
  public.dms,
  public.dm_hidden,
  public.messages
  restart identity cascade;

-- Offene und abgelaufene Anmeldeversuche. Ohne Zaehler, deshalb delete.
delete from public.challenges;

-- Die Bestandsdaten der Testwallets.
--
-- Kein Verlust: wallets ist keine Quelle, sondern ein Abbild der Chain. Wer
-- sich wieder anmeldet, dessen Bestand wird beim Anmelden neu gelesen. Wenn
-- du deine eigenen Testwallets lieber stehen laesst, streich diese Zeile.
delete from public.wallets;

-- Die Vorschaubilder der Testabstimmungen.
--
-- Das ist die Zeile, die man vergisst, und sie faellt ausgerechnet in der
-- Oeffentlichkeit auf: Die Bilder heissen poll-<id>-v9.png und liegen in
-- einem oeffentlichen Eimer. Weil die Nummern gleich wieder bei 1 anfangen,
-- wuerde Ansems erste echte Abstimmung unter dem Bild einer Testabstimmung
-- auf X erscheinen – in der App sieht man davon nichts, nur im geteilten
-- Link.
delete from storage.objects where bucket_id = 'og';

commit;


-- ----------------------------------------------------------------------------
-- Was ABSICHTLICH stehen bleibt: seen_txs
-- ----------------------------------------------------------------------------
-- Darin stehen die Signaturen der Ueberweisungen, die schon einmal fuer eine
-- Anmeldung gezaehlt wurden. Der Primaerschluessel auf signature ist die
-- Sperre dagegen, dass dieselbe Zahlung zweimal zaehlt.
--
-- Dramatisch waere das Leeren nicht: Eine Zahlung wird ueber Betrag UND
-- Absender einer Anmeldung zugeordnet (siehe verify/index.ts), eine alte
-- Testzahlung koennte also hoechstens deine eigene Testwallet noch einmal
-- einloggen und niemandem etwas wegnehmen. Aber es kostet nichts, sie stehen
-- zu lassen, und es ist die eine Tabelle, deren ganzer Zweck "nie zweimal"
-- lautet.
--
-- Wenn du trotzdem eine restlos leere Datenbank willst:
--
--   delete from public.seen_txs;


-- ----------------------------------------------------------------------------
-- Kontrolle
-- ----------------------------------------------------------------------------
-- Die letzte Spalte ist die eigentliche Antwort auf die Frage "faengt Ansem
-- bei 1 an?". Sie fragt nicht, ob die Tabelle leer ist – sie fragt den
-- Zaehler, was er als naechstes ausgeben wuerde.
select
  (select count(*) from public.polls)        as abstimmungen,
  (select count(*) from public.poll_options) as antwortmoeglichkeiten,
  (select count(*) from public.votes)        as stimmen,
  (select count(*) from public.dms)          as dms,
  (select count(*) from public.messages)     as chatnachrichten,
  (select count(*) from public.challenges)   as offene_anmeldungen,
  (select count(*) from public.wallets)      as wallets,
  (select count(*) from storage.objects
     where bucket_id = 'og')                 as vorschaubilder,
  (select count(*) from public.seen_txs)     as gesehene_zahlungen_bleiben,
  pg_get_serial_sequence('public.polls', 'id') is not null
    and (select last_value = 1 and is_called = false
         from public.polls_id_seq)           as naechste_abstimmung_ist_1;
