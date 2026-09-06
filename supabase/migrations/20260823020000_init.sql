-- ============================================================================
-- SIZED – Schema, RLS und Trigger
--
-- Grundprinzip: Der Browser spricht nach dem Login direkt mit PostgREST. Alles,
-- was ein Nutzer fälschen könnte – sein Token-Bestand, sein Stimmgewicht, die
-- Absender-Wallet – wird deshalb NICHT vom Client übernommen, sondern hier in
-- der Datenbank aus der Tabelle `wallets` gesetzt. Und die schreibt nur die
-- Edge Function mit dem Service-Role-Key.
--
-- Die Wallet des Aufrufers kommt aus dem JWT-Claim "wallet", das die
-- verify-Function nach bestätigter Zahlung ausstellt.
-- ============================================================================

create extension if not exists pgcrypto;

create schema if not exists app;

-- ----------------------------------------------------------------------------
-- Hilfsfunktionen rund um das JWT
-- ----------------------------------------------------------------------------

create or replace function app.jwt_wallet()
returns text
language sql
stable
as $$
  select nullif(
    coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'wallet', ''),
    ''
  );
$$;

comment on function app.jwt_wallet() is
  'Verifizierte Wallet-Adresse des Aufrufers aus dem JWT-Claim "wallet".';

-- ----------------------------------------------------------------------------
-- Konfiguration (eine Zeile). Nur Service-Role darf schreiben.
-- ----------------------------------------------------------------------------

create table if not exists public.app_config (
  id            smallint primary key default 1 check (id = 1),
  admin_wallet  text,
  treasury      text,
  ansem_mint    text,
  symbol        text not null default 'ANSEM',
  base_lamports bigint not null default 2000000,
  updated_at    timestamptz not null default now()
);

insert into public.app_config (id) values (1) on conflict do nothing;

create or replace function app.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    app.jwt_wallet() is not null
      and app.jwt_wallet() = (select admin_wallet from public.app_config where id = 1),
    false
  );
$$;

comment on function app.is_admin() is
  'True, wenn der Aufrufer mit Ansems konfigurierter Admin-Wallet verifiziert ist.';

-- ----------------------------------------------------------------------------
-- Wallets: Token-Bestand und $-Wert. Einzige vertrauenswürdige Quelle.
-- ----------------------------------------------------------------------------

create table if not exists public.wallets (
  address     text primary key,
  ui_amount   numeric(38, 9) not null default 0,
  usd_value   numeric(20, 4) not null default 0,
  price       numeric(30, 18) not null default 0,
  updated_at  timestamptz not null default now(),
  first_seen  timestamptz not null default now()
);

create index if not exists idx_wallets_usd on public.wallets (usd_value desc);

-- ----------------------------------------------------------------------------
-- Verifikation per Zahlung
--
-- Für Clients unsichtbar (keine Policy, kein Grant): Ausstellen und Einlösen
-- macht ausschließlich die Edge Function mit dem Service-Role-Key.
-- ----------------------------------------------------------------------------

create table if not exists public.challenges (
  id          uuid primary key default gen_random_uuid(),
  wallet      text not null,
  lamports    bigint not null,
  status      text not null default 'pending'
              check (status in ('pending', 'paid', 'used', 'expired')),
  tx_sig      text unique,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);

-- Solange eine Challenge offen ist, muss ihr Betrag eindeutig sein – sonst
-- ließe sich eine fremde Zahlung auf die eigene Challenge buchen.
create unique index if not exists uq_challenges_open_amount
  on public.challenges (lamports) where status = 'pending';

create index if not exists idx_challenges_wallet on public.challenges (wallet, status);

-- Jede an der Treasury gesehene Zahlung, damit keine Signatur zweimal eine
-- Verifikation auslösen kann.
create table if not exists public.seen_txs (
  signature  text primary key,
  slot       bigint,
  sender     text,
  lamports   bigint,
  seen_at    timestamptz not null default now()
);

alter table public.challenges enable row level security;
alter table public.seen_txs   enable row level security;

-- ----------------------------------------------------------------------------
-- Chat
-- ----------------------------------------------------------------------------

