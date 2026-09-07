-- ============================================================================
-- DMs get a nudge, not a broadcast to everyone
-- ============================================================================
--
-- The problem
--
-- Until now every open browser listened to public.dms via `postgres_changes`.
-- For this kind of channel, Supabase checks permissions INDIVIDUALLY, for
-- every listener, on every change. From their docs:
--
--   "Postgres Changes authorizes every event against each subscriber. When you
--    make a single change to a table with 100 subscribed users, Realtime
--    performs 100 authorization checks — one per user."
--
-- So a single DM to Ansem with 3,000 open tabs triggers 3,000 permission
-- checks. At 50 DMs a minute that's around 2,500 checks a second. And the
-- same page names exactly our target size as the threshold: above ~3,000
-- concurrent listeners you're supposed to switch to broadcast.
--
-- The sentence that matters:
--
--   "changes are also processed on a single thread to preserve their order,
--    which means larger compute add-ons don't meaningfully increase Postgres
--    Changes throughput."
--
-- So a bigger server does NOT help here. This is a rebuild or nothing.
--
-- ----------------------------------------------------------------------------
-- The solution
--
-- A trigger sends two broadcasts for every new DM:
--
--   dm:<wallet>   -> to the owner of the thread     (1 listener)
--   dm:admin      -> to Ansem's inbox                (1 listener)
--
-- Two deliveries instead of 3,000 checks. Permissions are checked ONCE, when
-- joining the channel, not on every message.
--
-- ----------------------------------------------------------------------------
-- Why the broadcast carries NO content
--
-- It contains only the thread address and a timestamp - no `body`, no
-- amounts, nothing. That way the browser only knows "something happened in
-- your thread" and then loads normally from the database, where the
-- existing RLS on public.dms applies as always.
--
-- That's deliberate, and the reason I'm comfortable with this design: even
-- if the access rule further down were wrong and someone entered a
-- stranger's channel, they'd get nothing to read except the fact that a
-- message exists somewhere. The content still goes exclusively through the
-- path that's been checked since day one.
--
-- ----------------------------------------------------------------------------
-- Receive only, never send
--
-- Further down there's a rule for `select` and deliberately NONE for
-- `insert`. select means receive, insert means send. Without an insert
-- rule, no browser can send a nudge itself - nobody can fake a ping to
-- Ansem or drive other browsers into extra queries. Sending happens
-- exclusively from the trigger below, which runs inside the database.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The nudge
-- ----------------------------------------------------------------------------

create or replace function app.dm_stups()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare nutzlast jsonb;
begin
  -- Deliberately without content: only whose thread and when. See above.
  nutzlast := jsonb_build_object(
    'wallet', new.wallet,
    'at',     extract(epoch from new.created_at)
  );

  -- realtime.send(payload, event, topic, private)
  perform realtime.send(nutzlast, 'dm', 'dm:' || new.wallet, true);
  perform realtime.send(nutzlast, 'dm', 'dm:admin',          true);

  return null;
end;
$$;

drop trigger if exists trg_dms_stups on public.dms;
create trigger trg_dms_stups
  after insert on public.dms
  for each row execute function app.dm_stups();

-- ----------------------------------------------------------------------------
-- 2. Who may enter which channel
-- ----------------------------------------------------------------------------
--
-- The docs show `using (true)` as an example - "authenticated users can
-- receive broadcasts". That would be a hole here: it would let any signed-in
-- user enter the channel dm:<someone-elses-address> and learn when that
-- person is writing to Ansem. No content, but a movement profile.
--
-- So kept tight: your own address, and dm:admin only for Ansem. app.is_admin()
-- compares, as everywhere, the wallet from the login token against
-- app_config.admin_wallet - it trusts no is_admin field in the token itself.
--
-- If there's no wallet in the token, 'dm:' || null evaluates to null, and
-- the comparison is never true. So nobody gets in without being signed in.
-- ----------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'realtime') then
    raise notice 'Schema realtime fehlt – Zugangsregel übersprungen (lokaler Test?).';
    return;
  end if;

  execute 'drop policy if exists dm_stups_empfangen on realtime.messages';
  execute $regel$
    create policy dm_stups_empfangen on realtime.messages
      for select to authenticated
      using (
        extension = 'broadcast'
        and (
          (select realtime.topic()) = 'dm:' || app.jwt_wallet()
          or ((select realtime.topic()) = 'dm:admin' and app.is_admin())
        )
      )
  $regel$;
end $$;

-- ----------------------------------------------------------------------------
-- 3. public.dms drops out of live delivery
-- ----------------------------------------------------------------------------
--
-- Otherwise both would run side by side: the nudge AND the old broadcast to
-- every listener. The expensive half has to go, or the rebuild was for
-- nothing.
--
-- WATCH OUT later: whoever ever adds a postgres_changes channel on `dms`
-- back into public/app.js has to re-add the table here too. Otherwise
-- nothing arrives, with no error and no warning.
--
-- replica identity full stays in place - it costs nothing as long as the
-- table isn't published, and would be the silent trap when reverting this.
-- ----------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public' and tablename = 'dms'
     )
  then
    alter publication supabase_realtime drop table public.dms;
  end if;
end $$;
