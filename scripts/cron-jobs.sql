-- ============================================================================
-- The three cron jobs that keep the amounts current
--
-- To be run in the Supabase dashboard under SQL Editor. First replace
-- DEIN_CRON_SECRET below with the real value - the same one that sits in
-- CRON_SECRET in the edge function secrets.
--
-- Why three and not one: an amount is quantity x price, and the two behave
-- completely differently. The quantity only changes when someone moves
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
  where jobname in ('price-tick', 'refresh-voters', 'refresh-holdings');
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

-- Check: there must be exactly three rows, each with active = true.
select jobname, schedule, active from cron.job order by jobname;
