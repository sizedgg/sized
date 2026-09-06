-- ============================================================================
-- Chat-Regeln nachgeschärft
--
--  * 6 Nachrichten pro Minute statt 10
--  * keine zweimal hintereinander identische Nachricht derselben Wallet
--
-- Zur Wiederholungssperre: Verglichen wird normalisiert – Groß- und
-- Kleinschreibung, führende und mehrfache Leerzeichen zählen nicht. Sonst
-- ließe sich die Sperre mit einem angehängten Leerzeichen aushebeln.
--
-- Und sie gilt nur eine Stunde zurück. Ohne dieses Fenster wäre "gm" nach dem
-- ersten Mal für immer gesperrt, solange dazwischen nichts anderes kommt – in
-- einem Krypto-Chat wäre das die falsche Sorte Streng.
-- ============================================================================

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

  -- Die zuletzt gesendete Nachricht dieser Wallet innerhalb der letzten Stunde
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
