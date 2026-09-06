-- ============================================================================
-- Der Posteingang soll zeigen, wer zuletzt geschrieben hat
--
-- Bisher lieferte dm_threads nur den Text der letzten Nachricht. Ob er von
-- Ansem stammt oder vom Gegenüber, war daraus nicht zu erkennen – im
-- Posteingang stand also "checking" neben "any chance of a mobile app later",
-- ohne dass sichtbar war, dass das erste seine eigene Antwort ist.
--
-- Das ist die Auskunft, auf die es beim Abarbeiten ankommt: Liegt der Ball
-- noch bei mir?
--
-- Ermittelt wird es wie der Vorschautext selbst – über die höchste id, nicht
-- über created_at. Die id ist streng aufsteigend, zwei Nachrichten in
-- derselben Sekunde bleiben damit eindeutig sortiert.
--
-- create or replace bei einer View darf Spalten nur anhängen, nicht
-- umbenennen oder entfernen. last_from_admin steht deshalb am Ende.
-- ============================================================================

-- Erst weg, dann neu. "create or replace view" kann Spalten nur ANHAENGEN,
-- nicht wegnehmen – und eine spaetere Migration erweitert diese Sicht. Beim
-- zweiten Durchlauf der Migrationen (der laufen koennen muss, etwa beim
-- Aufsetzen eines frischen Projekts) traefe diese Zeile sonst auf die breitere
-- Fassung und stiege mit "cannot drop columns from view" aus.
drop view if exists public.dm_threads;
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
  (array_agg(d.from_admin order by d.id desc))[1]     as last_from_admin
from public.dms d
left join public.wallets w on w.address = d.wallet
group by d.wallet, w.ui_amount, w.usd_value;

comment on view public.dm_threads is
  'Ein Eintrag je Gespraech: Vorschau, Bestand und wer zuletzt geschrieben hat.';

grant select on public.dm_threads to authenticated;
