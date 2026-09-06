-- ============================================================================
-- Kurs-Takt: alle Beträge einmal pro Minute, für alle gleichzeitig
--
-- Ziel ist, dass die $-Beträge neben den Namen im Chat nicht bei jedem
-- Besucher zu einem anderen Zeitpunkt springen, sondern bei allen im selben
-- Moment – und das einmal pro Minute.
--
-- Der naive Weg wäre, jede Minute jede Wallet neu von der Chain zu lesen. Das
-- ist ein RPC-Aufruf pro Wallet und Minute: bei tausend Wallets 1,4 Millionen
-- Aufrufe am Tag, für eine Zahl, die sich fast nie ändert.
--
-- Der Betrag besteht aus zwei Teilen, und die verhalten sich völlig
-- unterschiedlich:
--
--   Menge   ändert sich nur, wenn jemand Token bewegt. Das meldet der
--           Helius-Webhook innerhalb von Sekunden, und der Cron-Lauf für die
--           Mengen ist das Netz darunter.
--
--   Kurs    ändert sich dauernd, ist aber für alle Wallets derselbe.
--
-- Also wird einmal pro Minute genau ein Kurs geholt und in einer einzigen
-- Anweisung auf alle Wallets angewandt. Ein externer Aufruf statt tausend,
-- und weil es eine Anweisung ist, ändern sich alle Beträge im selben
-- Augenblick – genau das, was "bei allen gleichzeitig" heißt.
-- ============================================================================

-- Getrennt von updated_at, und das ist kein Schönheitsfehler: updated_at sagt,
-- wann die MENGE zuletzt von der Chain gelesen wurde, und genau daran hängt
-- wallets_to_refresh. Würde der Kurs-Takt updated_at anfassen, wäre jede
-- Wallet jede Minute frisch – und die Mengen würden nie wieder nachgelesen.
alter table public.wallets
  add column if not exists priced_at timestamptz;

comment on column public.wallets.priced_at is
  'Wann zuletzt ein neuer Kurs angewandt wurde. Nicht updated_at benutzen - das gilt der Menge.';

create or replace function public.apply_token_price(p_price numeric)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n integer;
begin
  -- Der Kursabruf gibt bei einem Fehlschlag 0 zurück. Diesen Wert
  -- durchzulassen wäre der teuerste Fehler, den diese Funktion machen kann:
  -- Jede Wallet stünde auf $0, der Chat-Filter zeigte niemanden mehr an, jede
  -- Schreibsperre griffe, und alle Stimmgewichte in laufenden Abstimmungen
  -- fielen auf null. Ein ausgefallener Kursabruf muss folgenlos bleiben – der
  -- letzte bekannte Kurs ist immer besser als ein erfundener.
  if p_price is null or p_price <= 0 then
    raise exception 'Refusing to apply a price of zero or less';
  end if;

  -- Nur, was sich tatsächlich ändert. Das hält nicht nur die Tabelle ruhig,
  -- sondern auch trg_wallets_sync_votes: Der Trigger hängt an usd_value und
  -- würde sonst für jede Wallet feuern, auch für die tausend, bei denen sich
  -- rechnerisch nichts ergibt.
  update public.wallets
     set usd_value = ui_amount * p_price,
         price     = p_price,
         priced_at = now()
   where usd_value is distinct from (ui_amount * p_price)::numeric(20, 4)
      or price     is distinct from p_price;

  get diagnostics n = row_count;
  return n;
end;
$$;

comment on function public.apply_token_price(numeric) is
  'Wendet einen Kurs auf alle Wallets an. Nur fuer den Kurs-Takt (Service-Role).';

-- Kein Client hat hier etwas zu suchen: Wer den Kurs setzen kann, setzt jedes
-- Stimmgewicht und jede Schreibsperre im Haus.
revoke all on function public.apply_token_price(numeric) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Mengen: mehr pro Lauf zulassen
-- ----------------------------------------------------------------------------
-- Bisher deckelte der Aufrufer auf 40 Wallets pro Lauf. Das reicht für den
-- gemächlichen Takt, aber nicht, um bei wachsender Nutzerzahl in einem Lauf
-- durchzukommen. Die Obergrenze steht jetzt in der Funktion selbst, damit ein
-- vertippter Aufruf nicht versehentlich die halbe Tabelle einliest.

create or replace function public.wallets_to_refresh(
  stale_seconds int default 120,
  max_rows int default 100,
  voters_only boolean default false
)
returns table (address text)
language sql
security definer
set search_path = public, pg_temp
as $$
  select w.address
  from public.wallets w
  where w.updated_at < now() - make_interval(secs => stale_seconds)
    and (
      not voters_only
      or exists (
        select 1
        from public.votes v
        join public.polls p on p.id = v.poll_id
        where v.wallet = w.address
          and not p.closed
          and (p.closes_at is null or p.closes_at > now())
      )
    )
  order by w.updated_at asc
  limit least(greatest(max_rows, 1), 500);
$$;

revoke all on function public.wallets_to_refresh(int, int, boolean) from public, anon, authenticated;