create table if not exists public.messages (
  id          bigint generated always as identity primary key,
  wallet      text not null,
  body        text not null check (length(btrim(body)) between 1 and 500),
  snap_tokens numeric(38, 9) not null default 0,
  snap_usd    numeric(20, 4) not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists idx_messages_feed on public.messages (id desc);
create index if not exists idx_messages_usd  on public.messages (snap_usd desc, id desc);

-- ----------------------------------------------------------------------------
-- Abstimmungen
-- ----------------------------------------------------------------------------

create table if not exists public.polls (
  id         bigint generated always as identity primary key,
  question   text not null check (length(btrim(question)) between 1 and 300),
  created_at timestamptz not null default now(),
  closes_at  timestamptz,
  closed     boolean not null default false
);

create table if not exists public.poll_options (
  id      bigint generated always as identity primary key,
  poll_id bigint not null references public.polls (id) on delete cascade,
  label   text not null check (length(btrim(label)) between 1 and 120),
  idx     smallint not null default 0
);

create index if not exists idx_poll_options_poll on public.poll_options (poll_id, idx);

create table if not exists public.votes (
  id            bigint generated always as identity primary key,
  poll_id       bigint not null references public.polls (id) on delete cascade,
  option_id     bigint not null references public.poll_options (id) on delete cascade,
  wallet        text not null,
  weight_tokens numeric(38, 9) not null default 0,
  weight_usd    numeric(20, 4) not null default 0,
  created_at    timestamptz not null default now(),
  unique (poll_id, wallet)
);

create index if not exists idx_votes_poll   on public.votes (poll_id);
create index if not exists idx_votes_wallet on public.votes (wallet);

-- ----------------------------------------------------------------------------
-- DMs an Ansem
-- ----------------------------------------------------------------------------

create table if not exists public.dms (
  id            bigint generated always as identity primary key,
  wallet        text not null,               -- Thread-Eigentümer, nie Ansem
  from_admin    boolean not null default false,
  body          text not null check (length(btrim(body)) between 1 and 2000),
  snap_tokens   numeric(38, 9) not null default 0,
  snap_usd      numeric(20, 4) not null default 0,
  read_by_admin boolean not null default false,
  created_at    timestamptz not null default now()
);

create index if not exists idx_dms_thread on public.dms (wallet, id);

-- ============================================================================
-- Trigger: Bestand und Gewicht kommen aus `wallets`, nie vom Client
-- ============================================================================

create or replace function app.stamp_holdings()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  w public.wallets%rowtype;
begin
  select * into w from public.wallets where address = new.wallet;

  if tg_table_name = 'votes' then
    new.weight_tokens := coalesce(w.ui_amount, 0);
    new.weight_usd    := coalesce(w.usd_value, 0);
  else
    new.snap_tokens := coalesce(w.ui_amount, 0);
    new.snap_usd    := coalesce(w.usd_value, 0);
  end if;

  return new;
end;
$$;

create or replace trigger trg_messages_stamp
  before insert on public.messages
  for each row execute function app.stamp_holdings();

create or replace trigger trg_dms_stamp
  before insert on public.dms
  for each row execute function app.stamp_holdings();

create or replace trigger trg_votes_stamp
  before insert or update of option_id on public.votes
  for each row execute function app.stamp_holdings();

-- Absender erzwingen: die Wallet einer Nachricht ist immer die JWT-Wallet.
create or replace function app.force_sender()
returns trigger
language plpgsql
as $$
begin
  if app.jwt_wallet() is not null then
    new.wallet := app.jwt_wallet();
  end if;
  return new;
end;
$$;

create or replace trigger trg_messages_sender
  before insert on public.messages
  for each row execute function app.force_sender();

-- Keine Stimmen auf beendete Abstimmungen, Option muss zur Abstimmung gehören.
-- Meldungen auf Englisch: Sie landen als Toast in der Oberfläche.
create or replace function app.guard_vote()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.polls%rowtype;
begin
  select * into p from public.polls where id = new.poll_id;
  if not found then
    raise exception 'This poll does not exist';
  end if;
  if p.closed or (p.closes_at is not null and p.closes_at < now()) then
    raise exception 'This poll is closed';
  end if;
  if not exists (
    select 1 from public.poll_options
    where id = new.option_id and poll_id = new.poll_id
  ) then
    raise exception 'That option belongs to a different poll';
  end if;
  if new.weight_tokens <= 0 then
    raise exception 'No tokens, no voting weight';
  end if;
  return new;
end;
$$;

create or replace trigger trg_votes_guard
  after insert or update of option_id on public.votes
  for each row execute function app.guard_vote();

-- Ansem antwortet immer in einen bestehenden Thread, nie an sich selbst.
create or replace function app.guard_dm()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.from_admin then
    new.read_by_admin := true;
    if new.wallet = (select admin_wallet from public.app_config where id = 1) then
      raise exception 'Cannot open a DM thread with yourself';
    end if;
  end if;
  return new;
end;
$$;

create or replace trigger trg_dms_guard
  before insert on public.dms
  for each row execute function app.guard_dm();

-- ----------------------------------------------------------------------------
-- Stimmgewichte folgen dem Bestand
--
-- Wer nach dem Abstimmen Token abgibt, verliert im selben Moment Gewicht. Leert
-- er die Wallet, fällt seine Stimme weg. Damit bringt es nichts mehr, dasselbe
-- Guthaben durch mehrere Wallets zu schicken und mehrfach abzustimmen: Die
-- Vorgänger-Wallet wird beim Nachlesen auf 0 gesetzt.
--
-- Beendete Abstimmungen bleiben unangetastet – ein Ergebnis, das sich
-- nachträglich ändert, wäre kein Ergebnis.
-- ----------------------------------------------------------------------------

create or replace function app.sync_votes_with_balance()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.ui_amount <= 0 then
    delete from public.votes v
     using public.polls p
     where v.poll_id = p.id
       and v.wallet = new.address
       and not p.closed
       and (p.closes_at is null or p.closes_at > now());
  else
    update public.votes v
       set weight_tokens = new.ui_amount,
           weight_usd    = new.usd_value
      from public.polls p
     where v.poll_id = p.id
       and v.wallet = new.address
       and not p.closed
       and (p.closes_at is null or p.closes_at > now())
       and (v.weight_tokens is distinct from new.ui_amount
         or v.weight_usd    is distinct from new.usd_value);
  end if;
  return null;
end;
$$;

drop trigger if exists trg_wallets_sync_votes on public.wallets;
create trigger trg_wallets_sync_votes
  after update of ui_amount, usd_value on public.wallets
  for each row
  when (old.ui_amount is distinct from new.ui_amount
     or old.usd_value is distinct from new.usd_value)
  execute function app.sync_votes_with_balance();

-- ============================================================================
-- Views
-- ============================================================================

-- Ergebnis einer Abstimmung: Zahl der Stimmen und der zusammengezählte $-Wert,
-- den diese Stimmen halten.
create or replace view public.poll_results
with (security_invoker = on) as
select
  v.poll_id,
  v.option_id,
  count(*)::bigint   as votes,
  sum(v.weight_usd)  as usd
from public.votes v
group by v.poll_id, v.option_id;

-- Posteingang für Ansem: ein Eintrag je Wallet, mit aktuellem Bestand.
-- security_invoker = on ⇒ die RLS von `dms` gilt weiter, ein normaler Nutzer
-- sieht hier also nur den eigenen Thread.
-- Erst weg, dann neu. "create or replace view" kann Spalten nur ANHAENGEN,
-- nicht wegnehmen – und eine spaetere Migration erweitert diese Sicht. Beim
-- zweiten Durchlauf der Migrationen (der laufen koennen muss, etwa beim
-- Aufsetzen eines frischen Projekts) traefe diese Zeile sonst auf die breitere
-- Fassung und stiege mit "cannot drop columns from view" aus.
drop view if exists public.dm_threads;
create or replace view public.dm_threads
with (security_invoker = on) as
select
  d.wallet,
  count(*)::bigint                                    as total,
  max(d.created_at)                                   as last_at,
  count(*) filter (where not d.from_admin
                     and not d.read_by_admin)::bigint as unread,
  coalesce(w.ui_amount, 0)                            as tokens,
  coalesce(w.usd_value, 0)                            as usd,
  (array_agg(d.body order by d.id desc))[1]           as preview
from public.dms d
left join public.wallets w on w.address = d.wallet
group by d.wallet, w.ui_amount, w.usd_value;

-- ----------------------------------------------------------------------------
-- Welche Wallets muss der Cron-Job nachlesen?
-- Wallets mit offener Stimme zuerst – dort kostet ein veralteter Bestand
-- Korrektheit, nicht nur Kosmetik.
-- ----------------------------------------------------------------------------

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
  limit max_rows;
$$;

revoke all on function public.wallets_to_refresh(int, int, boolean) from public, anon, authenticated;

-- ============================================================================
-- Row Level Security
-- ============================================================================

alter table public.app_config   enable row level security;
alter table public.wallets      enable row level security;
alter table public.messages     enable row level security;
alter table public.polls        enable row level security;
alter table public.poll_options enable row level security;
alter table public.votes        enable row level security;
alter table public.dms          enable row level security;

-- app_config: öffentlich lesbar (das Frontend braucht Treasury und Symbol
-- schon vor dem Login), schreibbar nur mit Service-Role.
drop policy if exists cfg_read on public.app_config;
create policy cfg_read on public.app_config
  for select to anon, authenticated using (true);

-- wallets: jeder Verifizierte darf Bestände lesen (Anzeige im Chat),
-- schreiben darf nur die Edge Function.
drop policy if exists wallets_read on public.wallets;
create policy wallets_read on public.wallets
  for select to authenticated using (true);

-- challenges / seen_txs: keine Policy ⇒ für anon und authenticated dicht.

-- Chat
drop policy if exists messages_read on public.messages;
create policy messages_read on public.messages
  for select to authenticated using (true);

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert to authenticated
  with check (app.jwt_wallet() is not null and wallet = app.jwt_wallet());

drop policy if exists messages_admin_delete on public.messages;
create policy messages_admin_delete on public.messages
  for delete to authenticated using (app.is_admin());

-- Abstimmungen: lesen alle, anlegen und ändern nur Ansem
drop policy if exists polls_read on public.polls;
create policy polls_read on public.polls
  for select to authenticated using (true);

drop policy if exists polls_admin_write on public.polls;
create policy polls_admin_write on public.polls
  for all to authenticated using (app.is_admin()) with check (app.is_admin());

drop policy if exists options_read on public.poll_options;
create policy options_read on public.poll_options
  for select to authenticated using (true);

drop policy if exists options_admin_write on public.poll_options;
create policy options_admin_write on public.poll_options
  for all to authenticated using (app.is_admin()) with check (app.is_admin());

-- Stimmen sind einsehbar (Nachvollziehbarkeit der Gewichtung),
-- abgeben darf jeder nur für die eigene Wallet.
drop policy if exists votes_read on public.votes;
create policy votes_read on public.votes
  for select to authenticated using (true);

drop policy if exists votes_insert on public.votes;
create policy votes_insert on public.votes
  for insert to authenticated
  with check (app.jwt_wallet() is not null and wallet = app.jwt_wallet());

drop policy if exists votes_update on public.votes;
create policy votes_update on public.votes
  for update to authenticated
  using (wallet = app.jwt_wallet())
  with check (wallet = app.jwt_wallet());

-- DMs: eigener Thread oder Ansem
drop policy if exists dms_read on public.dms;
create policy dms_read on public.dms
  for select to authenticated
  using (wallet = app.jwt_wallet() or app.is_admin());

drop policy if exists dms_insert_user on public.dms;
create policy dms_insert_user on public.dms
  for insert to authenticated
  with check (
    (not from_admin and wallet = app.jwt_wallet() and not app.is_admin())
    or (from_admin and app.is_admin())
  );

drop policy if exists dms_admin_update on public.dms;
create policy dms_admin_update on public.dms
  for update to authenticated
  using (app.is_admin()) with check (app.is_admin());

-- ============================================================================
-- Rechte
-- ============================================================================

grant usage on schema public, app to anon, authenticated;
grant execute on function app.jwt_wallet(), app.is_admin() to anon, authenticated;

grant select on public.app_config to anon, authenticated;
grant select on public.wallets, public.messages, public.polls,
                public.poll_options, public.votes, public.dms,
                public.poll_results, public.dm_threads to authenticated;
grant insert on public.messages, public.votes, public.dms to authenticated;
grant update on public.votes, public.dms to authenticated;
grant delete on public.messages to authenticated;
grant insert, update, delete on public.polls, public.poll_options to authenticated;
grant usage on all sequences in schema public to authenticated;

-- ============================================================================
-- Realtime
-- ============================================================================

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.messages, public.polls, public.poll_options, public.votes, public.dms;
  end if;
exception
  when duplicate_object then null;
end $$;

alter table public.dms   replica identity full;
alter table public.votes replica identity full;
