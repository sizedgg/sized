-- ============================================================================
-- The four cron jobs: three keep the amounts current, one cleans up
--
-- To be run in the Supabase dashboard under SQL Editor. First replace
-- DEIN_CRON_SECRET below with the real value - the same one that sits in
-- CRON_SECRET in the edge function secrets.
--
-- Why three for the amounts and not one: an amount is quantity x price, and
-- the two behave completely differently. The quantity only changes when someone moves
-- tokens - the webhook reports that within seconds. The price changes
-- constantly, but is the same for every wallet. Reading every wallet from
-- the chain individually every minute would, at 1000 wallets, be 1.4
-- million calls a day for a number that almost never changes.
--
-- The script is repeatable: it clears out jobs with the same name first.
-- cron.schedule does NOT overwrite an existing job, it creates a second
-- one with the same name - then everything runs twice.
-- ============================================================================

do $$
begin
  perform cron.unschedule(jobname)
  from cron.job
  where jobname in ('price-tick', 'refresh-voters', 'refresh-holdings', 'aufraeumen');
end $$;

-- 1. Price tick: ONE price fetch, one statement, all wallets at once.
--    This is the job that keeps the amounts on the site current every
--    minute.
select cron.schedule('price-tick', '* * * * *', $$
  select net.http_post(
    url     := 'https://DEIN-PROJEKT.supabase.co/functions/v1/refresh-holdings',
    headers := '{"content-type":"application/json","x-cron-secret":"DEIN_CRON_SECRET"}'::jsonb,
    body    := '{"prices":true}'::jsonb
  );
$$);

-- 2. Whoever has a vote in an open poll gets their quantity re-read every
--    minute. The correctness of the poll depends on this, not just the
--    display.
select cron.schedule('refresh-voters', '* * * * *', $$
  select net.http_post(
    url     := 'https://DEIN-PROJEKT.supabase.co/functions/v1/refresh-holdings',
    headers := '{"content-type":"application/json","x-cron-secret":"DEIN_CRON_SECRET"}'::jsonb,
    body    := '{"all":true,"votersOnly":true,"stale":60,"limit":120}'::jsonb
  );
$$);

-- 3. Quantities of all remaining wallets, at a leisurely pace. The safety
--    net under the webhook.
select cron.schedule('refresh-holdings', '* * * * *', $$
  select net.http_post(
    url     := 'https://DEIN-PROJEKT.supabase.co/functions/v1/refresh-holdings',
    headers := '{"content-type":"application/json","x-cron-secret":"DEIN_CRON_SECRET"}'::jsonb,
    body    := '{"all":true,"stale":300,"limit":120}'::jsonb
  );
$$);

-- 4. Aufraeumen, einmal taeglich um 03:12 UTC.
--
--    Kein http_post: das ist reines SQL, die Funktion steht in der Datenbank
--    (Wanderung 20260908020000). Die Uhrzeit ist krumm, damit dieser Auftrag
--    nicht zusammen mit den drei Minutenauftraegen anlaeuft.
--
--    Was geloescht wird und warum es nichts aufweicht, steht im Kopf der
--    Wanderung - vor allem, warum eine 30 Tage alte Unterschrift keine
--    Anmeldung mehr einloesen kann.
select cron.schedule('aufraeumen', '12 3 * * *', $$
  select * from app.aufraeumen(30);
$$);

-- Check: there must be exactly four rows, each with active = true.
select jobname, schedule, active from cron.job order by jobname;

-- Und einmal von Hand, um zu sehen, dass es laeuft. Beim ersten Mal auf einer
-- frischen Datenbank steht ueberall 0 - das ist die richtige Antwort.
select * from app.aufraeumen(30);
