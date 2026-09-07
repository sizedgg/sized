-- ============================================================================
-- Rate limits
--
-- RLS governs WHAT someone may do - not HOW OFTEN. A verified wallet could
-- otherwise flood the chat with a loop, and that costs more than nerves -
-- it costs egress and realtime messages.
--
-- Deliberately in the database and not the frontend: the browser talks
-- directly to PostgREST, a limit in JavaScript would be a polite request.
-- ============================================================================

-- For the counting windows
create index if not exists idx_messages_wallet_time on public.messages (wallet, created_at desc);
create index if not exists idx_dms_wallet_time      on public.dms (wallet, created_at desc);

-- ----------------------------------------------------------------------------
-- Chat: 10 messages per minute, 120 per hour. Ansem is exempt.
-- ----------------------------------------------------------------------------

create or replace function app.rate_limit_messages()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  per_minute int;
  per_hour   int;
begin
  if app.is_admin() then
    return new;
  end if;

  select
    count(*) filter (where created_at > now() - interval '1 minute'),
    count(*)
  into per_minute, per_hour
  from public.messages
  where wallet = new.wallet
    and created_at > now() - interval '1 hour';

  if per_minute >= 10 then
    raise exception 'Slow down - you can send 10 messages per minute';
  end if;
  if per_hour >= 120 then
    raise exception 'Message limit reached - try again later';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_messages_rate_limit on public.messages;
create trigger trg_messages_rate_limit
  before insert on public.messages
  for each row execute function app.rate_limit_messages();

-- ----------------------------------------------------------------------------
-- DMs: 5 per minute, 30 per hour - Ansem's inbox is meant to stay readable.
-- Replies from Ansem himself are exempt.
-- ----------------------------------------------------------------------------

create or replace function app.rate_limit_dms()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  per_minute int;
  per_hour   int;
begin
  if new.from_admin or app.is_admin() then
    return new;
  end if;

  select
    count(*) filter (where created_at > now() - interval '1 minute'),
    count(*)
  into per_minute, per_hour
  from public.dms
  where wallet = new.wallet
    and not from_admin
    and created_at > now() - interval '1 hour';

  if per_minute >= 5 then
    raise exception 'Slow down - you can send 5 messages per minute';
  end if;
  if per_hour >= 30 then
    raise exception 'Message limit reached - try again later';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_dms_rate_limit on public.dms;
create trigger trg_dms_rate_limit
  before insert on public.dms
  for each row execute function app.rate_limit_dms();

-- ----------------------------------------------------------------------------
-- Protect login amounts against exhaustion
--
-- Every open login occupies one of roughly 100,000 possible amounts.
-- Anyone creating challenges for invented addresses en masse could empty
-- out the supply and thereby block every login. This function gives the
-- edge function a brake to work with: when it gets tight, the surge
-- becomes visible.
-- ----------------------------------------------------------------------------

create or replace function public.pending_challenge_count()
returns integer
language sql
security definer
set search_path = public, pg_temp
as $$
  select count(*)::int from public.challenges
  where status = 'pending' and expires_at > now();
$$;

revoke all on function public.pending_challenge_count() from public, anon, authenticated;

-- Release expired challenges so their amount becomes usable again.
create or replace function public.expire_stale_challenges()
returns integer
language sql
security definer
set search_path = public, pg_temp
as $$
  with gone as (
    update public.challenges set status = 'expired'
    where status = 'pending' and expires_at < now()
    returning 1
  )
  select count(*)::int from gone;
$$;

revoke all on function public.expire_stale_challenges() from public, anon, authenticated;
