-- ============================================================================
-- Minimum balance to write in chat
--
-- Anyone who wants to post has to hold at least a certain value in token.
-- Reading stays free for everyone verified - the point isn't to lock people
-- out, it's that a throwaway wallet costs nothing and would otherwise be
-- the cheapest path to spam.
--
-- The amount lives in app_config, not in code: Ansem should be able to
-- change it without anyone shipping a new release.
--
-- ----------------------------------------------------------------------------
-- This also closes a gap that was already open before
-- ----------------------------------------------------------------------------
--
-- Several BEFORE INSERT triggers on the same table fire in alphabetical
-- order of their name. On public.messages that means:
--
--     trg_messages_rate_limit   <- checks
--     trg_messages_sender       <- sets new.wallet to the wallet from the token
--     trg_messages_stamp        <- records balance and USD value
--
-- So the check ran BEFORE the sender address was corrected. Up to that
-- point, new.wallet still held exactly what the client sent. So anyone
-- entering a foreign address on insert was checked against THAT wallet's
-- counters - their own stayed at zero. That let the limit of six messages
-- per minute and the repeat-message block be bypassed entirely, just by
-- varying one field. The message itself was then correctly attributed by
-- force_sender afterward, so the abuse stayed invisible.
--
-- The RLS rule doesn't catch this: it checks the row after all BEFORE
-- triggers have run - by that point the address is correct again.
--
-- From here on, the check no longer relies on new.wallet but on the wallet
-- from the token. That can't be manipulated and doesn't depend on trigger
-- order.
-- ============================================================================

alter table public.app_config
  add column if not exists min_chat_usd numeric not null default 10;

comment on column public.app_config.min_chat_usd is
  'Mindestwert in USD an gehaltenen Token, um im Chat schreiben zu dürfen. 0 = aus.';

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

  -- Not new.wallet: see the top of this file.
  sender := coalesce(app.jwt_wallet(), new.wallet);

  select * into cfg from public.app_config where id = 1;

  -- ---- Minimum balance -------------------------------------------------
  if coalesce(cfg.min_chat_usd, 0) > 0 then
    select coalesce(w.usd_value, 0) into bal
    from public.wallets w
    where w.address = sender;

    if coalesce(bal, 0) < cfg.min_chat_usd then
      raise exception 'You need at least $% in $% to write here',
        trim(to_char(cfg.min_chat_usd, 'FM999999990.99')),
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
  -- Only the immediately preceding message from the same wallet counts, so
  -- that yes / no / yes stays possible.
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
-- Close the same gap for DMs
-- ----------------------------------------------------------------------------
-- No minimum balance applies to DMs - anyone verified may write to Ansem.
-- But the sender check has to go by the token for the same reason, not by
-- the submitted field.

create or replace function app.rate_limit_dms()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  sender     text;
  per_minute int;
  per_hour   int;
begin
  if new.from_admin or app.is_admin() then
    return new;
  end if;

  sender := coalesce(app.jwt_wallet(), new.wallet);

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
