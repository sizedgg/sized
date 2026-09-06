-- ============================================================================
-- Eine Stimme darf nur ihre ANTWORT ändern – sonst nichts
--
-- ----------------------------------------------------------------------------
-- Die Lücke, die hier zugeht
--
-- votes.weight_usd ist die Zahl, auf der die ganze Abstimmung steht:
-- poll_results summiert genau diese Spalte, und daraus entstehen die Balken im
-- Blatt und die Karte, die nach X geht.
--
-- Geschrieben wurde sie bisher von app.stamp_holdings() – aus `wallets`, nie
-- vom Client. Nur hing der Trigger an
--
--     before insert or update OF option_id on public.votes
--
-- und dasselbe galt für app.guard_vote(). Ein Nutzer hat aber
--
--     grant update on public.votes to authenticated
--
-- auf ALLE Spalten, und die Regel votes_update lässt ihn seine eigene Zeile
-- anfassen. Wer option_id in Ruhe lässt und nur weight_usd schreibt, löst
-- keinen der beiden Trigger aus.
--
-- Nachgemessen gegen ein echtes Postgres 16 mit genau diesen Migrationen, als
-- angemeldeter Nutzer mit gesetztem JWT-Claim:
--
--   Wallet mit 7.739 Token / $32,50 stimmt normal ab   -> weight_usd  32,5000
--   dieselbe Wallet: update votes set weight_usd = 99999999
--                                                      -> weight_usd  99999999
--   poll_results meldet daraufhin                      -> usd         99999999
--
-- Ein einziger PATCH über PostgREST, mit dem öffentlichen anon-Key und der
-- eigenen Sitzung. Kein zweites Wallet, keine Coins, kein Zeitfenster.
--
-- Zwei Nachbarn davon, ebenfalls nachgemessen:
--
--   * Es geht auch bei einer GESCHLOSSENEN Abstimmung. Das Ergebnis, das als
--     endgültig gilt, ließ sich nachträglich umschreiben.
--   * poll_id ließ sich ändern, ohne option_id anzufassen. Die Stimme hing
--     danach an Abstimmung 2 mit einer Antwort, die zu Abstimmung 1 gehört.
--
-- Was NICHT ging, und das ist die Gegenprobe, dass die Regeln im Grundsatz
-- greifen: Eine fremde Wallet konnte die Zeile nicht anfassen – votes_update
-- filtert sie über using (wallet = app.jwt_wallet()) weg.
--
-- ----------------------------------------------------------------------------
-- Warum es sich von selbst nicht heilt
--
-- app.sync_votes_with_balance() schreibt offene Stimmen neu – aber nur, wenn
-- sich der Bestand der Wallet ÄNDERT (after update of ui_amount, usd_value ...
-- when old is distinct from new). Wer nach dem Fälschen nichts mehr bewegt,
-- behält seine Zahl. Bei geschlossenen Abstimmungen greift die Funktion
-- ohnehin nie – dort wäre sie für immer geblieben.
--
-- ----------------------------------------------------------------------------
-- Warum die Sperre so aussieht und nicht anders
--
-- Der erste Gedanke war, die Rechte auf eine Spalte zu verengen:
--
--     revoke update on public.votes from authenticated;
--     grant update (option_id) on public.votes to authenticated;
--
-- Das ist die schärfste Fassung, und sie geht hier trotzdem nicht: Die App
-- stimmt per upsert mit onConflict 'poll_id,wallet' ab. Postgres macht daraus
-- ein "on conflict do update set poll_id = ..., option_id = ..., wallet = ..."
-- und verlangt das Recht auf alle drei Spalten. Mit dem engen Grant könnte
-- niemand mehr seine Stimme ändern.
--
-- Also andersherum: Die Rechte bleiben, und die Datenbank setzt die Regel
-- durch. Das passt auch besser zum Rest – die Zusage lautet nicht "wer den
-- vorgesehenen Weg nimmt, bekommt das richtige Gewicht", sondern "das Gewicht
-- kommt aus `wallets`, egal auf welchem Weg jemand kommt".
--
-- Zwei Teile:
--
--   1. app.stamp_holdings() hängt jetzt an JEDEM update, nicht nur an dem von
--      option_id. Damit wird weight_tokens/weight_usd bei jeder Änderung neu
--      aus `wallets` geholt – ein mitgeschickter Wert wird überschrieben,
--      nicht abgelehnt. Ablehnen wäre hier schlechter: Ein PostgREST-Client
--      schickt beim upsert ganze Zeilen, und der Fehler träfe auch den
--      ehrlichen Fall.
--
--   2. app.guard_vote_update() lehnt ab, was auch neu gestempelt falsch
--      bliebe: eine Zeile, die in eine andere Abstimmung oder auf eine andere
--      Wallet wandert – und JEDE Änderung an einer geschlossenen Abstimmung.
--
-- Der zweite Punkt ist der Grund, warum das Neustempeln allein nicht reicht.
-- Bei einer geschlossenen Abstimmung stünde nach dem Stempeln der HEUTIGE
-- Bestand in der Zeile, nicht der von damals. Aus "das Ergebnis von Freitag"
-- würde "das Ergebnis, wenn man es heute noch einmal rechnet" – leiser als
-- die Fälschung, aber dieselbe Sorte Fehler.
--
-- ----------------------------------------------------------------------------
-- Was NICHT betroffen ist
--
-- app.sync_votes_with_balance() rührt geschlossene Abstimmungen nicht an
-- (and not p.closed and (p.closes_at is null or p.closes_at > now())). Die
-- neue Sperre kann ihr also nicht in die Quere kommen. Bei offenen
-- Abstimmungen schreibt sie genau die Werte, die stamp_holdings gleich
-- darauf noch einmal aus derselben Zeile liest – das Ergebnis ist dasselbe.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Das Gewicht wird bei JEDER Änderung neu gestempelt
-- ----------------------------------------------------------------------------
-- Nur die Reichweite des Triggers ändert sich, die Funktion bleibt, wie sie
-- ist. Sie liest ohnehin schon aus `wallets` und ignoriert, was der Client
-- mitgeschickt hat.
drop trigger if exists trg_votes_stamp on public.votes;
create trigger trg_votes_stamp
  before insert or update on public.votes
  for each row execute function app.stamp_holdings();

