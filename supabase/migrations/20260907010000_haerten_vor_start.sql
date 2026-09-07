-- ============================================================================
-- Hardening five spots before the site opens
-- ============================================================================
--
-- Four holes and one cleanup. None of these were caught by any of the 22
-- test suites, and that's the real finding: they check whether the rules
-- do what they're supposed to. These were rules that simply didn't exist.
--
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. created_at belongs to the database, not the client
-- ----------------------------------------------------------------------------
--
-- messages.created_at, dms.created_at and votes.created_at have a default
-- of now(). But a default only applies if the client LEAVES OUT the column.
-- If it sends one, that value is used - and it's allowed to, because
--
--   grant insert on public.messages, public.votes, public.dms to authenticated
--
-- has no column list, and PostgREST accepts any column it holds a grant
-- for.
--
-- Both spam locks count by time:
--
--   where wallet = ... and created_at > now() - interval '1 minute'
--
-- So anyone who sends created_at: '1990-01-01' falls outside every window.
-- Five messages per minute and thirty per hour then apply to everyone
-- except the one person deliberately gaming it. Exactly backwards.
--
-- The trigger overwrites unconditionally. Not "if null, then now()" - that
-- could still be bypassed by sending a value.
--
-- BEFORE INSERT, not BEFORE UPDATE: there's no later changing of
-- created_at, because no policy permits an UPDATE on these columns.
create or replace function app.stempel_created_at()
returns trigger
language plpgsql
as $$
begin
  new.created_at := now();
  return new;
end;
$$;

comment on function app.stempel_created_at() is
  'Setzt created_at auf die Serverzeit. Ohne das ist jede zeitbasierte '
  'Zählung wirkungslos, weil PostgREST die Spalte vom Client annimmt.';

drop trigger if exists trg_messages_created_at on public.messages;
create trigger trg_messages_created_at
  before insert on public.messages
  for each row execute function app.stempel_created_at();

drop trigger if exists trg_dms_created_at on public.dms;
create trigger trg_dms_created_at
  before insert on public.dms
  for each row execute function app.stempel_created_at();

drop trigger if exists trg_votes_created_at on public.votes;
create trigger trg_votes_created_at
  before insert on public.votes
  for each row execute function app.stempel_created_at();


-- ----------------------------------------------------------------------------
-- 2. Expired challenges can't be allowed to occupy their amount forever
-- ----------------------------------------------------------------------------
--
-- The index was
--
--   unique (wallet, lamports) where status = 'pending'
--
-- with no regard for expires_at. And expire_stale_challenges() does exist,
-- but no cron job calls it - so expired challenges just stay 'pending' and
-- hold their amount forever.
--
-- Since amounts got six decimal places instead of nine, there are exactly
-- 999 possible surcharges per wallet, and createChallenge gives up after 20
-- rolls.
--
-- The attack picture: someone keeps opening challenges against a FOREIGN
-- address - three at a time are allowed, they expire after 25 minutes and
-- are left lying around. After roughly 333 rounds, so a good six days with
-- zero effort, all 999 amounts for that address are occupied. The rightful
-- owner then only ever gets "No free verification amount right now",
-- permanently, because nothing cleans up.
--
-- Applied to admin_wallet that means: Ansem can no longer get in.
--
-- So the index gets the expiry added to it. That's better than a fourth
-- cron job: a job can fail to run, an index condition can't.
--
-- Partial index with now(): Postgres actually requires immutable
-- expressions for an index's WHERE condition. now() is stable, not
-- immutable - so going through the column itself doesn't work. Instead the
-- index stays as it is, and the condition moves into the trigger that
-- already counts anyway: on insert, that wallet's expired rows get cleared
-- out first.
create or replace function app.raeume_abgelaufene_challenges()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Only this wallet, not the whole table: that keeps the write footprint
  -- small and stops the cleanup from turning into a lock for everyone else.
  update public.challenges
     set status = 'expired'
   where wallet = new.wallet
     and status = 'pending'
     and expires_at <= now();
  return new;
end;
$$;

comment on function app.raeume_abgelaufene_challenges() is
  'Setzt abgelaufene offene Challenges derselben Wallet auf expired, bevor '
  'eine neue entsteht. Ohne das belegen sie ihren Betrag dauerhaft und eine '
  'Adresse laesst sich fremdaussperren.';

