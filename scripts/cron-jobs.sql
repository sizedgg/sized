-- ============================================================================
-- Die drei Cron-Jobs, die die Beträge aktuell halten
--
-- Einzuspielen im Supabase-Dashboard unter SQL Editor. Vorher unten
-- DEIN_CRON_SECRET durch den echten Wert ersetzen – denselben, der als
-- CRON_SECRET in den Edge-Function-Secrets steht.
--
-- Warum drei und nicht einer: Ein Betrag ist Menge x Kurs, und die beiden
-- verhalten sich völlig verschieden. Die Menge ändert sich nur, wenn jemand
-- Token bewegt – das meldet der Webhook in Sekunden. Der Kurs ändert sich
-- dauernd, ist aber für alle Wallets derselbe. Jede Minute jede Wallet
-- einzeln von der Chain zu lesen wären bei 1000 Wallets 1,4 Millionen
-- Abrufe am Tag für eine Zahl, die sich fast nie ändert.
--
-- Das Skript ist wiederholbar: Es räumt gleichnamige Jobs vorher weg.
-- cron.schedule überschreibt einen bestehenden Job NICHT, sondern legt einen
-- zweiten mit demselben Namen an – dann läuft alles doppelt.
-- ============================================================================

do $$
begin
  perform cron.unschedule(jobname)
  from cron.job
  where jobname in ('price-tick', 'refresh-voters', 'refresh-holdings');
end $$;

-- 1. Kurs-Takt: EIN Kursabruf, eine Anweisung, alle Wallets gleichzeitig.
--    Das ist der Job, der die Beträge im Chat jede Minute aktuell hält.
select cron.schedule('price-tick', '* * * * *', $$
  select net.http_post(
    url     := 'https://DEIN-PROJEKT.supabase.co/functions/v1/refresh-holdings',
    headers := '{"content-type":"application/json","x-cron-secret":"DEIN_CRON_SECRET"}'::jsonb,
    body    := '{"prices":true}'::jsonb
  );
$$);

-- 2. Wer in einer offenen Abstimmung eine Stimme hat, wird jede Minute mit
--    der Menge nachgelesen. Hieran hängt die Korrektheit der Abstimmung,
--    nicht nur die Anzeige.
select cron.schedule('refresh-voters', '* * * * *', $$
  select net.http_post(
    url     := 'https://DEIN-PROJEKT.supabase.co/functions/v1/refresh-holdings',
    headers := '{"content-type":"application/json","x-cron-secret":"DEIN_CRON_SECRET"}'::jsonb,
    body    := '{"all":true,"votersOnly":true,"stale":60,"limit":120}'::jsonb
  );
$$);

-- 3. Mengen aller übrigen Wallets, gemächlich. Das Netz unter dem Webhook.
select cron.schedule('refresh-holdings', '* * * * *', $$
  select net.http_post(
    url     := 'https://DEIN-PROJEKT.supabase.co/functions/v1/refresh-holdings',
    headers := '{"content-type":"application/json","x-cron-secret":"DEIN_CRON_SECRET"}'::jsonb,
    body    := '{"all":true,"stale":300,"limit":120}'::jsonb
  );
$$);

-- Prüfen: Es müssen genau drei Zeilen dastehen, jede mit active = true.
select jobname, schedule, active from cron.job order by jobname;
