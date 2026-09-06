-- ============================================================================
-- Rate-Limits
--
-- RLS regelt, WAS jemand darf – nicht, WIE OFT. Eine verifizierte Wallet
-- könnte den Chat sonst mit einer Schleife fluten, und das kostet nicht nur
-- Nerven, sondern Egress und Realtime-Nachrichten.
--
-- Bewusst in der Datenbank und nicht im Frontend: Der Browser spricht direkt
-- mit PostgREST, ein Limit im JavaScript wäre eine Höflichkeitsbitte.
-- ============================================================================

-- Für die Zählfenster
create index if not exists idx_messages_wallet_time on public.messages (wallet, created_at desc);
create index if not exists idx_dms_wallet_time      on public.dms (wallet, created_at desc);

-- ----------------------------------------------------------------------------
-- Chat: 10 Nachrichten pro Minute, 120 pro Stunde. Ansem ist ausgenommen.
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

  if per_minute >= 10 then
    raise exception 'Slow down - you can send 10 messages per minute';
  end if;
  if per_hour >= 120 then
    raise exception 'Message limit reached - try again later';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_messages_rate_limit on public.messages;
create trigger trg_messages_rate_limit
  before insert on public.messages
  for each row execute function app.rate_limit_messages();

-- ----------------------------------------------------------------------------
-- DMs: 5 pro Minute, 30 pro Stunde – Ansems Posteingang soll lesbar bleiben.
-- Antworten von Ansem selbst sind ausgenommen.
-- ----------------------------------------------------------------------------

create or replace function app.rate_limit_dms()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  per_minute int;
  per_hour   int;
begin
  if new.from_admin or app.is_admin() then
    return new;
  end if;

  select
    count(*) filter (where created_at > now() - interval '1 minute'),
    count(*)
  into per_minute, per_hour
  from public.dms
  where wallet = new.wallet
    and not from_admin
    and created_at > now() - interval '1 hour';

  if per_minute >= 5 then
    raise exception 'Slow down - you can send 5 messages per minute';
  end if;
  if per_hour >= 30 then
    raise exception 'Message limit reached - try again later';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_dms_rate_limit on public.dms;
create trigger trg_dms_rate_limit
  before insert on public.dms
  for each row execute function app.rate_limit_dms();

-- ----------------------------------------------------------------------------
-- Login-Beträge gegen Erschöpfung schützen
--
-- Jeder offene Login belegt einen von rund 100.000 möglichen Beträgen. Wer
-- massenhaft Challenges für erfundene Adressen anlegt, könnte den Vorrat
-- leerräumen und damit alle Logins blockieren. Diese Funktion gibt der Edge
-- Function eine Bremse an die Hand: Wird es eng, wird der Andrang sichtbar.
-- ----------------------------------------------------------------------------

create or replace function public.pending_challenge_count()
returns integer
language sql
security definer
set search_path = public, pg_temp
as $$
  select count(*)::int from public.challenges
  where status = 'pending' and expires_at > now();
$$;

revoke all on function public.pending_challenge_count() from public, anon, authenticated;

-- Abgelaufene Challenges freigeben, damit ihr Betrag wieder nutzbar wird.
create or replace function public.expire_stale_challenges()
returns integer
language sql
security definer
set search_path = public, pg_temp
as $$
  with gone as (
    update public.challenges set status = 'expired'
    where status = 'pending' and expires_at < now()
    returning 1
  )
  select count(*)::int from gone;
$$;

revoke all on function public.expire_stale_challenges() from public, anon, authenticated;