-- Before the counting trigger, so it no longer counts the rows just
-- cleaned up. Postgres runs triggers of the same kind alphabetically,
-- hence the "a_" at the front of the name.
drop trigger if exists trg_a_challenges_aufraeumen on public.challenges;
create trigger trg_a_challenges_aufraeumen
  before insert on public.challenges
  for each row execute function app.raeume_abgelaufene_challenges();


-- ----------------------------------------------------------------------------
-- 3. Reading requires proof of payment, not just any token
-- ----------------------------------------------------------------------------
--
-- Six policies read
--
--   for select to authenticated using (true)
--
-- All that checked was that SOME token accepted by Supabase was present -
-- not that it came from verify.
--
-- That's dangerous, because Supabase brings its own login paths along. If
-- "Anonymous sign-ins" or email signup is enabled in the dashboard, anyone
-- can grab a token with role: authenticated using two lines of
-- supabase-js, with no wallet claim and without paying a cent - and read
-- the entire wallets table, balances included.
--
-- The auth providers belong turned off, that's on the launch checklist.
-- But a payment gate that hinges on a checkbox in a dashboard isn't one.
-- So here's the extra condition that only a token from verify satisfies.
--
-- DMs were never affected - they've always checked wallet = jwt_wallet().
drop policy if exists wallets_read on public.wallets;
create policy wallets_read on public.wallets
  for select to authenticated using (app.jwt_wallet() is not null);

drop policy if exists messages_read on public.messages;
create policy messages_read on public.messages
  for select to authenticated using (app.jwt_wallet() is not null);

drop policy if exists polls_read on public.polls;
create policy polls_read on public.polls
  for select to authenticated using (app.jwt_wallet() is not null);

drop policy if exists options_read on public.poll_options;
create policy options_read on public.poll_options
  for select to authenticated using (app.jwt_wallet() is not null);

drop policy if exists votes_read on public.votes;
create policy votes_read on public.votes
  for select to authenticated using (app.jwt_wallet() is not null);

drop policy if exists poll_totals_read on public.poll_totals;
create policy poll_totals_read on public.poll_totals
  for select to authenticated using (app.jwt_wallet() is not null);


-- ----------------------------------------------------------------------------
-- 4. Chat is gone - the write grants go with it
-- ----------------------------------------------------------------------------
--
-- The messages table stays in place, rules and content included: the step
-- is reversible, and test-schema.mjs keeps checking it. What can't stay in
-- place are the grants.
--
-- Until now, any verified holder with $10 in balance could write to a
-- table nobody looks at anymore, without limit - and every row also went
-- out as a realtime event to everyone subscribed to the channel. An
-- attacker can subscribe to it himself and turn a single insert into as
-- many deliveries as he likes. Costs storage, egress and quota, and none
-- of it shows up anywhere.
--
-- Unlike votes and dms, messages was never removed from the realtime
-- publication. This catches that up.
revoke insert, delete on public.messages from authenticated;

drop policy if exists messages_insert on public.messages;
drop policy if exists messages_admin_delete on public.messages;

do $$
begin
  alter publication supabase_realtime drop table public.messages;
exception
  when undefined_object then null;   -- was never in it
  when others then null;             -- publication isn't ours (local)
end $$;


-- ----------------------------------------------------------------------------
-- 5. read_by_admin belongs to the server
-- ----------------------------------------------------------------------------
--
-- guard_dm only sets read_by_admin for rows from Ansem. For user rows the
-- field went unchecked, and the insert policy doesn't constrain it: a user
-- could submit their own DM with read_by_admin: true. It then shows up in
-- the thread, but never in the unread counter.
--
-- No data leak here - but a counter you can't trust is worse than none at
-- all. Ansem decides who he replies to based on it.
create or replace function app.stempel_read_by_admin()
returns trigger
language plpgsql
as $$
begin
  -- Written by Ansem means read; written by a user means unread. The
  -- server decides both, not the sender.
  new.read_by_admin := coalesce(new.from_admin, false);
  return new;
end;
$$;

comment on function app.stempel_read_by_admin() is
  'read_by_admin folgt aus from_admin und wird nie vom Client uebernommen.';

drop trigger if exists trg_dms_read_by_admin on public.dms;
create trigger trg_dms_read_by_admin
  before insert on public.dms
  for each row execute function app.stempel_read_by_admin();
