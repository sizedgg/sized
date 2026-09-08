-- ============================================================================
-- Vier Kleinigkeiten vor dem Start - drei davon Belastbarkeit, eine Absperrung
--
-- Alle vier kommen aus einer Durchsicht kurz vor dem Livegang. Keine ist ein
-- offenes Loch; drei sind Dinge, die erst unter Last weh tun, und genau die
-- sieht man vorher nie.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. dms_read: die Adminpruefung einmal pro Abfrage statt einmal pro ZEILE
-- ----------------------------------------------------------------------------
--
-- app.is_admin() ist security definer und hat einen festen search_path.
-- Beides verhindert, dass Postgres die Funktion in die Bedingung einsetzt
-- (inline_function), und stable heisst nur "innerhalb einer Abfrage
-- konstant", nicht "einmal ausrechnen". Die Bedingung stand also fuer JEDE
-- Zeile der Tabelle an - und jeder Aufruf liest wieder app_config.
--
-- Dazu kommt: mit dem "or" ist die Bedingung nicht indizierbar, idx_dms_thread
-- also nutzlos. Die Nutzeransicht schickt beim Laden gar keinen Filter mit
-- (public/app.js: from('dms').select('*')), die Zeilenregel IST der Filter -
-- ein Durchlauf durch die ganze Tabelle mit einem Funktionsaufruf je Zeile,
-- und das bei jeder Benachrichtigung, jedem Tabwechsel und im Notlauf alle
-- paar Sekunden.
--
-- Ein Unterausdruck in Klammern macht daraus einen InitPlan: einmal
-- ausrechnen, dann vergleichen. Dieselbe Form benutzt 20260904010000 schon
-- fuer realtime.topic(). Die Regel selbst sagt danach genau dasselbe wie
-- vorher.
drop policy if exists dms_read on public.dms;
create policy dms_read on public.dms
  for select to authenticated
  using (wallet = (select app.jwt_wallet()) or (select app.is_admin()));

-- ----------------------------------------------------------------------------
-- 2. Ein Index auf der Spalte, nach der die Minutenuhr sucht
-- ----------------------------------------------------------------------------
--
-- wallets_to_refresh() sucht "where updated_at < ... order by updated_at asc
-- limit N" - und auf wallets lag bisher nur ein Index auf usd_value. Der
-- Zeitplan ruft das zweimal pro Minute auf (scripts/cron-jobs.sql), also lief
-- zweimal pro Minute ein voller Durchlauf ueber die Tabelle plus Sortierung,
-- fuer eine Frage, die nach den 120 aeltesten Zeilen fragt.
create index if not exists idx_wallets_updated_at on public.wallets (updated_at);

-- ----------------------------------------------------------------------------
-- 3. Der Scan-Takt gehoert in die Datenbank, nicht in eine Variable
-- ----------------------------------------------------------------------------
--
-- Die Bremse "hoechstens alle fuenf Sekunden zur Kette" stand als Zahl im
-- Speicher der Funktion. Supabase startet unter Last mehrere Instanzen, und
-- jede hat ihre eigene Zahl - die Bremse galt also je Instanz. Bei zwanzig
-- Instanzen sind das zwanzigmal so viele Abfragen beim RPC-Anbieter, und die
-- kosten Geld und Kontingent.
--
-- Eine Spalte in app_config ist die einfachste gemeinsame Uhr: wer sie
-- bedingt weiterstellen darf, scannt. Alle anderen sehen null Zeilen und
-- lassen es. Der Vorgabewert liegt in der Vergangenheit, damit der erste
-- Aufruf nach dem Einspielen nicht wartet.
alter table public.app_config
  add column if not exists last_scan_at timestamptz not null default now() - interval '1 minute';

comment on column public.app_config.last_scan_at is
  'Wann zuletzt zur Kette geschaut wurde. Gemeinsame Bremse fuer alle '
  'Instanzen der verify-Funktion - siehe scanTreasury.';

-- ----------------------------------------------------------------------------
-- 4. Aufraeumen: Ausfuehrungsrechte und search_path
-- ----------------------------------------------------------------------------
--
-- app.poll_totals_neu_aufbauen() ist security definer, loescht die
-- Summentabelle und baut sie neu - und war als einzige ihrer Art nicht
-- entzogen. Erreichbar ist sie heute nicht (PostgREST zeigt nur public), aber
-- das ist eine Aussage ueber die Konfiguration von PostgREST, keine ueber die
-- Rechte in der Datenbank.
revoke all on function app.poll_totals_neu_aufbauen() from public, anon, authenticated;
revoke all on function app.abstimmung_laeuft(bigint) from public, anon, authenticated;

-- Drei Triggerfunktionen ohne festen search_path. Keine ist security definer,
-- es gibt also keinen Weg nach oben - aber jede andere Funktion in diesem
-- Verzeichnis hat ihn, und eine Ausnahme ohne Grund ist eine Ausnahme, ueber
-- die beim naechsten Mal jemand nachdenken muss.
alter function app.force_sender() set search_path = public, pg_temp;
alter function app.stempel_created_at() set search_path = public, pg_temp;
alter function app.stempel_read_by_admin() set search_path = public, pg_temp;

-- ----------------------------------------------------------------------------
-- 5. Betraege koennen nicht negativ sein
-- ----------------------------------------------------------------------------
--
-- Nur die Untergrenze, und die ist unstrittig: ein negativer Bestand hat
-- keine Bedeutung, ein negatives Stimmgewicht wuerde von einem Balken
-- ABZIEHEN. Die Regel gegen den Preis null steht bewusst NICHT hier, sondern
-- in _shared/holdings.ts: faellt die Preisquelle aus, soll der letzte bekannte
-- Bestand stehen bleiben - eine Ausnahme aus der Datenbank wuerde an dieser
-- Stelle die Anmeldung selbst umwerfen.
alter table public.wallets drop constraint if exists wallets_betraege_nicht_negativ;
alter table public.wallets add constraint wallets_betraege_nicht_negativ
  check (ui_amount >= 0 and usd_value >= 0 and price >= 0);

alter table public.poll_totals drop constraint if exists poll_totals_nicht_negativ;
alter table public.poll_totals add constraint poll_totals_nicht_negativ
  check (votes >= 0 and usd >= 0);

commit;
