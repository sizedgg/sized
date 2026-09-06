-- ============================================================================
-- Mindestbestand zum Schreiben im Chat
--
-- Wer mitreden will, muss mindestens einen bestimmten Gegenwert in Token
-- halten. Lesen bleibt für alle Verifizierten frei – es geht nicht darum,
-- Leute auszusperren, sondern darum, dass eine Wegwerf-Wallet nichts kostet
-- und deshalb der billigste Weg zum Spam wäre.
--
-- Der Betrag steht in app_config und nicht im Code: Ansem soll ihn ändern
-- können, ohne dass jemand etwas neu ausrollt.
--
-- ----------------------------------------------------------------------------
-- Dabei wird eine Lücke geschlossen, die vorher schon offen war
-- ----------------------------------------------------------------------------
--
-- Mehrere BEFORE-INSERT-Trigger auf derselben Tabelle feuern in alphabetischer
-- Reihenfolge ihres Namens. Auf public.messages heißt das:
--
--     trg_messages_rate_limit   <- prüft
--     trg_messages_sender       <- setzt new.wallet auf die Wallet aus dem Token
--     trg_messages_stamp        <- schreibt Bestand und USD-Wert fest
--
-- Die Prüfung lief also VOR der Korrektur der Absenderadresse. Bis dahin stand
-- in new.wallet noch genau das, was der Client geschickt hat. Wer beim
-- Einfügen eine fremde Adresse einträgt, wurde folglich gegen deren Zähler
-- geprüft – der eigene blieb bei null. Damit ließen sich das Limit von sechs
-- Nachrichten pro Minute und die Wiederholungssperre vollständig umgehen,
-- einfach durch Variieren eines Feldes. Die Nachricht selbst wurde danach von
-- force_sender korrekt zugeordnet, der Missbrauch blieb also unsichtbar.
--
-- Die RLS-Regel fängt das nicht ab: Sie prüft die Zeile, nachdem alle
-- BEFORE-Trigger gelaufen sind – zu diesem Zeitpunkt stimmt die Adresse wieder.
--
-- Ab hier stützt sich die Prüfung nicht mehr auf new.wallet, sondern auf die
-- Wallet aus dem Token. Die ist nicht manipulierbar und von der
-- Trigger-Reihenfolge unabhängig.
-- ============================================================================

alter table public.app_config
  add column if not exists min_chat_usd numeric not null default 10;

comment on column public.app_config.min_chat_usd is
  'Mindestwert in USD an gehaltenen Token, um im Chat schreiben zu dürfen. 0 = aus.';

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
  last_body  text;
begin
  if app.is_admin() then
    return new;
  end if;

  -- Nicht new.wallet: siehe Kopf dieser Datei.
  sender := coalesce(app.jwt_wallet(), new.wallet);

  select * into cfg from public.app_config where id = 1;

  -- ---- Mindestbestand ------------------------------------------------------
  if coalesce(cfg.min_chat_usd, 0) > 0 then
    select coalesce(w.usd_value, 0) into bal
    from public.wallets w
    where w.address = sender;

    if coalesce(bal, 0) < cfg.min_chat_usd then
      raise exception 'You need at least $% in $% to write here',
        trim(to_char(cfg.min_chat_usd, 'FM999999990.99')),
        coalesce(cfg.symbol, 'tokens');
    end if;
  end if;

  -- ---- Keine Links ---------------------------------------------------------
  if app.contains_link(new.body) then
    raise exception 'Links are not allowed in chat - send it as a DM instead';
  end if;

  -- ---- Takt ----------------------------------------------------------------
  select
    count(*) filter (where created_at > now() - interval '1 minute'),
    count(*)
  into per_minute, per_hour
  from public.messages
  where wallet = sender
    and created_at > now() - interval '1 hour';

  if per_minute >= 6 then
    raise exception 'Slow down - you can send 6 messages per minute';
  end if;
  if per_hour >= 120 then
    raise exception 'Message limit reached - try again later';
  end if;

  -- ---- Keine zweimal identische Nachricht hintereinander --------------------
  -- Nur die unmittelbar vorhergehende Nachricht derselben Wallet zählt, damit
  -- yes / no / yes möglich bleibt.
  select regexp_replace(lower(btrim(body)), '\s+', ' ', 'g')
  into last_body
  from public.messages
  where wallet = sender
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

-- ----------------------------------------------------------------------------
-- Dieselbe Lücke bei den DMs schließen
-- ----------------------------------------------------------------------------
-- Für DMs gilt kein Mindestbestand – wer verifiziert ist, darf Ansem
-- schreiben. Die Absenderprüfung muss aber aus demselben Grund vom Token
-- ausgehen und nicht vom eingesendeten Feld.

create or replace function app.rate_limit_dms()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  sender     text;
  per_minute int;
  per_hour   int;
begin
  if new.from_admin or app.is_admin() then
    return new;
  end if;

  sender := coalesce(app.jwt_wallet(), new.wallet);

  select
    count(*) filter (where created_at > now() - interval '1 minute'),
    count(*)
  into per_minute, per_hour
  from public.dms
  where wallet = sender
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
