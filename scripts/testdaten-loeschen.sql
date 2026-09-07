-- ============================================================================
-- Alles wegraeumen, was zum Ausprobieren entstanden ist
-- ============================================================================
--
-- Einzuspielen im SQL-Editor, VOR start-konfiguration.sql. Danach steht die
-- Datenbank so da, als haette sie noch nie jemand benutzt: Ansems erste
-- Abstimmung bekommt die 1, seine erste Nachricht ebenfalls.
--
-- ZWEI SCHRITTE. Dieses Skript raeumt die Datenbank. Die Vorschaubilder
-- liegen nicht in der Datenbank, sondern im Storage, und der laesst sich per
-- SQL nicht anfassen – dazu unten der Abschnitt "Die Vorschaubilder". Ohne
-- ihn ist die Sache nicht erledigt, auch wenn hier alles auf 0 steht.
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

commit;


-- ----------------------------------------------------------------------------
-- Die Vorschaubilder – der zweite Schritt, NICHT per SQL
-- ----------------------------------------------------------------------------
-- Hier stand einmal:
--
--   delete from storage.objects where bucket_id = 'og';
--
-- Das geht nicht. Supabase haengt einen Trigger vor storage.objects
-- (storage.protect_delete) und weist jedes direkte delete ab:
--
--   ERROR: 42501: Direct deletion from storage tables is not allowed.
--          Use the Storage API instead.
--
-- Und das zu Recht: Die Zeile in storage.objects ist nur der Eintrag im
-- Verzeichnis, die Datei selbst liegt woanders. Wer die Zeile loescht, hat
-- die Datei nicht geloescht, sondern nur unauffindbar gemacht – sie liegt
-- weiter da und ist weiter oeffentlich abrufbar. Genau deshalb ist es
-- gesperrt.
--
-- Stattdessen im Dashboard: Storage -> Eimer "og" -> alles markieren ->
-- Delete. Es sind so viele Dateien, wie es Testabstimmungen gab.
--
-- WARUM DAS NICHT OPTIONAL IST, auch wenn in der App nichts davon zu sehen
-- ist: Die Bilder heissen poll-<id>-v9.png, und die Nummern fangen nach
-- diesem Skript wieder bei 1 an. Bleibt poll-1-v9.png liegen, erscheint
-- Ansems erste echte Abstimmung auf X unter dem Bild einer Testabstimmung.
-- Auffallen wuerde es zuerst in seiner Zeitleiste.


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
-- Zwei Spalten verdienen einen zweiten Blick.
--
-- naechste_abstimmung_ist_1 fragt nicht, ob die Tabelle leer ist – sie fragt
-- den Zaehler, was er als naechstes ausgeben wuerde. Das ist die eigentliche
-- Antwort auf "faengt Ansem bei 1 an?".
--
-- vorschaubilder steht nach diesem Skript noch NICHT auf 0, denn die raeumt
-- das Dashboard weg (siehe oben). Dieselbe Abfrage nach dem Aufraeumen dort
-- noch einmal laufen lassen – dann muss sie 0 sagen.
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
