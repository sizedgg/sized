-- ============================================================================
-- A challenge belongs to whoever opened it - and to no one else
--
-- ----------------------------------------------------------------------------
-- The gap: logging in as Ansem without owning his wallet
--
-- Login runs in two steps through the edge function verify:
--
--   POST { action: 'challenge', wallet }   -> challengeId + amount
--   POST { action: 'status', challengeId } -> the JWT, eventually
--
-- The first step does NOT check whether the caller owns the wallet - that's
-- deliberate and correct: the payment itself is the proof, and that's
-- exactly why nobody has to connect a wallet.
--
-- But the second step only required the challengeId. And that's known by
-- whoever opened the challenge.
--
-- On top of that came createChallenge: if an open challenge already existed
-- for a wallet, IT was returned instead of creating a new one. The idea was
-- to avoid double cost on reload. But it also meant: two different people
-- typing the same address get the SAME challengeId.
--
-- Which left the path wide open:
--
--   1. Attacker calls challenge with ANSEM'S address. He gets a challengeId
--      and an amount. Cost: nothing.
--   2. Ansem logs in at some point. createChallenge finds the open
--      challenge and returns him the same one - amount included.
--   3. Ansem pays. scanTreasury books the payment: sender matches, amount
--      matches, status becomes 'paid'.
--   4. The attacker polls status with HIS challengeId. Whoever wins the
--      status change to 'used' gets the JWT.
--
-- The JWT carries wallet = Ansem's address. app.is_admin() compares this
-- address against app_config.admin_wallet - and says yes. Inbox, creating
-- and deleting polls, setting the DM threshold: all of it.
--
-- Ansem wouldn't have to make any mistake for this. He logs in completely
-- normally. The attacker only needs a challenge open on his address
-- beforehand, and he can keep it open indefinitely - it costs him nothing.
--
-- ----------------------------------------------------------------------------
-- What the gap was NOT
--
-- Everything around it holds up, and that's why it hinges on exactly this
-- one spot and not five:
--
--   * app.is_admin() does NOT trust the is_admin claim in the token. It
--     compares the wallet from the token against app_config.admin_wallet.
--     A self-crafted "is_admin: true" gets you nowhere.
--   * verifyWalletJwt() always checks the signature with HS256, no matter
--     what the token's header claims. The alg-none trick doesn't work.
--   * challenges is unreadable for clients (RLS with no rule, no grants).
--     The attacker didn't even need to read the id - he already had it.
--   * The payment has to come FROM the registered wallet (.eq('wallet',
--     p.sender)). Paying on someone else's behalf doesn't work.
--
-- Exactly one thing was missing: that the proof ends up belonging to
-- whoever requested it.
--
-- ----------------------------------------------------------------------------
-- The lock
--
-- On creation, verify now rolls a secret, hands it out exactly once, and
-- stores only its SHA-256 fingerprint here. Polling status and mock-pay
-- both require it. Whoever doesn't have it gets no proof - even knowing
-- the id doesn't help.
--
-- Only the fingerprint, not the secret: the table is already unreadable for
-- clients, but a data dump, a backup, or a look in the dashboard shouldn't
-- hand anyone a stranger's login either.
--
-- And createChallenge now only hands out an open challenge if the caller
-- submits its secret. Otherwise it creates a new one - with a new amount.
-- That leaves the attack from above running into nothing: Ansem's payment
-- carries HIS amount, and scanTreasury books it against HIS challenge. The
-- attacker's is never paid and simply expires.
--
-- ----------------------------------------------------------------------------
-- Why an upper limit on open challenges per wallet on top of that
--
-- The unique index on open amounts (uq_challenges_open_amount) makes every
-- amount exclusive, and there are only NONCE_MAX = 100,000 of them. Without
-- a limit, someone could open thousands of challenges for a foreign address
-- and occupy the amounts; verify rolls twenty times and then gives up. That
-- wouldn't be a takeover anymore, but it would be a locked door for the
-- rightful owner.
--
-- Three open per wallet: enough for phone, computer, and one stalled
-- attempt, and nowhere near 100,000. Expired ones don't count.
-- ============================================================================

alter table public.challenges
  add column if not exists secret_hash text;

comment on column public.challenges.secret_hash is
  'SHA-256 (Hex) des Geheimnisses, das verify beim Anlegen genau einmal '
  'herausgibt. Status und mock-pay verlangen es. Ohne diese Spalte reichte '
  'die challengeId, und die kennt auch, wer die Challenge fuer eine FREMDE '
  'Wallet geoeffnet hat.';

-- Lookup goes via (id, secret_hash); the primary key is enough.

-- ----------------------------------------------------------------------------
-- Upper limit on open challenges per wallet
-- ----------------------------------------------------------------------------
create or replace function app.limit_open_challenges()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  offen int;
begin
  select count(*) into offen
    from public.challenges
   where wallet = new.wallet
     and status = 'pending'
     and expires_at > now();

  if offen >= 3 then
    raise exception 'Too many open verification requests for this address - wait a few minutes';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_challenges_limit on public.challenges;
create trigger trg_challenges_limit
  before insert on public.challenges
  for each row execute function app.limit_open_challenges();

-- ----------------------------------------------------------------------------
-- Existing rows
-- ----------------------------------------------------------------------------
-- Open challenges without a fingerprint are from before this. verify
-- rejects them after rollout, and that's correct: any one of them COULD be
-- an attacker's, and there's no way to tell by looking. Setting them to
-- 'expired' right here makes that visible instead of leaving it as a
-- silent rejection buried in the function - whoever was mid-login just
-- starts over, and pays nothing twice because they hadn't paid yet.
--
-- Challenges already PAID are left untouched: money has moved there, and
-- the path to the token has to stay open.
update public.challenges
   set status = 'expired'
 where status = 'pending'
   and secret_hash is null;

do $$
declare n int;
begin
  select count(*) into n from public.challenges where secret_hash is null and status = 'paid';
  if n > 0 then
    raise notice '% bezahlte Challenge(n) ohne Geheimnis - verify laesst diese noch einmal durch, danach nie wieder.', n;
  else
    raise notice 'Challenges gehoeren ab jetzt ihrem Ersteller. verify und app.js muessen zusammen mit dieser Migration ausgerollt werden.';
  end if;
end $$;
