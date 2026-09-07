-- ============================================================================
-- Fünf Stellen härten, bevor die Seite aufmacht
-- ============================================================================
--
-- Vier Löcher und ein Aufräumen. Keines davon hat eine der 22 Testreihen
-- gefunden, und das ist der eigentliche Befund: Sie prüfen, ob die Regeln
-- tun, was sie sollen. Hier ging es um Regeln, die es gar nicht gab.
--
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. created_at gehört der Datenbank, nicht dem Client
-- ----------------------------------------------------------------------------
--
-- messages.created_at, dms.created_at und votes.created_at haben einen Default
-- auf now(). Ein Default gilt aber nur, wenn der Client die Spalte WEGLÄSST.
-- Schickt er sie mit, wird sie genommen – und das darf er, weil
--
--   grant insert on public.messages, public.votes, public.dms to authenticated
--
-- spaltenlos ist und PostgREST jede Spalte annimmt, für die ein Recht besteht.
--
-- Beide Sperren gegen Spam zählen nach Zeit:
--
--   where wallet = ... and created_at > now() - interval '1 minute'
--
-- Wer also created_at: '1990-01-01' mitschickt, ist in keinem Fenster. Fünf
-- Nachrichten je Minute und dreissig je Stunde gelten dann für alle ausser
-- für den, der es darauf anlegt. Genau falschherum.
--
-- Der Trigger überschreibt stumpf. Nicht "wenn null, dann now()" – dann könnte
-- man ihn ja weiter umgehen, indem man einen Wert schickt.
--
-- BEFORE INSERT und nicht BEFORE UPDATE: Ein späteres Ändern von created_at
-- gibt es nicht, weil keine Policy ein UPDATE auf diese Spalten erlaubt.
create or replace function app.stempel_created_at()
returns trigger
language plpgsql
as $$
begin
  new.created_at := now();
  return new;
end;
$$;

comment on function app.stempel_created_at() is
  'Setzt created_at auf die Serverzeit. Ohne das ist jede zeitbasierte '
  'Zählung wirkungslos, weil PostgREST die Spalte vom Client annimmt.';

drop trigger if exists trg_messages_created_at on public.messages;
create trigger trg_messages_created_at
  before insert on public.messages
  for each row execute function app.stempel_created_at();

drop trigger if exists trg_dms_created_at on public.dms;
create trigger trg_dms_created_at
  before insert on public.dms
  for each row execute function app.stempel_created_at();

drop trigger if exists trg_votes_created_at on public.votes;
create trigger trg_votes_created_at
  before insert on public.votes
  for each row execute function app.stempel_created_at();


-- ----------------------------------------------------------------------------
-- 2. Abgelaufene Challenges dürfen ihren Betrag nicht ewig belegen
-- ----------------------------------------------------------------------------
--
-- Der Index stand auf
--
--   unique (wallet, lamports) where status = 'pending'
--
-- ohne Rücksicht auf expires_at. Und expire_stale_challenges() gibt es zwar,
-- aber kein Cron-Job ruft sie auf – abgelaufene Challenges bleiben also auf
-- 'pending' stehen und halten ihren Betrag für immer.
--
-- Seit die Beträge sechs statt neun Nachkommastellen haben, gibt es je Wallet
-- genau 999 mögliche Aufschläge, und createChallenge gibt nach 20 Würfen auf.
--
-- Das Angriffsbild: Jemand öffnet fortlaufend Challenges auf eine FREMDE
-- Adresse – drei gleichzeitig sind erlaubt, nach 25 Minuten laufen sie ab und
-- bleiben liegen. Nach rund 333 Runden, also gut sechs Tagen ohne jedes
-- Zutun, sind alle 999 Beträge dieser Adresse belegt. Der rechtmässige
-- Besitzer bekommt dann nur noch "No free verification amount right now",
-- dauerhaft, weil nichts aufräumt.
--
-- Auf admin_wallet angewandt heisst das: Ansem kommt nicht mehr herein.
--
-- Der Index bekommt deshalb die Ablaufzeit dazu. Das ist besser als ein
-- vierter Cron-Job: Ein Job kann ausfallen, eine Indexbedingung nicht.
--
-- Teilindex mit now(): Postgres verlangt für die WHERE-Bedingung eines Index
-- eigentlich unveränderliche Ausdrücke. now() ist stable, nicht immutable –
-- deshalb geht der Weg über die Spalte selbst nicht. Stattdessen bleibt der
-- Index wie er ist, und die Bedingung wandert in den Trigger, der ohnehin
-- schon zählt: Beim Einfügen werden die abgelaufenen Zeilen dieser Wallet
-- zuerst weggeräumt.
create or replace function app.raeume_abgelaufene_challenges()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Nur die eigene Wallet, nicht die ganze Tabelle: Das hält den Schreibzugriff
  -- klein und macht aus dem Aufräumen keine Sperre für alle anderen.
  update public.challenges
     set status = 'expired'
   where wallet = new.wallet
     and status = 'pending'
     and expires_at <= now();
  return new;
end;
$$;

comment on function app.raeume_abgelaufene_challenges() is
  'Setzt abgelaufene offene Challenges derselben Wallet auf expired, bevor '
  'eine neue entsteht. Ohne das belegen sie ihren Betrag dauerhaft und eine '
  'Adresse laesst sich fremdaussperren.';

