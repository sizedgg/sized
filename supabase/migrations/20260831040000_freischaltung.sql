-- ============================================================================
-- The site is online, but still closed
--
-- New column app_config.open_to_public. As long as it is false, the verify
-- edge function lets nobody in anymore except the wallet stored in
-- admin_wallet.
--
-- ----------------------------------------------------------------------------
-- Why the lock sits here and not in the sheet
--
-- The sheet lives on a public web space. Anything it knows can be read,
-- and anything it hides can be unhidden again. A page that merely
-- considers itself closed is therefore no lock at all.
--
-- Login, on the other hand, runs through exactly one gate: verify issues a
-- challenge, and without a challenge there is no amount for the treasury
-- to listen for. Whoever is turned away there does not get in - no matter
-- what they do in the browser.
--
-- ----------------------------------------------------------------------------
-- Why the no has to come BEFORE the payment
--
-- Logging in is a transfer. If the payment were checked first and the
-- gating second, whoever got rejected would have sent money for nothing.
-- The refusal therefore sits right at the start of createChallenge - before
-- the line that names an amount.
--
-- For the same reason checkStatus does NOT check: whoever holds a challenge
-- has already been told an amount. If the site is locked in the meantime
-- and they pay, they get their session. That is the right order - a price
-- once quoted holds, even if the shop happens to be closing. It is at most
-- 15 minutes (CHALLENGE_TTL_MIN).
--
-- ----------------------------------------------------------------------------
-- Default true: this migration changes NOTHING by itself
--
-- It only installs the switch, it does not flip it. The site stays open
-- until someone explicitly closes it:
--
--   update public.app_config set open_to_public = false where id = 1;   -- close
--   update public.app_config set open_to_public = true  where id = 1;   -- open
--
-- Both take effect immediately, with no new upload and no deployment.
--
-- The default here used to be false, and the function also read a missing
-- column as "closed" - on the reasoning that when in doubt, better let
-- nobody in. That was right as long as the site needed to stay locked
-- before launch.
--
-- After that, the worse case flips around: then a rollout that has nothing
-- to do with any of this locks the running site - because someone forgot
-- to bring the migration along. A trap that reacts to a forgotten step is
-- worse than one that reacts to a decision.
--
-- ----------------------------------------------------------------------------
-- Two addresses get through, not one
--
-- admin_wallet and the new column test_wallet. The reason is not
-- convenience: the site behaves DIFFERENTLY for the two sides. Ansem sees
-- an inbox and sets the threshold, a user sees the threshold from below.
-- Checking only against Ansem's wallet would mean never seeing the half
-- that everyone else sees.
--
-- Exactly one test address, not a field with several: a list would be the
-- spot where, eventually, someone is left standing who was forgotten and
-- never removed.
--
-- ----------------------------------------------------------------------------
-- A connection that is easy to miss
--
-- Until launch, admin_wallet still holds the operator's own wallet. If it
-- gets switched to Ansem's real address WHILE the site is closed, that
-- locks the operator out themselves - unless their own address is then in
-- test_wallet.
-- ============================================================================

alter table public.app_config
  add column if not exists open_to_public boolean not null default true;

alter table public.app_config
  add column if not exists test_wallet text;

comment on column public.app_config.open_to_public is
  'false = die Seite ist zu: verify laesst nur admin_wallet und test_wallet '
  'herein, alle anderen bekommen eine Absage, bevor ein Betrag genannt wird. '
  'true oder fehlend = offen fuer alle. Wirkt sofort, ohne neuen Upload des '
  'Blatts.';

comment on column public.app_config.test_wallet is
  'Eine einzelne Adresse, die vor der Freischaltung ebenfalls hereinkommt – '
  'zum Pruefen der Nutzerseite, die sich anders verhaelt als Ansems. Nach dem '
  'Start ohne Wirkung, weil dann alle hereinkommen. Leeren mit null.';

do $$
begin
  if exists (select 1 from public.app_config where id = 1 and not open_to_public) then
    raise notice 'Die Seite steht auf ZU. Aufmachen: update public.app_config set open_to_public = true where id = 1;';
  else
    raise notice 'Der Schalter ist da, die Seite bleibt offen. Zusperren: update public.app_config set open_to_public = false where id = 1;';
  end if;
end $$;
