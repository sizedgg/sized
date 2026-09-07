-- ============================================================================
-- Two changes to the same check
--
--  1. The same message may again be sent twice in a row.
--  2. The rejections that are HOUSE RULES - a link in chat, typed too fast -
--     get a tag, so the page can tell them apart from real errors.
--
-- ----------------------------------------------------------------------------
-- On 1: Why the block is going back out
--
-- It was meant as spam protection and caught something normal along with
-- it. In a chat, people say things twice, and for good reasons: the first
-- message got lost in the flow, nobody answered, the question still
-- stands. "wen poll" again ten minutes later isn't spam, it's the usual way
-- to handle a live chat.
--
-- That it felt like a bug came down to the wording: "You already said
-- that" lectures. And the actual spam protection sits elsewhere anyway -
-- six messages per minute, 120 per hour, and a minimum holding that makes
-- joining the conversation cost money. Anyone who wants to spam through
-- that pays for it.
--
-- ----------------------------------------------------------------------------
-- On 2: Why a tag and not just text
--
-- The page should no longer show a red error message for these rejections,
-- but a calm hint next to the input: these are rules, not bugs. For that,
-- it needs to be able to tell them apart from real errors.
--
-- Two tags instead of one, because the page does different things with
-- them: for no_links it writes its own short sentence, for rate_limit it
-- shows the database's own message - it alone knows whether it was the
-- per-minute or the per-hour limit.
--
-- Why a LIST of allowed tags and not "anything with a hint is a rule":
-- Postgres itself attaches a hint to some of its own errors ("Perhaps you
-- meant to reference the column ..."). That would silently turn a real
-- error into a calm hint - exactly the kind of carelessness you only
-- notice once something is broken and nobody saw it happen.
--
-- The obvious approach would be to check the message text in the browser.
-- That breaks the first time the wording changes, and silently: the calm
-- hint would turn back into the red error without anything anywhere
-- turning red. That's why the tag travels along in "hint" instead - a
-- field PostgREST passes through unchanged and that has nothing to do with
-- the wording.
--
-- The error code deliberately stays P0001 (raise_exception). A dedicated
-- SQLSTATE would be more cleanly named, but PostgREST forwards codes it
-- doesn't know as 500 - a rule violation would turn into a server error.
-- ============================================================================

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
begin
  if app.is_admin() then
    return new;
  end if;

  -- Not new.wallet: triggers on the same table fire in alphabetical order,
  -- and the sender correction runs after this check.
  sender := coalesce(app.jwt_wallet(), new.wallet);

  select * into cfg from public.app_config where id = 1;

  -- ---- Minimum holdings ------------------------------------------------------
  if coalesce(cfg.min_chat_usd, 0) > 0 then
    select coalesce(w.usd_value, 0) into bal
    from public.wallets w
    where w.address = sender;

    if coalesce(bal, 0) < cfg.min_chat_usd then
      raise exception 'You need at least $% in $% to write here',
        app.betrag_text(cfg.min_chat_usd),
        coalesce(cfg.symbol, 'tokens');
    end if;
  end if;

  -- ---- No links ---------------------------------------------------------
  -- The text stays for anyone hitting the API directly. The page itself
  -- reads the tag.
  if app.contains_link(new.body) then
    raise exception 'Links are not allowed in chat - send it as a DM instead'
      using hint = 'no_links';
  end if;

  -- ---- Rate limit ------------------------------------------------------------
  select
    count(*) filter (where created_at > now() - interval '1 minute'),
    count(*)
  into per_minute, per_hour
  from public.messages
  where wallet = sender
    and created_at > now() - interval '1 hour';

  -- This too is a house rule, not a bug: the database's text moves
  -- unchanged into the hint box, because only it knows which of the two
  -- limits was hit.
  if per_minute >= 6 then
    raise exception 'Slow down - you can send 6 messages per minute'
      using hint = 'rate_limit';
  end if;
  if per_hour >= 120 then
    raise exception 'Message limit reached - try again later'
      using hint = 'rate_limit';
  end if;

  -- The block against sending the same message twice used to stand here.
  -- See above.

  return new;
end;
$$;

comment on function app.rate_limit_messages() is
  'Chatregeln vor dem Einfügen: Mindestbestand, keine Links (hint=no_links), '
  'Takt (hint=rate_limit). Doppelte Nachrichten sind erlaubt.';
