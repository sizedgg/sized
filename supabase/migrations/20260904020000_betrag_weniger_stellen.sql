-- ============================================================================
-- The login amount needs fewer decimal places
-- ============================================================================
--
-- The finding, from production
--
-- The amount used to look like this:
--
--   0.002 SOL  +  1 to 99,999 lamports   ->   0.002043217 SOL
--
-- That's NINE decimal places. On Phantom on a phone that can't be typed in:
-- the input field accepts fewer digits, the last one gets dropped. Someone
-- trying to send 0.002043217 sends 0.00204321 instead - and that amount
-- doesn't match any challenge. The payment is gone, the login fails, and
-- the reason isn't visible from outside.
--
-- On a site whose only way in is a payment, that isn't a cosmetic flaw,
-- it's the door.
--
-- ----------------------------------------------------------------------------
-- Why the amount was that precise in the first place
--
-- Because of this index here:
--
--   create unique index uq_challenges_open_amount
--     on public.challenges (lamports) where status = 'pending';
--
-- It was justified with: "As long as a challenge is open, its amount must
-- be unique - otherwise a stranger's payment could get booked onto your
-- challenge." That called for many possible amounts, and many amounts
-- called for many digits.
--
-- But that reasoning no longer holds. The match in scanTreasury is:
--
--   .eq('status', 'pending')
--   .eq('wallet',   p.sender)      <-- the sender address from the chain
--   .eq('lamports', p.lamports)
--
-- So it's matched AGAINST THE SENDER ADDRESS, not just against the amount.
-- A stranger's payment can't land on someone else's challenge for that
-- reason alone: it would come from a different wallet. And getting your
-- own wallet paid by someone else isn't possible either - that would need
-- their private key.
--
-- So the amount only needs to be unique WITHIN a wallet. And there, at
-- most three challenges are open at once (app.limit_open_challenges from
-- 20260903020000). Three.
--
-- ----------------------------------------------------------------------------
-- What this changes
--
-- Instead of 100,000 amounts at lamport precision, a thousand in steps
-- of 1,000 lamports is enough:
--
--   0.002001 … 0.002999 SOL     ->  SIX decimal places
--
-- Every wallet app accepts six digits. The cost to the user stays
-- practically the same (around 0.0025 SOL), and the number is
-- noticeably easier to type as a bonus.
--
-- Side effect that matters more than it sounds: the old index was a
-- growth ceiling. At 900 simultaneously open logins and 100,000 amounts,
-- one attempt in twenty hit a collision; the function rerolls up to 20
-- times and then gives up. Counted per wallet, that ceiling is gone -
-- no matter how many people try to come in at once.
-- ============================================================================

drop index if exists public.uq_challenges_open_amount;

-- Unique per wallet, not globally. Exactly what the matching needs.
create unique index if not exists uq_challenges_open_amount_wallet
  on public.challenges (wallet, lamports) where status = 'pending';

comment on index public.uq_challenges_open_amount_wallet is
  'Eine Wallet kann nicht zwei offene Challenges mit demselben Betrag haben. '
  'Global muss der Betrag NICHT eindeutig sein: scanTreasury gleicht zusätzlich '
  'die Absenderadresse ab, und eine fremde Zahlung kommt aus einer fremden '
  'Wallet.';
