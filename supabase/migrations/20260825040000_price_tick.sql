-- ============================================================================
-- Price tick: all amounts once a minute, for everyone at the same time
--
-- The goal is that the $ amounts next to the names in chat don't jump at a
-- different moment for every visitor, but for everyone at the same instant -
-- once a minute.
--
-- The naive way would be to re-read every wallet from the chain every
-- minute. That's one RPC call per wallet per minute: with a thousand
-- wallets, 1.4 million calls a day, for a number that almost never changes.
--
-- The amount consists of two parts, and they behave completely differently:
--
--   Balance   only changes when someone moves tokens. The Helius webhook
--             reports that within seconds, and the cron run for balances is
--             the safety net underneath.
--
--   Price     changes constantly, but is the same for every wallet.
--
-- So exactly one price gets fetched once a minute and applied to all wallets
-- in a single statement. One external call instead of a thousand, and
-- because it's a single statement, every amount changes at the same
-- instant - exactly what "for everyone at the same time" means.
-- ============================================================================

-- Kept separate from updated_at, and that's not a cosmetic detail:
-- updated_at says when the BALANCE was last read from the chain, and that's
-- exactly what wallets_to_refresh hangs on. If the price tick touched
-- updated_at, every wallet would look fresh every minute - and balances
-- would never get re-read again.
alter table public.wallets
  add column if not exists priced_at timestamptz;

comment on column public.wallets.priced_at is
  'Wann zuletzt ein neuer Kurs angewandt wurde. Nicht updated_at benutzen - das gilt der Menge.';

create or replace function public.apply_token_price(p_price numeric)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n integer;
begin
  -- The price fetch returns 0 on failure. Letting that value through would
  -- be the most expensive mistake this function could make: every wallet
  -- would sit at $0, the chat filter would show nobody anymore, every write
  -- lock would engage, and every vote weight in running polls would drop to
  -- zero. A failed price fetch has to stay consequence-free - the last
  -- known price is always better than a made-up one.
  if p_price is null or p_price <= 0 then
    raise exception 'Refusing to apply a price of zero or less';
  end if;

  -- Only what actually changes. That keeps not just the table quiet, but
  -- also trg_wallets_sync_votes: the trigger hangs on usd_value and would
  -- otherwise fire for every wallet, including the thousand where the math
  -- comes out the same.
  update public.wallets
     set usd_value = ui_amount * p_price,
         price     = p_price,
         priced_at = now()
   where usd_value is distinct from (ui_amount * p_price)::numeric(20, 4)
      or price     is distinct from p_price;

  get diagnostics n = row_count;
  return n;
end;
$$;

comment on function public.apply_token_price(numeric) is
  'Wendet einen Kurs auf alle Wallets an. Nur fuer den Kurs-Takt (Service-Role).';

-- No client has any business here: whoever can set the price sets every
-- vote weight and every write lock in the whole system.
revoke all on function public.apply_token_price(numeric) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Balances: allow more per run
-- ----------------------------------------------------------------------------
-- The caller used to cap this at 40 wallets per run. That's enough for the
-- leisurely tick, but not enough to get through in one run as the user
-- count grows. The cap now lives inside the function itself, so a
-- mistyped call can't accidentally read in half the table.

create or replace function public.wallets_to_refresh(
  stale_seconds int default 120,
  max_rows int default 100,
  voters_only boolean default false
)
returns table (address text)
language sql
security definer
set search_path = public, pg_temp
as $$
  select w.address
  from public.wallets w
  where w.updated_at < now() - make_interval(secs => stale_seconds)
    and (
      not voters_only
      or exists (
        select 1
        from public.votes v
        join public.polls p on p.id = v.poll_id
        where v.wallet = w.address
          and not p.closed
          and (p.closes_at is null or p.closes_at > now())
      )
    )
  order by w.updated_at asc
  limit least(greatest(max_rows, 1), 500);
$$;

revoke all on function public.wallets_to_refresh(int, int, boolean) from public, anon, authenticated;
