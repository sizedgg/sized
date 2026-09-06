-- ============================================================================
-- Keine Links im öffentlichen Chat
--
-- Der Chat ist der Ort, an dem Betrüger ihre Phishing-Seiten und
-- Telegram-Gruppen streuen würden – vor Publikum, mit dem Anschein von
-- Zugehörigkeit. In DMs bleiben Links erlaubt: Dort ist genau eine Person
-- Empfänger, und das ist Ansem.
--
-- Der Test läuft über eine normalisierte Fassung des Textes, damit die
-- üblichen Verschleierungen nicht durchrutschen: "scam[.]com", "scam (dot) com",
-- "scam DOT com" landen alle bei "scam.com", bevor geprüft wird.
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

  -- Verschleierten Punkt zurückbauen: [.] (.) (dot) " dot "
  n := regexp_replace(n, '\s*(\[\s*\.\s*\]|\(\s*\.\s*\)|\(\s*dot\s*\)|\s+dot\s+)\s*', '.', 'g');
  -- Verschleierten Doppelpunkt: [:] (:)
  n := regexp_replace(n, '\s*(\[\s*:\s*\]|\(\s*:\s*\))\s*', ':', 'g');

  -- Ausgeschriebenes Protokoll
  if n ~ '(https?|ftp)\s*:\s*/\s*/' then
    return true;
  end if;

  -- www. am Wortanfang
  if n ~ '\ywww\.' then
    return true;
  end if;

  -- Domain mit gängiger Endung. Bewusst eine Liste statt "irgendwas nach dem
  -- Punkt": Sonst würden Beträge wie 1.25 und Sätze wie "z.b" mitgefangen.
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
-- In die Chat-Prüfung einhängen. Ansem darf Links posten – er ist der einzige,
-- dem die Runde ohnehin vertrauen muss.
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

  -- Nur die unmittelbar vorhergehende Nachricht derselben Wallet zählt,
  -- damit yes / no / yes möglich bleibt.
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
