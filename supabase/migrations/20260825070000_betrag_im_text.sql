-- ============================================================================
-- Der Betrag in den Sperrmeldungen hatte einen Punkt zu viel
--
-- Beide Meldungen bauten den Betrag mit to_char(x, 'FM999999990.99'). Das FM
-- entfernt zwar die überflüssigen Nullen, aber nicht den Dezimalpunkt davor.
-- Bei einer glatten Schwelle stand deshalb:
--
--     You need at least $10. in $ANSEM to message Ansem
--
-- Ein Punkt mitten im Satz, direkt hinter der Zahl. Das liest sich wie ein
-- abgeschnittener Betrag – man fragt sich, ob da noch Nachkommastellen
-- fehlen. Bei 10.50 fiel es nicht auf, deshalb ist es lange durchgerutscht.
--
-- app.betrag_text() macht daraus eine Stelle, an der sich das reparieren
-- lässt, statt die Formatierung an zwei Orten zu pflegen.
-- ============================================================================

create or replace function app.betrag_text(v numeric)
returns text
language sql
immutable
as $$
  select trim(trailing '.' from trim(to_char(coalesce(v, 0), 'FM999999990.99')));
$$;

comment on function app.betrag_text(numeric) is
  'Betrag fuer Meldungen: 10 -> "10", 10.5 -> "10.5", 1000 -> "1000".';

-- ----------------------------------------------------------------------------
-- Chat
-- ----------------------------------------------------------------------------
-- Unverändert bis auf die Zeile mit der Meldung. Die Begründungen zur
-- Absenderprüfung stehen im Kopf von 20260825010000_min_balance_to_chat.sql.

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

  -- Nicht new.wallet: Trigger auf derselben Tabelle feuern in alphabetischer
  -- Reihenfolge, und die Absenderkorrektur läuft nach dieser Prüfung.
  sender := coalesce(app.jwt_wallet(), new.wallet);

  select * into cfg from public.app_config where id = 1;

  -- ---- Mindestbestand ------------------------------------------------------
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
-- DMs
-- ----------------------------------------------------------------------------
-- Ebenfalls unverändert bis auf die Meldung. Warum hier app.is_admin() steht
-- und nicht new.from_admin, erklärt der Kopf von
-- 20260825030000_min_balance_for_dms.sql.

create or replace function app.rate_limit_dms()
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

  sender := coalesce(app.jwt_wallet(), new.wallet);

  select * into cfg from public.app_config where id = 1;

  -- ---- Mindestbestand ------------------------------------------------------
  if coalesce(cfg.min_dm_usd, 0) > 0 then
    select coalesce(w.usd_value, 0) into bal
    from public.wallets w
    where w.address = sender;

    if coalesce(bal, 0) < cfg.min_dm_usd then
      raise exception 'You need at least $% in $% to message Ansem',
        app.betrag_text(cfg.min_dm_usd),
        coalesce(cfg.symbol, 'tokens');
    end if;
  end if;

  -- ---- Takt ----------------------------------------------------------------
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
