-- ============================================================================
-- Ansem does not vote in his own polls
--
-- He sets the question, he decides the options, and he closes the poll.
-- If he also votes, the result is no longer a result, but his opinion with
-- a number next to it - and with the heaviest weight in the room, because
-- weight tracks holdings.
--
-- This isn't a matter of courtesy. The polls are the one place where the
-- community decides something; whoever poses the question has to stay
-- outside it for the answer to be worth anything.
--
-- The check lives in the trigger, not in the RLS policy: guard_vote already
-- has the other conditions (poll open, option matches, weight > 0) and
-- reports them with readable text. A rejected RLS policy, by contrast,
-- only tells the user that something wasn't allowed.
-- ============================================================================

create or replace function app.guard_vote()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.polls%rowtype;
begin
  -- First, because it's the most fundamental of the conditions.
  --
  -- Deliberately app.is_admin() and not a comparison with new.wallet:
  -- is_admin() goes by the wallet in the token. Comparing against the
  -- submitted field could be worked around by putting something else
  -- there - the votes_insert RLS policy would still reject the row in
  -- the end, but then this block would depend on a different rule
  -- instead of standing on its own.
  if app.is_admin() then
    raise exception 'You cannot vote in your own polls';
  end if;

  select * into p from public.polls where id = new.poll_id;
  if not found then
    raise exception 'This poll does not exist';
  end if;
  if p.closed or (p.closes_at is not null and p.closes_at < now()) then
    raise exception 'This poll is closed';
  end if;
  if not exists (
    select 1 from public.poll_options
    where id = new.option_id and poll_id = new.poll_id
  ) then
    raise exception 'That option belongs to a different poll';
  end if;
  if new.weight_tokens <= 0 then
    raise exception 'No tokens, no voting weight';
  end if;
  return new;
end;
$$;

-- In case Ansem already voted while testing: remove those votes again.
-- Otherwise they'd keep counting in running polls, since the trigger only
-- fires on insert and update.
delete from public.votes v
 using public.app_config c
 where c.id = 1
   and c.admin_wallet is not null
   and v.wallet = c.admin_wallet;
