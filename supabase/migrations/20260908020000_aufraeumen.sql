-- ============================================================================
-- Aufraeumen: die drei Tabellen, die nur wachsen
--
-- Keine davon ist ein Loch, und keine faellt in der ersten Woche auf. Genau
-- das ist das Problem: sie fallen im dritten Monat auf, und dann als etwas
-- anderes - als eine Anmeldung, die zwei Sekunden braucht.
--
--   challenges  Jeder Anmeldeversuch legt eine Zeile an, auch der
--               abgebrochene. Eine Adresse eintippen genuegt dafuer, niemand
--               muss etwas beweisen. Die Tabelle traegt einen eindeutigen
--               Index auf den offenen Betraegen und einen auf (wallet,
--               status) - beide werden bei jeder Anmeldung angefasst.
--
--   seen_txs    Jede Zahlung an die Treasury, fuer immer. Der Scan liest bei
--               jedem Durchlauf die 600 neuesten daraus.
--
--   cron.job_run_details  pg_cron schreibt pro Lauf eine Zeile. Bei drei
--               Auftraegen jede Minute sind das 4320 Zeilen am Tag, gut
--               1,5 Millionen im Jahr - fuer Protokoll, das niemand liest.
--
-- ----------------------------------------------------------------------------
-- Warum das Loeschen nichts aufweicht
--
-- Der Verdacht liegt nahe: seen_txs IST der Schutz gegen doppeltes Verbuchen
-- einer Unterschrift ("the primary key on seen_txs.signature is the actual
-- guard against double booking", verify/index.ts). Wer Zeilen daraus
-- entfernt, nimmt den Schutz weg.
--
-- Er nimmt ihn fuer ALTE Unterschriften weg, und fuer die traegt eine zweite
-- Bedingung: eine Zahlung loest nur eine Challenge ein, die es VORHER schon
-- gab (created_at <= blockTime + 60s), und die noch laufen darf (expires_at >
-- jetzt - 1 h). Eine Zahlung von vor 30 Tagen findet also keine Challenge
-- mehr, die sie einloesen koennte - jede heute offene ist juenger als sie.
-- Dazu kommt das Fenster des Scans selbst: er sieht die letzten 200
-- Unterschriften der Treasury, eine 30 Tage alte ist da lange heraus.
--
-- Bei challenges dasselbe von der anderen Seite: geloescht wird, was nicht
-- mehr eingeloest werden kann - 'used', 'expired', und 'paid' erst nach 30
-- Tagen. Offene Zeilen bleiben, solange der Nachlauf sie retten koennte,
-- und danach noch zwei Tage.
-- ============================================================================

begin;

create or replace function app.aufraeumen(behalten_tage int default 30)
returns table (tabelle text, geloescht bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  grenze timestamptz := now() - make_interval(days => greatest(behalten_tage, 1));
  n bigint;
begin
  -- 1. Abgeschlossene Anmeldeversuche. 'pending' ist hier bewusst NICHT
  --    dabei: eine offene Zeile kann noch bezahlt werden.
  delete from public.challenges
   where status in ('used', 'expired', 'paid') and created_at < grenze;
  get diagnostics n = row_count;
  return query select 'challenges'::text, n;

  -- 2. Offene, die niemand mehr einloesen kann. Zwei Tage nach Ablauf ist
  --    auch der Nachlauf von einer Stunde lange vorbei - die Zeile belegt
  --    dann nur noch einen Betrag im eindeutigen Index.
  delete from public.challenges
   where status = 'pending' and expires_at < now() - interval '2 days';
  get diagnostics n = row_count;
  return query select 'challenges_offen'::text, n;

  -- 3. Gesehene Zahlungen. Siehe der Kopf dieser Wanderung.
  delete from public.seen_txs where seen_at < grenze;
  get diagnostics n = row_count;
  return query select 'seen_txs'::text, n;

  -- 4. Das Protokoll von pg_cron. Sieben Tage genuegen, um nachzusehen, ob
  --    die Minutenuhr laeuft; laenger hat es noch niemand angefasst.
  --
  --    Dynamisch, weil pg_cron in der Testdatenbank nicht installiert ist -
  --    ein festes DELETE wuerde die Funktion dort beim ersten Aufruf
  --    umwerfen, und dann waere auch das Aufraeumen oben nicht passiert.
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $q$delete from cron.job_run_details
                where end_time < now() - interval '7 days'$q$;
    get diagnostics n = row_count;
    return query select 'cron.job_run_details'::text, n;
  end if;

  return;
end;
$$;

comment on function app.aufraeumen(int) is
  'Loescht abgeschlossene Anmeldeversuche, alte Treasury-Unterschriften und '
  'das Protokoll von pg_cron. Taeglich per Zeitplan - siehe scripts/cron-jobs.sql.';

-- Erreichbar ist app.* ueber PostgREST heute nicht; das ist eine Aussage
-- ueber die Konfiguration von PostgREST, keine ueber die Rechte hier.
revoke all on function app.aufraeumen(int) from public, anon, authenticated;

-- Der Index, nach dem Punkt 1 sucht. idx_challenges_wallet steht auf
-- (wallet, status) und hilft einer Frage ohne Wallet nicht; ohne diesen hier
-- laeuft das taegliche Loeschen einmal durch die ganze Tabelle - also genau
-- durch das, was gross geworden ist.
create index if not exists idx_challenges_created_at
  on public.challenges (created_at);

commit;
