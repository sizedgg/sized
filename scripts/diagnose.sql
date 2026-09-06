-- ============================================================================
-- Was frisst die Ressourcen?
--
-- Im SQL-Editor ausführen. Jeder Abschnitt gibt ein eigenes Ergebnis; im
-- Supabase-Editor lässt sich zwischen ihnen über die Reiter unter "Results"
-- blättern. Nichts hier verändert etwas – reines Nachsehen.
-- ============================================================================

-- 1. Wie groß sind die Tabellen und wie viele Zeilen stehen drin?
--    Der häufigste Grund für einen erschöpften kleinen Server sind schlicht
--    Daten, die niemand mehr braucht – etwa Reste aus einem Lasttest.
select
  relname                                        as tabelle,
  n_live_tup                                     as zeilen,
  pg_size_pretty(pg_total_relation_size(relid))  as groesse_gesamt,
  pg_size_pretty(pg_relation_size(relid))        as davon_daten
from pg_stat_user_tables
order by pg_total_relation_size(relid) desc;

-- 2. Verbindungen: wie viele sind offen, und was tun sie?
--    "idle in transaction" ist der gefährliche Zustand – eine Verbindung, die
--    eine Transaktion offen hält und damit Aufräumarbeiten blockiert.
select
  state,
  count(*)                                          as anzahl,
  max(now() - state_change)                         as laengste_dauer
from pg_stat_activity
where datname = current_database()
group by state
order by anzahl desc;

-- 3. Welche Abfragen kosten am meisten Zeit insgesamt?
--    Braucht die Erweiterung pg_stat_statements. Fehlt sie, meldet die Zeile
--    einen Fehler – dann diesen Abschnitt einfach überspringen.
select
  round(total_exec_time)::bigint  as gesamt_ms,
  calls                           as aufrufe,
  round(mean_exec_time)::bigint   as schnitt_ms,
  left(query, 120)                as abfrage
from pg_stat_statements
order by total_exec_time desc
limit 15;

-- 4. Laufen die drei Cronjobs, und laufen sie durch?
--    status sollte "succeeded" sein. Steht dort "failed", stimmt etwas mit
--    dem Secret oder der Function nicht – dann liefen sie zwar, aber ins Leere.
select
  j.jobname,
  d.status,
  count(*)              as laeufe,
  max(d.start_time)     as zuletzt
from cron.job_run_details d
join cron.job j on j.jobid = d.jobid
where d.start_time > now() - interval '30 minutes'
group by j.jobname, d.status
order by j.jobname, d.status;

-- 5. Die letzten fünf Cron-Läufe im Klartext – zeigt die Fehlermeldung, falls
--    einer fehlgeschlagen ist.
select
  j.jobname, d.status, d.start_time, left(coalesce(d.return_message, ''), 200) as meldung
from cron.job_run_details d
join cron.job j on j.jobid = d.jobid
order by d.start_time desc
limit 5;
