-- ============================================================================
-- What's eating the resources?
--
-- Run in the SQL editor. Each section returns its own result; in the
-- Supabase editor you can page between them via the tabs under "Results".
-- Nothing here changes anything - purely a look-around.
-- ============================================================================

-- 1. How big are the tables, and how many rows are in them?
--    The most common reason a small server runs out of steam is simply
--    data nobody needs anymore - leftovers from a load test, say.
select
  relname                                        as tabelle,
  n_live_tup                                     as zeilen,
  pg_size_pretty(pg_total_relation_size(relid))  as groesse_gesamt,
  pg_size_pretty(pg_relation_size(relid))        as davon_daten
from pg_stat_user_tables
order by pg_total_relation_size(relid) desc;

-- 2. Connections: how many are open, and what are they doing?
--    "idle in transaction" is the dangerous state - a connection holding a
--    transaction open and thereby blocking cleanup work.
select
  state,
  count(*)                                          as anzahl,
  max(now() - state_change)                         as laengste_dauer
from pg_stat_activity
where datname = current_database()
group by state
order by anzahl desc;

-- 3. Which queries cost the most time overall?
--    Needs the pg_stat_statements extension. If it's missing, this line
--    reports an error - just skip this section then.
select
  round(total_exec_time)::bigint  as gesamt_ms,
  calls                           as aufrufe,
  round(mean_exec_time)::bigint   as schnitt_ms,
  left(query, 120)                as abfrage
from pg_stat_statements
order by total_exec_time desc
limit 15;

-- 4. Are the three cron jobs running, and running successfully?
--    status should read "succeeded". If it says "failed", something's
--    wrong with the secret or the function - they ran, but into a void.
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

-- 5. The last five cron runs in plain text - shows the error message if
--    one of them failed.
select
  j.jobname, d.status, d.start_time, left(coalesce(d.return_message, ''), 200) as meldung
from cron.job_run_details d
join cron.job j on j.jobid = d.jobid
order by d.start_time desc
limit 5;
