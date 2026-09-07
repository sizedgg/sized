-- ============================================================================
-- Keep the og function warm
--
-- Run this in the Supabase dashboard under SQL Editor.
--
-- The problem this job solves:
--
-- Someone who pastes a poll link into X's compose box first sees only the
-- link. The card appears once X's crawler has fetched the page. The wait
-- comes almost entirely from one place: an edge function that hasn't been
-- called in a while goes to sleep. The first call has to wake it, and that
-- costs one to two seconds - more than everything else in the whole path
-- combined.
--
-- And that first call is exactly the one that matters. A link gets posted
-- once; after that X caches the card for days and never asks again. So the
-- function is almost always cold when it's needed - the exact opposite of
-- what you want.
--
-- One call every two minutes keeps it warm. That's about 21,000 calls a
-- month; the Pro plan includes two million, so it costs nothing.
--
-- What gets called is /p/0 - there is no poll with that number. That's
-- deliberate: the path through the function is the same (query the
-- database, build the response), just without the image work. It warms
-- what needs warming and touches nothing else.
--
-- The user agent has to look like a bot, or the function answers with a
-- redirect and the actual work - database, page build - stays cold.
--
-- Repeatable: a job with the same name is removed first. cron.schedule does
-- NOT overwrite - it creates a second job with the same name.
-- ============================================================================

do $$
begin
  perform cron.unschedule(jobname)
  from cron.job
  where jobname = 'og-warm';
end $$;

select cron.schedule('og-warm', '*/2 * * * *', $$
  select net.http_get(
    url     := 'https://DEIN-PROJEKT.supabase.co/functions/v1/og/p/0',
    headers := '{"user-agent":"sized-warmup-bot"}'::jsonb
  );
$$);

-- Check: the job must be listed and active = true.
select jobname, schedule, active from cron.job where jobname = 'og-warm';
