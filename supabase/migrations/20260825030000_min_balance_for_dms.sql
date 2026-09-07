-- ============================================================================
-- Minimum holdings to DM Ansem - adjustable by Ansem
--
-- The chat already has a threshold (min_chat_usd). DMs didn't have one so
-- far: anyone verified was allowed to write. That's the more expensive
-- channel - a DM doesn't land in a stream you skim, it lands in an inbox one
-- single person works through. That's exactly why it's the more rewarding
-- target for spam.
--
-- Two things set this threshold apart from the one in chat:
--
--   1. It has its own value. The two channels have different costs, and
--      Ansem should be able to close the inbox without closing chat along
--      with it.
--
--   2. Ansem can change it while the app is running. There's a tightly
--      scoped function below for that instead of write access to
--      app_config. The difference matters: the same row holds treasury,
--      admin_wallet and ansem_mint. A general UPDATE right on that row would
--      mean a hijacked admin token could redirect the payment address. The
--      function here can set exactly one column.
-- ============================================================================

alter table public.app_config
  add column if not exists min_dm_usd numeric not null default 10;

comment on column public.app_config.min_dm_usd is
  'Mindestwert in USD an gehaltenen Token, um Ansem eine DM schreiben zu duerfen. 0 = aus.';

-- ----------------------------------------------------------------------------
-- Setting it: only this one column, only by Ansem
-- ----------------------------------------------------------------------------
--
-- security definer, because app_config isn't writable for normal roles and
-- should stay that way. The permission check therefore happens right here,
-- in the first line, and relies on app.is_admin() - that is, on the wallet
-- from the token, not on some field sent along with the request.
--
-- search_path is fixed. Without that, a caller with their own search_path
-- could substitute a same-named table and make the function run against
-- something other than what's written here.

create or replace function public.set_min_dm_usd(p_usd numeric)
returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v numeric;
begin
  if not app.is_admin() then
    raise exception 'Not allowed';
  end if;

  if p_usd is null or p_usd < 0 then
    raise exception 'Amount must be 0 or higher';
  end if;

  -- Upper limit as a typo brake: an accidentally added zero shouldn't close
  -- the inbox for everyone without anyone noticing.
  if p_usd > 1000000 then
    raise exception 'Amount is too high';
  end if;

  v := round(p_usd, 2);

  update public.app_config
     set min_dm_usd = v,
         updated_at = now()
   where id = 1;

  return v;
end;
$$;

comment on function public.set_min_dm_usd(numeric) is
  'Setzt die DM-Schwelle. Nur fuer Ansem, aendert ausschliesslich min_dm_usd.';

-- By default every role can execute every function. With security definer
-- that's the wrong starting point, so it's revoked first and then granted
-- specifically. anon doesn't get it - anyone unverified has no business
-- here, even though the check would reject them anyway.
revoke all on function public.set_min_dm_usd(numeric) from public;
grant execute on function public.set_min_dm_usd(numeric) to authenticated;

-- ----------------------------------------------------------------------------
-- Enforcing the threshold on insert
-- ----------------------------------------------------------------------------
-- The lock screen in the browser is courtesy, not security: it saves people
-- from typing first and getting an error message after. The binding check
-- lives here.
--
-- As in chat, the sender is taken from the token, not from new.wallet - see
-- the detailed reasoning in 20260825010000_min_balance_to_chat.sql. Replies
-- from Ansem (from_admin) continue to pass through unchecked.
--
-- The rate limits stay unchanged at 5 per minute and 30 per hour.

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
  -- Deliberately just app.is_admin() and no longer "new.from_admin or ...":
  -- from_admin comes from the client. That used to be harmless, because the
  -- RLS rule dms_insert_user rejects a foreign from_admin row at the end
  -- regardless - but an attacker could have used it to skip this check
  -- right here, leaving the block resting solely on the RLS rule. Ansem is
  -- recognized by the token, not by a field sent along with the request.
  if app.is_admin() then
    return new;
  end if;

  sender := coalesce(app.jwt_wallet(), new.wallet);

  select * into cfg from public.app_config where id = 1;

  -- ---- Minimum holdings -----------------------------------------------------
  if coalesce(cfg.min_dm_usd, 0) > 0 then
    select coalesce(w.usd_value, 0) into bal
    from public.wallets w
    where w.address = sender;

    if coalesce(bal, 0) < cfg.min_dm_usd then
      raise exception 'You need at least $% in $% to message Ansem',
        trim(to_char(cfg.min_dm_usd, 'FM999999990.99')),
        coalesce(cfg.symbol, 'tokens');
    end if;
  end if;

  -- ---- Rate limit ------------------------------------------------------------
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
