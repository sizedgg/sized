-- ============================================================================
-- A vote may only change its ANSWER - nothing else
--
-- ----------------------------------------------------------------------------
-- The hole this closes
--
-- votes.weight_usd is the number the whole poll rests on: poll_results sums
-- exactly this column, and from that come the bars in the UI and the card
-- that goes out to X.
--
-- So far it was written by app.stamp_holdings() - from `wallets`, never from
-- the client. But the trigger was attached to
--
--     before insert or update OF option_id on public.votes
--
-- and the same held for app.guard_vote(). But a user has
--
--     grant update on public.votes to authenticated
--
-- on ALL columns, and the votes_update policy lets them touch their own row.
-- Whoever leaves option_id alone and writes only weight_usd triggers neither
-- of the two triggers.
--
-- Measured against a real Postgres 16 with exactly these migrations, as a
-- logged-in user with a set JWT claim:
--
--   wallet with 7,739 tokens / $32.50 votes normally  -> weight_usd  32.5000
--   same wallet: update votes set weight_usd = 99999999
--                                                      -> weight_usd  99999999
--   poll_results then reports                          -> usd         99999999
--
-- A single PATCH over PostgREST, with the public anon key and one's own
-- session. No second wallet, no coins, no time window.
--
-- Two neighboring cases, also measured:
--
--   * It also works on a CLOSED poll. A result treated as final could be
--     rewritten after the fact.
--   * poll_id could be changed without touching option_id. The vote then
--     hung off poll 2 with an answer that belongs to poll 1.
--
-- What did NOT work, and this is the check that the rules hold at all: a
-- foreign wallet couldn't touch the row - votes_update filters it out via
-- using (wallet = app.jwt_wallet()).
--
-- ----------------------------------------------------------------------------
-- Why it doesn't heal itself
--
-- app.sync_votes_with_balance() rewrites open votes - but only when the
-- wallet's BALANCE changes (after update of ui_amount, usd_value ... when old
-- is distinct from new). Whoever moves nothing after faking it keeps their
-- number. For closed polls the function never fires at all - there it would
-- have stayed forever.
--
-- ----------------------------------------------------------------------------
-- Why the fix looks like this and not otherwise
--
-- The first idea was to narrow the grant to a single column:
--
--     revoke update on public.votes from authenticated;
--     grant update (option_id) on public.votes to authenticated;
--
-- That's the sharpest version, and it still doesn't work here: the app votes
-- via upsert with onConflict 'poll_id,wallet'. Postgres turns that into
-- "on conflict do update set poll_id = ..., option_id = ..., wallet = ..."
-- and demands the right to all three columns. With the narrow grant, no one
-- could change their vote anymore.
--
-- So the other way around: the grants stay, and the database enforces the
-- rule. This also fits the rest better - the promise isn't "whoever takes
-- the intended path gets the right weight", it's "the weight comes from
-- `wallets`, no matter which path someone takes to get there".
--
-- Two parts:
--
--   1. app.stamp_holdings() now hangs off EVERY update, not just the one on
--      option_id. That means weight_tokens/weight_usd get re-fetched from
--      `wallets` on every change - a value sent along gets overwritten, not
--      rejected. Rejecting would be worse here: a PostgREST client sends
--      whole rows on an upsert, and the error would also hit the honest
--      case.
--
--   2. app.guard_vote_update() rejects what would stay wrong even after
--      re-stamping: a row moving to another poll or another wallet - and ANY
--      change to a row in a closed poll.
--
-- The second point is why re-stamping alone isn't enough. On a closed poll,
-- re-stamping would leave TODAY's balance in the row, not the one from back
-- then. "Friday's result" would turn into "the result if you compute it
-- again today" - quieter than the forgery, but the same kind of bug.
--
-- ----------------------------------------------------------------------------
-- What is NOT affected
--
-- app.sync_votes_with_balance() doesn't touch closed polls
-- (and not p.closed and (p.closes_at is null or p.closes_at > now())). So the
-- new lock can't get in its way. On open polls it writes exactly the values
-- that stamp_holdings then reads back from the same row a moment later - the
-- result is the same.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The weight gets re-stamped on EVERY change
-- ----------------------------------------------------------------------------
-- Only the trigger's reach changes, the function stays as it is. It already
-- reads from `wallets` and ignores whatever the client sent along.
drop trigger if exists trg_votes_stamp on public.votes;
create trigger trg_votes_stamp
  before insert or update on public.votes
  for each row execute function app.stamp_holdings();

-- ----------------------------------------------------------------------------
-- 2. What would stay wrong even after re-stamping
-- ----------------------------------------------------------------------------
create or replace function app.guard_vote_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.polls%rowtype;
begin
  -- A vote belongs to ONE poll and to ONE wallet. Both are fixed at the
  -- moment it's cast. If the row moves, it ends up attached to an answer
  -- that belongs to a different poll - and the unique key (poll_id, wallet)
  -- doesn't catch that, because it only prevents duplicates, not moves.
  if new.poll_id is distinct from old.poll_id then
    raise exception 'A vote cannot be moved to another poll';
  end if;
  if new.wallet is distinct from old.wallet then
    raise exception 'A vote cannot be moved to another wallet';
  end if;

  -- A closed poll is closed - for its rows too.
  --
  -- app.guard_vote() says the same thing, but only on a change of answer.
  -- Here it's about every change: without this branch, stamp_holdings above
  -- would dutifully write in today's balance and thereby shift a finalized
  -- result after the fact.
  select * into p from public.polls where id = old.poll_id;
  if p.closed or (p.closes_at is not null and p.closes_at < now()) then
    raise exception 'This poll is closed';
  end if;

  return new;
end;
$$;

-- The name sorts before trg_votes_stamp: at the same trigger timing, Postgres
-- runs triggers in name order, and a rejection should come before anything
-- gets stamped. For the outcome it makes no difference - the transaction
-- aborts either way - but in a log the order would otherwise read backwards.
drop trigger if exists trg_votes_freeze on public.votes;
create trigger trg_votes_freeze
  before update on public.votes
  for each row execute function app.guard_vote_update();

do $$
begin
  raise notice 'votes: Gewicht wird bei jeder Aenderung neu aus wallets gestempelt; Umhaengen und Aendern geschlossener Abstimmungen sind gesperrt.';
end $$;
