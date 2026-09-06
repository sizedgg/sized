-- ============================================================================
-- Auf null vor dem Start
--
-- Entfernt alle Test- und Lasttestdaten. Behalten werden genau zwei
-- Wallet-Einträge: die Testadresse und die Adresse, die in app_config als
-- Administrator eingetragen ist. Beide bleiben, damit bestehende Sitzungen
-- weiterlaufen und niemand neu verifizieren (und zahlen) muss.
--
-- Was verschwindet:
--   * rund 27.400 Lasttest-Adressen aus wallets
--   * alle Nachrichten (105 aus dem Lasttest, 76 aus eigenen Tests)
--   * alle DMs (die 50 gesetzten Faeden aus dem Seed)
--   * die drei Test-Abstimmungen samt Optionen
--   * alle Zahlungsanforderungen
--
-- Stimmen gibt es keine (geprueft: 0), es gehen also keine Abstimmungs-
-- ergebnisse verloren.
--
-- ANLEITUNG
--   Abschnitt 1 zuerst allein ausfuehren – er zeigt nur an.
--   Dann Abschnitt 2.
--   Abschnitt 3 EINZELN ausfuehren: VACUUM darf nicht in einer Transaktion
--   laufen, und der SQL-Editor packt mehrere Anweisungen in eine.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- VOR DEM AUSFUEHREN: DEIN_TEST_WALLET ersetzen
-- ----------------------------------------------------------------------------
-- Hier stand einmal eine echte Adresse. Sie ist raus, weil dieses Verzeichnis
-- oeffentlich ist: Eine Wallet, die im Quelltext des Projekts steht, ist der
-- Wallet des Betreibers – und damit ein Faden, an dem man ziehen kann.
--
-- Wer keine Testwallet verschonen will, setzt stattdessen einen Wert ein, den
-- es nicht gibt. Die Abfrage bleibt dann richtig, sie behaelt nur nichts.

-- ----------------------------------------------------------------------------
-- 1. VORSCHAU
-- ----------------------------------------------------------------------------
select
  (select count(*) from public.wallets)    as wallets_jetzt,
  (select count(*) from public.wallets
     where address = 'DEIN_TEST_WALLET'
        or address = (select admin_wallet from public.app_config where id = 1))
                                            as wallets_bleiben,
  (select count(*) from public.messages)   as nachrichten,
  (select count(*) from public.dms)        as dms,
  (select count(*) from public.polls)      as polls,
  (select count(*) from public.votes)      as stimmen,
  (select count(*) from public.challenges) as challenges,
  (select admin_wallet from public.app_config where id = 1) as admin_wallet;


-- ----------------------------------------------------------------------------
-- 2. LEEREN
-- ----------------------------------------------------------------------------
-- Reihenfolge ist nicht beliebig: polls raeumt ueber "on delete cascade" seine
-- Optionen und Stimmen gleich mit weg, deshalb muss es vor wallets stehen.

delete from public.votes;
delete from public.polls;          -- nimmt poll_options mit
delete from public.messages;       -- reply_to ist "on delete set null"
delete from public.dms;
delete from public.challenges;
delete from public.seen_txs;

delete from public.wallets
where address <> 'DEIN_TEST_WALLET'
  and address is distinct from (select admin_wallet from public.app_config where id = 1);

-- Antworten von net.http_post – die sammeln sich durch die Cronjobs an.
delete from net._http_response where created < now() - interval '1 hour';


-- ----------------------------------------------------------------------------
-- 3. PLATZ FREIGEBEN – bitte EINZELN ausfuehren, eine Zeile nach der anderen
-- ----------------------------------------------------------------------------
-- Ohne das behaelt Postgres die 11 MB belegt und plant weiter mit 27.000
-- Zeilen, waehlt also schlechte Zugriffswege fuer eine Tabelle mit zwei.

vacuum full analyze public.wallets;
vacuum full analyze public.messages;
vacuum full analyze public.dms;


-- ----------------------------------------------------------------------------
-- 4. NACHHER
-- ----------------------------------------------------------------------------
select
  relname as tabelle,
  n_live_tup as zeilen,
  pg_size_pretty(pg_total_relation_size(relid)) as groesse
from pg_stat_user_tables
order by pg_total_relation_size(relid) desc
limit 10;
