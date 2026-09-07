-- ============================================================================
-- The values SIZED goes live with - template
-- ============================================================================
--
-- This file is the instructions. The version with the real addresses is
-- called start-konfiguration.sql, sits right next to it, and is in
-- .gitignore - just like public/config.js, and for the same reason: an
-- address in this repo is a public statement about who's behind the
-- project. What goes there is the operator's call, not this template's.
--
-- To use: copy it, replace the four placeholders, run it in the SQL editor
-- of the Supabase dashboard, once, shortly before opening up. Then run the
-- verification query below and actually look at it - not just register
-- "no error message".
--
-- ----------------------------------------------------------------------------
-- Why everything is in ONE statement
--
-- An update that aborts halfway through otherwise leaves a half
-- configuration behind: new treasury, old admin wallet. The site then
-- keeps running and accepting payments while the admin is still
-- yesterday's.
--
-- ----------------------------------------------------------------------------
-- The addresses
--
-- Both need to be checked before entering them, and by computation, not by
-- eye:
--
--   44 characters, exclusively from the Base58 alphabet, and decoding them
--   yields exactly 32 bytes. That's what a Solana account is.
--
-- What this check can't do, and that's worth stating: it says nothing
-- about who owns an address. An address nobody holds the key to looks
-- computationally identical - money just never comes back out of it.
--
-- So for the treasury, once, before strangers pay into it: send 0.001 SOL,
-- open it in the wallet the seed belongs to, and send it back. Payments to
-- an address with no key are the one mistake in this project that can't be
-- undone.
-- ============================================================================

update public.app_config set
  -- Where verification payments go. This address sits on screen during
  -- sign-up; it's public, and it's meant to be.
  treasury      = 'DEINE_TREASURY_ADRESSE',

  -- Who the admin is. Everything only they're allowed to do hangs off
  -- this: creating and closing polls, seeing the inbox, hiding
  -- conversations, setting the DM threshold.
  --
  -- This is checked on EVERY request, in the database, against the
  -- token's wallet claim (app.is_admin()). There is no admin flag a
  -- client could set - this is the one and only place that decides who
  -- the admin is.
  admin_wallet  = 'ADMIN_ADRESSE',

  -- No second entry point anymore. During the closed phase a test wallet
  -- was allowed here; from launch onward it would be a second key to a
  -- door meant to have only one.
  test_wallet   = null,

  -- The threshold in dollars above which someone may DM the admin.
  min_dm_usd    = 1000,

  -- Open the door.
  open_to_public = true,

  updated_at    = now()
where id = 1;


-- ----------------------------------------------------------------------------
-- Verification
-- ----------------------------------------------------------------------------
-- Look at this, don't skim it. Above all the last four columns: they
-- compare what got entered against what's supposed to be there, and answer
-- yes or no instead of an address you'd read as correct just because it
-- looks like the right one.
--
-- Every address column checks TWO things, and the second is the reason
-- this query is worth anything at all:
--
--   1. Does it hold what was entered above? Catches typos and a half-run
--      update.
--   2. Does it even look like a Solana address? 32 to 44 characters from
--      the Base58 alphabet - which excludes 0, O, I and l.
--
-- Without point 2, the unedited template would have reported "true" here:
-- the placeholder above and the placeholder below are, after all, the
-- same. A check that goes green because nothing was actually done is
-- worse than no check at all.
select
  treasury,
  admin_wallet,
  test_wallet,
  min_dm_usd,
  open_to_public,
  symbol,
  base_lamports,
  coalesce(treasury = 'DEINE_TREASURY_ADRESSE'
    and treasury ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$', false)        as treasury_stimmt,
  coalesce(admin_wallet = 'ADMIN_ADRESSE'
    and admin_wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$', false)    as admin_stimmt,
  test_wallet is null                                             as kein_zweitzugang,
  coalesce(ansem_mint ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$', false)   as mint_gesetzt
from public.app_config
where id = 1;


-- ----------------------------------------------------------------------------
-- If something went wrong
-- ----------------------------------------------------------------------------
-- Close the door again, without touching anything else:
--
--   update public.app_config set open_to_public = false, updated_at = now()
--   where id = 1;
--
-- Whoever's already in stays in - the lock applies to new sign-ups (see
-- mayEnter in supabase/functions/_shared/freischaltung.ts). Whoever wants
-- to kick everyone out rotates APP_JWT_SECRET instead.
