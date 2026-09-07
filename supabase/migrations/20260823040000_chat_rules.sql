-- ============================================================================
-- Chat rules tightened
--
--  * 6 messages per minute instead of 10
--  * no identical message twice in a row from the same wallet
--
-- On the repeat block: the comparison is normalized - case, leading and
-- repeated whitespace don't count. Otherwise the block could be beaten with
-- a trailing space.
--
-- And it only looks back one hour. Without that window, "gm" would be
-- blocked forever after the first time, as long as nothing else came in
-- between - in a crypto chat that would be the wrong kind of strict.
-- ============================================================================

create or replace function app.rate_limit_messages()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  per_minute int;
  per_hour   int;
  last_body  text;
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

  if per_minute >= 6 then
    raise exception 'Slow down - you can send 6 messages per minute';
  end if;
  if per_hour >= 120 then
    raise exception 'Message limit reached - try again later';
  end if;

  -- The last message this wallet sent within the last hour
  select regexp_replace(lower(btrim(body)), '\s+', ' ', 'g')
  into last_body
  from public.messages
  where wallet = new.wallet
    and created_at > now() - interval '1 hour'
  order by id desc
  limit 1;

  if last_body is not null
     and last_body = regexp_replace(lower(btrim(new.body)), '\s+', ' ', 'g') then
    raise exception 'You already said that';
  end if;

  return new;
end;
$$;
