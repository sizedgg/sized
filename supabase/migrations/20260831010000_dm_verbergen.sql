-- ============================================================================
-- Ansem kann einzelne Gespraeche aus seinem Posteingang nehmen
--
-- ----------------------------------------------------------------------------
-- Was es tut und was ausdruecklich NICHT
--
-- Verbergen wirkt NUR auf Ansems Ansicht. Der andere merkt nichts: Er sieht
-- seinen Verlauf weiter, er kann weiter schreiben, und seine Nachrichten werden
-- weiter gespeichert. Nur Ansems Liste zeigt das Gespraech nicht mehr.
--
-- Das ist eine Entscheidung und keine Bequemlichkeit. Wer hier schreiben darf,
-- haelt dafuer einen Mindestbestand – er hat fuer den Zugang bezahlt. Was man
-- damit kauft, ist das Recht zu SCHREIBEN, nicht das Recht auf Antwort. Ihm
-- nachtraeglich das Schreiben zu nehmen, waere etwas anderes als "ich lese das
-- nicht mehr", und es waere unehrlich gegenueber dem, wofuer er bezahlt hat.
--
-- ----------------------------------------------------------------------------
-- Warum verborgen VERBORGEN bleibt, auch bei einer neuen Nachricht
--
-- Die Liste ist nach Bestand sortiert, nicht nach Zeit – die Reihenfolge
-- aendert sich also nie von selbst. Eine neue Nachricht laesst ein Gespraech
-- weder nach oben springen noch sonst etwas tun; sie aendert nur die Vorschau
-- und den Ungelesen-Zaehler.
--
-- Damit ist "verbergen" auch nicht dasselbe wie "archivieren". Es gibt keinen
-- Stapel, in den etwas zurueckkaeme. Wer verborgen wird, bleibt weg, bis Ansem
-- ihn zurueckholt. Das ist der Sinn: Man verbirgt jemanden, den man nicht mehr
-- lesen will, und nicht, um in zwei Tagen wieder von ihm zu hoeren.
--
-- Der Preis steht dazu und wird nicht verschwiegen: Eine spaetere, ernst
-- gemeinte Nachricht sieht Ansem dann auch nicht. Deshalb ist die Liste der
-- verborgenen Gespraeche in der Oberflaeche erreichbar und nicht nur hier.
--
-- ----------------------------------------------------------------------------
-- Warum eine eigene Tabelle und keine Spalte
--
-- Naheliegend waere eine Spalte an dms oder ein Vermerk je Wallet. Beides geht
-- nicht sauber:
--
--   * An dms haengt es an der NACHRICHT, nicht am Gespraech. Man muesste bei
--     jeder neuen Nachricht mitschreiben, dass sie auch verborgen ist – und
--     genau das wuerde beim ersten Vergessen auffallen, naemlich gar nicht.
--   * An wallets haengt es am Bestand und nicht an der Unterhaltung. Die
--     Tabelle beschreibt, was jemand HAT; sie ist der falsche Ort fuer eine
--     Entscheidung darueber, was Ansem lesen will.
--
-- Eine eigene Tabelle mit einer Zeile je verborgenem Gespraech sagt genau das,
-- was gemeint ist, und ist beim Zurueckholen ein delete.
--
-- ----------------------------------------------------------------------------
-- Wer darf das
--
-- Nur Ansem, und zwar auf allen vier Wegen: lesen, anlegen, loeschen. Ohne die
-- Leseregel koennte jeder nachsehen, wen Ansem verborgen hat – das waere eine
-- oeffentliche Liste der Leute, die er nicht mehr liest.
-- ============================================================================

create table if not exists public.dm_hidden (
  wallet     text primary key,
  created_at timestamptz not null default now()
);

comment on table public.dm_hidden is
  'Gespraeche, die Ansem aus seinem Posteingang genommen hat. Wirkt nur auf '
  'seine Ansicht: Der andere kann weiter schreiben und merkt nichts.';

alter table public.dm_hidden enable row level security;

drop policy if exists dm_hidden_admin_select on public.dm_hidden;
create policy dm_hidden_admin_select on public.dm_hidden
  for select to authenticated using (app.is_admin());

drop policy if exists dm_hidden_admin_insert on public.dm_hidden;
create policy dm_hidden_admin_insert on public.dm_hidden
  for insert to authenticated with check (app.is_admin());

drop policy if exists dm_hidden_admin_delete on public.dm_hidden;
create policy dm_hidden_admin_delete on public.dm_hidden
  for delete to authenticated using (app.is_admin());

grant select, insert, delete on public.dm_hidden to authenticated;

-- ----------------------------------------------------------------------------
-- Die Ansicht bekommt eine Spalte statt eines Filters
--
-- Naheliegend waere, verborgene Gespraeche in dm_threads gleich wegzulassen.
-- Dann waeren sie aber auch fuer Ansem weg, und er koennte sie nicht mehr
-- zurueckholen – die Oberflaeche braucht sie, um "3 hidden" anzuzeigen.
--
-- Also liefert die Ansicht die Angabe mit, und wer filtert, entscheidet die
-- Seite. Das ist hier gefahrlos: dm_threads laeuft mit security_invoker, und
-- die Zeilenregel auf dms laesst ohnehin nur den eigenen Verlauf oder – fuer
-- Ansem – alles durch. Ein Nutzer sieht in dieser Ansicht also weiterhin genau
-- ein Gespraech, sein eigenes, und dessen hidden steht fuer ihn immer auf
-- false: Die Unterabfrage laeuft unter SEINEN Rechten, und dm_hidden gibt ihm
-- keine Zeile heraus.
--
-- Das ist kein Zufall, sondern der Grund, warum die Leseregel oben nicht nur
-- Datenschutz ist: Sie sorgt zugleich dafuer, dass niemand seinem eigenen
-- Eintrag ansieht, dass er verborgen wurde.
-- ----------------------------------------------------------------------------
create or replace view public.dm_threads
with (security_invoker = on) as
select
  d.wallet,
  count(*)::bigint                                    as total,
  max(d.created_at)                                   as last_at,
  count(*) filter (where not d.from_admin
                     and not d.read_by_admin)::bigint as unread,
  coalesce(w.ui_amount, 0)                            as tokens,
  coalesce(w.usd_value, 0)                            as usd,
  (array_agg(d.body       order by d.id desc))[1]     as preview,
  (array_agg(d.from_admin order by d.id desc))[1]     as last_from_admin,
  exists (select 1 from public.dm_hidden h
           where h.wallet = d.wallet)                 as hidden
from public.dms d
left join public.wallets w on w.address = d.wallet
group by d.wallet, w.ui_amount, w.usd_value;

comment on view public.dm_threads is
  'Ein Eintrag je Gespraech: Vorschau, Bestand, wer zuletzt geschrieben hat, '
  'und ob Ansem es aus seinem Posteingang genommen hat.';

grant select on public.dm_threads to authenticated;
