-- ============================================================================
-- No links in the public chat
--
-- The chat is where scammers would scatter their phishing sites and
-- Telegram groups - in front of an audience, with the appearance of
-- belonging. Links stay allowed in DMs: there, exactly one person is the
-- recipient, and that's Ansem.
--
-- The check runs over a normalized version of the text, so the usual
-- obfuscations don't slip through: "scam[.]com", "scam (dot) com",
-- "scam DOT com" all end up as "scam.com" before checking.
-- ============================================================================

create or replace function app.contains_link(txt text)
returns boolean
language plpgsql
immutable
as $$
declare
  n text;
begin
  n := lower(coalesce(txt, ''));

  -- Undo an obfuscated dot: [.] (.) (dot) " dot "
  n := regexp_replace(n, '\s*(\[\s*\.\s*\]|\(\s*\.\s*\)|\(\s*dot\s*\)|\s+dot\s+)\s*', '.', 'g');
  -- Undo an obfuscated colon: [:] (:)
  n := regexp_replace(n, '\s*(\[\s*:\s*\]|\(\s*:\s*\))\s*', ':', 'g');

  -- Protocol spelled out
  if n ~ '(https?|ftp)\s*:\s*/\s*/' then
    return true;
  end if;

  -- www. at the start of a word
  if n ~ '\ywww\.' then
    return true;
  end if;

  -- Domain with a common TLD. Deliberately a fixed list instead of
  -- "anything after the dot": otherwise amounts like 1.25 and phrases like
  -- "z.b" would get caught too.
  if n ~ ('\y[a-z0-9][a-z0-9-]*\.('
          || 'com|net|org|io|xyz|gg|me|co|app|fun|club|link|to|sh|dev|ai|so|'
          || 'site|store|top|vip|cc|tv|info|biz|online|live|finance|fi|pro|'
          || 'wtf|lol|art|ru|cn|in|pump'
          || ')\y') then
    return true;
  end if;

  return false;
end;
$$;

comment on function app.contains_link(text) is
  'Erkennt Links inklusive der üblichen Verschleierungen. Nur für den Chat.';

-- ----------------------------------------------------------------------------
-- Hook into the chat check. Ansem is allowed to post links - he's the only
-- one the community has to trust anyway.
-- ----------------------------------------------------------------------------

create or replace function app.rate_limit_messages()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  per_minute int;
  per_hour   int;
  last_body  text;
begin
  if app.is_admin() then
    return new;
  end if;

  if app.contains_link(new.body) then
    raise exception 'Links are not allowed in chat - send it as a DM instead';
  end if;

  select
    count(*) filter (where created_at > now() - interval '1 minute'),
    count(*)
  into per_minute, per_hour
  from public.messages
  where wallet = new.wallet
    and created_at > now() - interval '1 hour';

  if per_minute >= 6 then
    raise exception 'Slow down - you can send 6 messages per minute';
  end if;
  if per_hour >= 120 then
    raise exception 'Message limit reached - try again later';
  end if;

  -- Only the immediately preceding message from the same wallet counts,
  -- so yes / no / yes stays possible.
  select regexp_replace(lower(btrim(body)), '\s+', ' ', 'g')
  into last_body
  from public.messages
  where wallet = new.wallet
    and created_at > now() - interval '1 hour'
  order by id desc
  limit 1;

  if last_body is not null
     and last_body = regexp_replace(lower(btrim(new.body)), '\s+', ' ', 'g') then
    raise exception 'You already said that';
  end if;

  return new;
end;
$$;
