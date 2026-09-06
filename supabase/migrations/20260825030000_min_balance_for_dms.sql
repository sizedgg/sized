-- ============================================================================
-- Mindestbestand, um Ansem eine DM zu schreiben – von Ansem einstellbar
--
-- Der Chat hat bereits eine Schwelle (min_chat_usd). Für DMs gab es bisher
-- keine: Wer verifiziert war, durfte schreiben. Das ist der teurere Kanal –
-- eine DM landet nicht in einem Strom, den man überfliegt, sondern in einem
-- Posteingang, den eine einzelne Person abarbeitet. Genau deshalb ist er das
-- lohnendere Ziel für Spam.
--
-- Zwei Dinge unterscheiden diese Schwelle von der im Chat:
--
--   1. Sie hat einen eigenen Wert. Die beiden Kanäle haben unterschiedliche
--      Kosten, und Ansem soll den Posteingang zumachen können, ohne dabei
--      den Chat mit zu schließen.
--
--   2. Ansem kann sie im laufenden Betrieb ändern. Dafür gibt es unten eine
--      eng zugeschnittene Funktion statt eines Schreibrechts auf app_config.
--      Der Unterschied ist wesentlich: In derselben Zeile stehen treasury,
--      admin_wallet und ansem_mint. Ein allgemeines UPDATE-Recht auf diese
--      Zeile hieße, dass ein übernommener Admin-Token die Zahladresse
--      umbiegen kann. Die Funktion hier kann genau eine Spalte setzen.
-- ============================================================================

alter table public.app_config
  add column if not exists min_dm_usd numeric not null default 10;

comment on column public.app_config.min_dm_usd is
  'Mindestwert in USD an gehaltenen Token, um Ansem eine DM schreiben zu duerfen. 0 = aus.';

-- ----------------------------------------------------------------------------
-- Einstellen: nur diese eine Spalte, nur durch Ansem
-- ----------------------------------------------------------------------------
--
-- security definer, weil app_config für normale Rollen nicht schreibbar ist
-- und das auch so bleiben soll. Die Rechteprüfung passiert deshalb hier drin,
-- in der ersten Zeile, und stützt sich auf app.is_admin() – also auf die
-- Wallet aus dem Token, nicht auf irgendein mitgeschicktes Feld.
--
-- search_path ist fest gesetzt. Ohne das könnte ein Aufrufer mit eigenem
-- search_path eine gleichnamige Tabelle unterschieben und die Funktion damit
-- gegen etwas anderes laufen lassen, als hier steht.

create or replace function public.set_min_dm_usd(p_usd numeric)
returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v numeric;
begin
  if not app.is_admin() then
    raise exception 'Not allowed';
  end if;

  if p_usd is null or p_usd < 0 then
    raise exception 'Amount must be 0 or higher';
  end if;

  -- Obergrenze als Tippfehlerbremse: Eine versehentlich angehängte Null soll
  -- nicht den Posteingang für alle schließen, ohne dass es auffällt.
  if p_usd > 1000000 then
    raise exception 'Amount is too high';
  end if;

  v := round(p_usd, 2);

  update public.app_config
     set min_dm_usd = v,
         updated_at = now()
   where id = 1;

  return v;
end;
$$;

comment on function public.set_min_dm_usd(numeric) is
  'Setzt die DM-Schwelle. Nur fuer Ansem, aendert ausschliesslich min_dm_usd.';

-- Standardmäßig darf jede Rolle jede Funktion ausführen. Bei security definer
-- ist das die falsche Grundeinstellung, deshalb erst wegnehmen, dann gezielt
-- geben. anon bekommt sie nicht – wer nicht verifiziert ist, hat hier nichts
-- zu suchen, auch wenn die Prüfung ihn ohnehin abweisen würde.
revoke all on function public.set_min_dm_usd(numeric) from public;
grant execute on function public.set_min_dm_usd(numeric) to authenticated;

-- ----------------------------------------------------------------------------
-- Schwelle beim Einfügen durchsetzen
-- ----------------------------------------------------------------------------
-- Der Sperrbildschirm im Browser ist Höflichkeit, nicht Sicherheit: Er
-- erspart es, erst zu tippen und dann eine Fehlermeldung zu bekommen. Die
-- verbindliche Prüfung steht hier.
--
-- Wie im Chat wird der Absender aus dem Token genommen und nicht aus
-- new.wallet – siehe die ausführliche Begründung in
-- 20260825010000_min_balance_to_chat.sql. Antworten von Ansem (from_admin)
-- gehen weiterhin ungeprüft durch.
--
-- Die Taktgrenzen bleiben unverändert bei 5 pro Minute und 30 pro Stunde.

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
  -- Bewusst nur app.is_admin() und nicht mehr "new.from_admin or ...":
  -- from_admin kommt vom Client. Bisher war das ungefährlich, weil die
  -- RLS-Regel dms_insert_user eine fremde from_admin-Zeile am Ende ohnehin
  -- abweist – aber diese Prüfung hier hätte ein Angreifer damit übersprungen,
  -- und die Sperre hinge allein an der RLS-Regel. Ansem erkennt man am Token,
  -- nicht an einem Feld, das mitgeschickt wird.
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
        trim(to_char(cfg.min_dm_usd, 'FM999999990.99')),
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
