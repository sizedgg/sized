-- ============================================================================
-- Lasttest-Reste entfernen
--
-- In der Tabelle wallets stehen 27.477 Zeilen. Echt sind davon eine Handvoll –
-- der Rest stammt aus dem Lasttest, der zufällige Adressen erzeugt hat.
--
-- Warum das nicht nur Speicherplatz kostet:
--
--   * Der Kurs-Takt schreibt jede Minute jede Wallet neu, deren usd_value sich
--     durch den neuen Kurs ändert. Bei 27.000 Zeilen und einem Kurs, der sich
--     dauernd bewegt, sind das grob 27.000 Schreibvorgänge pro Minute – rund
--     39 Millionen am Tag, für Adressen, die es nicht gibt.
--
--   * Job 3 (refresh-holdings) nimmt pro Lauf die 120 ältesten Wallets und
--     liest deren Menge von der Chain. Bei 27.000 Einträgen braucht ein voller
--     Durchlauf gut vier Stunden und beginnt sofort wieder von vorn. Das sind
--     172.800 RPC-Aufrufe am Tag, alle für erfundene Adressen.
--
-- Das ist mit hoher Wahrscheinlichkeit der Grund für den Warnhinweis im
-- Dashboard.
--
-- ANLEITUNG: Abschnitt 1 zuerst allein ausführen und die Zahlen ansehen.
-- Erst danach Abschnitt 2. Abschnitt 1 ändert nichts.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. VORSCHAU – was würde verschwinden, was bleibt?
-- ----------------------------------------------------------------------------
-- Behalten wird jede Adresse, die irgendwo sonst vorkommt: als Absender einer
-- Nachricht, in einem DM-Faden, mit einer Stimme in einer Abstimmung, mit einer
-- offenen Zahlungsanforderung – und Ansem selbst.
with behalten as (
  select wallet from public.messages
  union select wallet from public.dms
  union select wallet from public.votes
  union select wallet from public.challenges where status = 'pending'
  union select admin_wallet from public.app_config where admin_wallet is not null
)
select
  count(*) filter (where w.address in (select wallet from behalten)) as bleibt,
  count(*) filter (where w.address not in (select wallet from behalten)) as wird_geloescht,
  count(*)                                                            as gesamt
from public.wallets w;

-- Und zur Sicherheit: Welche Adressen bleiben? Das sollten wenige sein und
-- welche, die du wiedererkennst.
with behalten as (
  select wallet from public.messages
  union select wallet from public.dms
  union select wallet from public.votes
  union select wallet from public.challenges where status = 'pending'
  union select admin_wallet from public.app_config where admin_wallet is not null
)
select w.address, w.ui_amount, w.usd_value, w.updated_at
from public.wallets w
where w.address in (select wallet from behalten)
order by w.usd_value desc nulls last;


-- ----------------------------------------------------------------------------
-- 2. AUFRÄUMEN – erst ausführen, wenn Abschnitt 1 plausibel aussah
-- ----------------------------------------------------------------------------

-- Nachrichten aus dem Lasttest. Sie tragen alle dieselbe Markierung.
delete from public.messages where body like '[loadtest]%';

-- Zahlungsanforderungen, die nie eingelöst wurden.
delete from public.challenges where status = 'pending';

-- Und die Wallets selbst.
delete from public.wallets w
where w.address not in (
  select wallet from public.messages
  union select wallet from public.dms
  union select wallet from public.votes
  union select wallet from public.challenges where status = 'pending'
  union select admin_wallet from public.app_config where admin_wallet is not null
);

-- Nach einem Löschen dieser Größe muss Postgres den Platz erst freigeben und
-- seine Statistiken neu bilden. Ohne das plant es weiter mit 27.000 Zeilen und
-- wählt schlechte Zugriffswege.
vacuum full analyze public.wallets;
vacuum full analyze public.messages;

-- Antworten von net.http_post sammeln sich hier an – pg_net räumt sie auf,
-- aber mit Verzögerung. Alles, was älter als eine Stunde ist, wird nicht mehr
-- gebraucht.
delete from net._http_response where created < now() - interval '1 hour';


-- ----------------------------------------------------------------------------
-- 3. NACHHER – dieselbe Übersicht wie in der Diagnose
-- ----------------------------------------------------------------------------
select
  relname as tabelle,
  n_live_tup as zeilen,
  pg_size_pretty(pg_total_relation_size(relid)) as groesse
from pg_stat_user_tables
order by pg_total_relation_size(relid) desc
limit 10;
