-- ============================================================================
-- The amount in the lockout messages had one dot too many
--
-- Both messages built the amount with to_char(x, 'FM999999990.99'). The FM
-- strips the redundant zeros, but not the decimal point in front of them.
-- So at a round threshold it read:
--
--     You need at least $10. in $ANSEM to message Ansem
--
-- A dot in the middle of the sentence, right after the number. Reads like a
-- truncated amount - you wonder if decimal places are missing. At 10.50 it
-- didn't stand out, which is why it slipped through for so long.
--
-- app.betrag_text() turns this into one place where that can be fixed,
-- instead of maintaining the formatting in two spots.
-- ============================================================================

create or replace function app.betrag_text(v numeric)
returns text
language sql
immutable
as $$
  select trim(trailing '.' from trim(to_char(coalesce(v, 0), 'FM999999990.99')));
$$;

comment on function app.betrag_text(numeric) is
  'Betrag fuer Meldungen: 10 -> "10", 10.5 -> "10.5", 1000 -> "1000".';

-- ----------------------------------------------------------------------------
-- Chat
-- ----------------------------------------------------------------------------
-- Unchanged except for the line with the message. The reasoning behind the
-- sender check is at the top of 20260825010000_min_balance_to_chat.sql.

create or replace function app.rate_limit_messages()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  sender     text;
  cfg        public.app_config%rowtype;
  bal        numeric;
  per_minute int;
  per_hour   int;
  last_body  text;
begin
  if app.is_admin() then
    return new;
  end if;

  -- Not new.wallet: triggers on the same table fire in alphabetical order,
  -- and the sender correction runs after this check.
  sender := coalesce(app.jwt_wallet(), new.wallet);

  select * into cfg from public.app_config where id = 1;

  -- ---- Minimum balance -------------------------------------------------
  if coalesce(cfg.min_chat_usd, 0) > 0 then
    select coalesce(w.usd_value, 0) into bal
    from public.wallets w
    where w.address = sender;

    if coalesce(bal, 0) < cfg.min_chat_usd then
      raise exception 'You need at least $% in $% to write here',
        app.betrag_text(cfg.min_chat_usd),
        coalesce(cfg.symbol, 'tokens');
    end if;
  end if;

  -- ---- No links -----------------------------------------------------------
  if app.contains_link(new.body) then
    raise exception 'Links are not allowed in chat - send it as a DM instead';
  end if;

  -- ---- Rate limit -----------------------------------------------------
  select
    count(*) filter (where created_at > now() - interval '1 minute'),
    count(*)
  into per_minute, per_hour
  from public.messages
  where wallet = sender
    and created_at > now() - interval '1 hour';

  if per_minute >= 6 then
    raise exception 'Slow down - you can send 6 messages per minute';
  end if;
  if per_hour >= 120 then
    raise exception 'Message limit reached - try again later';
  end if;

  -- ---- No identical message twice in a row ---------------------------
  select regexp_replace(lower(btrim(body)), '\s+', ' ', 'g')
  into last_body
  from public.messages
  where wallet = sender
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

-- ----------------------------------------------------------------------------
-- DMs
-- ----------------------------------------------------------------------------
-- Also unchanged except for the message. Why app.is_admin() is used here
-- instead of new.from_admin is explained at the top of
-- 20260825030000_min_balance_for_dms.sql.

create or replace function app.rate_limit_dms()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  sender     text;
  cfg        public.app_config%rowtype;
  bal        numeric;
  per_minute int;
  per_hour   int;
begin
  if app.is_admin() then
    return new;
  end if;

  sender := coalesce(app.jwt_wallet(), new.wallet);

  select * into cfg from public.app_config where id = 1;

  -- ---- Minimum balance -------------------------------------------------
  if coalesce(cfg.min_dm_usd, 0) > 0 then
    select coalesce(w.usd_value, 0) into bal
    from public.wallets w
    where w.address = sender;

    if coalesce(bal, 0) < cfg.min_dm_usd then
      raise exception 'You need at least $% in $% to message Ansem',
        app.betrag_text(cfg.min_dm_usd),
        coalesce(cfg.symbol, 'tokens');
    end if;
  end if;

  -- ---- Rate limit -----------------------------------------------------
  select
    count(*) filter (where created_at > now() - interval '1 minute'),
    count(*)
  into per_minute, per_hour
  from public.dms
  where wallet = sender
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