-- ----------------------------------------------------------------------------
-- 2. Was auch neu gestempelt falsch bliebe
-- ----------------------------------------------------------------------------
create or replace function app.guard_vote_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.polls%rowtype;
begin
  -- Eine Stimme gehört zu EINER Abstimmung und zu EINER Wallet. Beides steht
  -- beim Abgeben fest. Wandert die Zeile, hängt sie hinterher an einer
  -- Antwort, die zu einer anderen Abstimmung gehört – und der eindeutige
  -- Schlüssel (poll_id, wallet) fängt das nicht, weil er nur Doppelte
  -- verhindert, nicht Umzüge.
  if new.poll_id is distinct from old.poll_id then
    raise exception 'A vote cannot be moved to another poll';
  end if;
  if new.wallet is distinct from old.wallet then
    raise exception 'A vote cannot be moved to another wallet';
  end if;

  -- Eine geschlossene Abstimmung ist geschlossen – auch für ihre Zeilen.
  --
  -- app.guard_vote() sagt dasselbe, aber nur beim Wechsel der Antwort. Hier
  -- geht es um jede Änderung: Ohne diesen Zweig würde stamp_holdings oben
  -- brav den heutigen Bestand eintragen und damit ein abgeschlossenes
  -- Ergebnis nachträglich verschieben.
  select * into p from public.polls where id = old.poll_id;
  if p.closed or (p.closes_at is not null and p.closes_at < now()) then
    raise exception 'This poll is closed';
  end if;

  return new;
end;
$$;

-- Der Name sortiert vor trg_votes_stamp: Bei gleicher Auslösezeit arbeitet
-- Postgres die Trigger in Namensreihenfolge ab, und eine Absage soll kommen,
-- bevor irgendetwas gestempelt wird. Fürs Ergebnis ist es einerlei – die
-- Transaktion bricht so oder so ab –, aber in einem Protokoll liest sich die
-- Reihenfolge sonst verkehrt herum.
drop trigger if exists trg_votes_freeze on public.votes;
create trigger trg_votes_freeze
  before update on public.votes
  for each row execute function app.guard_vote_update();

do $$
begin
  raise notice 'votes: Gewicht wird bei jeder Aenderung neu aus wallets gestempelt; Umhaengen und Aendern geschlossener Abstimmungen sind gesperrt.';
end $$;