-- Vor dem Zähl-Trigger, damit der die aufgeräumten Zeilen nicht mehr
-- mitzählt. Postgres führt gleichartige Trigger alphabetisch aus, deshalb der
-- Name mit "a_" vorn.
drop trigger if exists trg_a_challenges_aufraeumen on public.challenges;
create trigger trg_a_challenges_aufraeumen
  before insert on public.challenges
  for each row execute function app.raeume_abgelaufene_challenges();


-- ----------------------------------------------------------------------------
-- 3. Lesen setzt einen Zahlungsnachweis voraus, nicht bloss ein Token
-- ----------------------------------------------------------------------------
--
-- Sechs Policies standen auf
--
--   for select to authenticated using (true)
--
-- Geprüft wurde damit nur, dass IRGENDEIN von Supabase akzeptiertes Token
-- vorliegt – nicht, dass es aus verify stammt.
--
-- Das ist gefährlich, weil Supabase eigene Anmeldewege mitbringt. Ist im
-- Dashboard "Anonymous sign-ins" oder E-Mail-Signup aktiv, holt sich jemand
-- mit zwei Zeilen supabase-js ein Token mit role: authenticated, ohne
-- wallet-Claim und ohne einen Cent gezahlt zu haben – und liest damit die
-- komplette Wallet-Tabelle samt aller Bestände.
--
-- Die Auth-Provider gehören abgeschaltet, das steht in der Startliste. Aber
-- eine Bezahlschranke, die an einem Häkchen im Dashboard hängt, ist keine.
-- Deshalb hier zusätzlich die Bedingung, die nur ein Token aus verify erfüllt.
--
-- Die DMs waren nie betroffen, die prüfen seit jeher wallet = jwt_wallet().
drop policy if exists wallets_read on public.wallets;
create policy wallets_read on public.wallets
  for select to authenticated using (app.jwt_wallet() is not null);

drop policy if exists messages_read on public.messages;
create policy messages_read on public.messages
  for select to authenticated using (app.jwt_wallet() is not null);

drop policy if exists polls_read on public.polls;
create policy polls_read on public.polls
  for select to authenticated using (app.jwt_wallet() is not null);

drop policy if exists options_read on public.poll_options;
create policy options_read on public.poll_options
  for select to authenticated using (app.jwt_wallet() is not null);

drop policy if exists votes_read on public.votes;
create policy votes_read on public.votes
  for select to authenticated using (app.jwt_wallet() is not null);

drop policy if exists poll_totals_read on public.poll_totals;
create policy poll_totals_read on public.poll_totals
  for select to authenticated using (app.jwt_wallet() is not null);


-- ----------------------------------------------------------------------------
-- 4. Der Chat ist raus – die Schreibrechte gehen mit
-- ----------------------------------------------------------------------------
--
-- Die Tabelle messages bleibt stehen, samt Regeln und Inhalt: Der Schritt ist
-- umkehrbar, und test-schema.mjs prüft sie weiter. Was nicht stehen bleiben
-- darf, sind die Rechte.
--
-- Bisher konnte jeder Verifizierte mit 10 Dollar Bestand unbegrenzt in eine
-- Tabelle schreiben, die niemand mehr ansieht – und jede Zeile ging zusätzlich
-- als Realtime-Ereignis an jeden, der den Kanal abonniert. Ein Angreifer kann
-- ihn selbst abonnieren und macht so aus einem Insert beliebig viele
-- Zustellungen. Kostet Speicher, Egress und Kontingent, sichtbar wird es
-- nirgends.
--
-- Anders als votes und dms wurde messages nie aus der Realtime-Veröffentlichung
-- genommen. Das holen wir hier nach.
revoke insert, delete on public.messages from authenticated;

drop policy if exists messages_insert on public.messages;
drop policy if exists messages_admin_delete on public.messages;

do $$
begin
  alter publication supabase_realtime drop table public.messages;
exception
  when undefined_object then null;   -- war nie drin
  when others then null;             -- Publikation gehört uns nicht (lokal)
end $$;


-- ----------------------------------------------------------------------------
-- 5. read_by_admin gehört dem Server
-- ----------------------------------------------------------------------------
--
-- guard_dm setzt read_by_admin nur für Zeilen von Ansem. Für Nutzerzeilen
-- blieb das Feld ungeprüft, und die Insert-Policy schränkt es nicht ein: Ein
-- Nutzer konnte seine eigene DM mit read_by_admin: true einliefern. Sie steht
-- dann im Verlauf, taucht aber im Ungelesen-Zähler nie auf.
--
-- Kein Datenabfluss – aber ein Zähler, dem man nicht trauen kann, ist
-- schlimmer als keiner. Ansem entscheidet danach, wem er antwortet.
create or replace function app.stempel_read_by_admin()
returns trigger
language plpgsql
as $$
begin
  -- Von Ansem geschrieben heisst gelesen; von einem Nutzer geschrieben heisst
  -- ungelesen. Beides entscheidet der Server, nicht der Absender.
  new.read_by_admin := coalesce(new.from_admin, false);
  return new;
end;
$$;

comment on function app.stempel_read_by_admin() is
  'read_by_admin folgt aus from_admin und wird nie vom Client uebernommen.';

drop trigger if exists trg_dms_read_by_admin on public.dms;
create trigger trg_dms_read_by_admin
  before insert on public.dms
  for each row execute function app.stempel_read_by_admin();
