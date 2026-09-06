-- ============================================================================
-- Stimmen werden mitgezählt, nicht bei jedem Abruf neu zusammengezählt
-- ============================================================================
--
-- Das Problem
--
-- public.poll_results war eine Sicht:
--
--   select poll_id, option_id, count(*), sum(weight_usd)
--   from public.votes group by poll_id, option_id
--
-- Ohne where. Jeder Abruf zählte also JEDE jemals abgegebene Stimme zusammen,
-- über alle Abstimmungen, auch längst beendete. Ein vollständiger Durchlauf
-- durch die Stimmentabelle, jedes Mal.
--
-- Und abgerufen wird das jetzt im Takt: Seit die Stimmen nicht mehr zugestellt,
-- sondern nachgefragt werden (STIMMEN_TAKT_MS in public/app.js), holt jeder
-- offene Polls-Tab die Ergebnisse alle 5 Sekunden. Bei 3.000 Zuschauern sind
-- das 600 Abrufe pro Sekunde.
--
-- Gemessen gegen echtes Postgres, 600 Abrufe pro Sekunde:
--
--     3.000 Stimmen ->  1,0 ms je Abruf  ->  0,6 Kerne ausgelastet
--    10.000 Stimmen ->  2,9 ms           ->  1,7 Kerne
--    30.000 Stimmen ->  8,6 ms           ->  5,2 Kerne
--   100.000 Stimmen -> 28,3 ms           -> 17,0 Kerne
--
-- Eine Pro-Instanz hat zwei Kerne, und die machen nebenbei alles andere auch.
-- Die Seite hätte ihre ersten Abstimmungen überlebt und wäre in der ersten
-- Woche zäh geworden – nicht mit einem Knall, sondern schleichend.
--
-- ----------------------------------------------------------------------------
-- Die Lösung
--
-- Die Summe wird beim SCHREIBEN fortgeschrieben statt beim Lesen gebildet.
-- Eine Zeile je Antwortmöglichkeit, per Trigger gepflegt. Der Abruf liest dann
-- ein paar Dutzend Zeilen statt hunderttausend:
--
--   vorher (180.000 Stimmen):  55,3 ms
--   nachher:                    0,03 ms
--
-- Das ist rund 1.800 mal billiger, und es wächst nicht mehr mit der Zahl der
-- Stimmen – nur noch mit der Zahl der Antwortmöglichkeiten, und die liegt bei
-- vier je Abstimmung.
--
-- Der Preis steht auf der Schreibseite: Jede Stimme kostet zusätzlich eine
-- kleine Aktualisierung. Das ist genau der richtige Tausch – eine Stimme wird
-- einmal abgegeben und tausendfach gelesen.
--
-- ----------------------------------------------------------------------------
-- Warum die Sicht public.poll_results bleibt
--
-- Der Browser fragt weiter `from('poll_results').select('*')`. Die Sicht liegt
-- jetzt nur über der Summentabelle statt über den Stimmen. So ändert sich am
-- Client nichts, und wenn hier etwas schiefginge, wäre es eine Wanderung
-- zurück und keine neue Auslieferung von app.js.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Die Tabelle
-- ----------------------------------------------------------------------------

create table if not exists public.poll_totals (
  option_id bigint primary key
              references public.poll_options(id) on delete cascade,
  poll_id   bigint not null
              references public.polls(id) on delete cascade,
  votes     bigint         not null default 0,
  usd       numeric(20, 4) not null default 0
);

create index if not exists idx_poll_totals_poll on public.poll_totals (poll_id);

alter table public.poll_totals enable row level security;

-- Lesbar wie die Stimmen selbst: votes_read steht auf `using (true)`, damit
-- die Gewichtung nachvollziehbar bleibt. Eine Summe daraus darf nicht
-- geheimer sein als die Zeilen, aus denen sie entsteht.
drop policy if exists poll_totals_read on public.poll_totals;
create policy poll_totals_read on public.poll_totals
  for select to authenticated using (true);

-- Kein insert/update/delete für Clients. Geschrieben wird ausschliesslich
-- durch den Trigger unten, und der läuft als security definer.
grant select on public.poll_totals to authenticated;

-- ----------------------------------------------------------------------------
-- 2. Der Trigger, der sie fortschreibt
-- ----------------------------------------------------------------------------
--
-- Er hängt AFTER an public.votes und sieht damit die Werte, die die beiden
-- bestehenden BEFORE-Trigger schon festgelegt haben:
--
--   trg_votes_stamp  (before insert or update) -> setzt weight_usd
--   trg_votes_freeze (before update)           -> verhindert unerlaubte Änderungen
--
-- Reihenfolge ist hier wichtig und stimmt: Wenn dieser Trigger läuft, steht
-- in new.weight_usd bereits der endgültige Wert. Läse er ihn vorher, würde
-- die Summe dauerhaft von den Stimmen abweichen.
--
-- Drei Fälle, und alle drei kommen wirklich vor:
--
--   INSERT  jemand stimmt ab
--   DELETE  app.sync_votes_with_balance() löscht die Stimme, wenn der Bestand
--           auf 0 fällt – wer nichts mehr hält, wiegt nichts mehr
--   UPDATE  zwei Wege: die Stimme wandert auf eine andere Antwort (der Nutzer
--           ändert seine Meinung, onConflict poll_id,wallet), ODER das Gewicht
--           ändert sich, weil sich der Bestand geändert hat
--
-- Der UPDATE-Fall wird als "alte Zeile abziehen, neue Zeile addieren"
-- behandelt. Das deckt beide Wege ab, auch wenn sich beides gleichzeitig
-- ändert, und ist kürzer als eine Fallunterscheidung, die man falsch
-- verzweigen kann.
-- ----------------------------------------------------------------------------

create or replace function app.poll_totals_pflegen()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Alte Zeile abziehen
  if tg_op in ('DELETE', 'UPDATE') then
    update public.poll_totals
       set votes = votes - 1,
           usd   = usd - old.weight_usd
     where option_id = old.option_id;
  end if;

  -- Neue Zeile addieren. `on conflict` legt die Summenzeile beim ersten
  -- Zugriff an, statt sie beim Anlegen der Abstimmung mit erzeugen zu müssen –
  -- so kann keine Antwortmöglichkeit ohne Summenzeile entstehen.
  if tg_op in ('INSERT', 'UPDATE') then
    insert into public.poll_totals (option_id, poll_id, votes, usd)
    values (new.option_id, new.poll_id, 1, new.weight_usd)
    on conflict (option_id) do update
      set votes = public.poll_totals.votes + 1,
          usd   = public.poll_totals.usd + excluded.usd;
  end if;

  return null; -- AFTER-Trigger: der Rückgabewert wird ohnehin verworfen
end;
$$;

drop trigger if exists trg_votes_totals on public.votes;
create trigger trg_votes_totals
  after insert or update or delete on public.votes
  for each row execute function app.poll_totals_pflegen();

-- ----------------------------------------------------------------------------
-- 3. Neu aufbauen – für die Erstbefüllung und für den Notfall
-- ----------------------------------------------------------------------------
--
-- Eine fortgeschriebene Summe kann grundsätzlich auseinanderlaufen; eine neu
-- gebildete nicht. Deshalb gibt es hier den Weg zurück zur Wahrheit, und der
-- Test scripts/test-schema.mjs vergleicht nach jeder Operation beides
-- gegeneinander.
-- ----------------------------------------------------------------------------

create or replace function app.poll_totals_neu_aufbauen()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.poll_totals;
  insert into public.poll_totals (option_id, poll_id, votes, usd)
  select v.option_id, v.poll_id, count(*), sum(v.weight_usd)
    from public.votes v
   group by v.option_id, v.poll_id;
end;
$$;

select app.poll_totals_neu_aufbauen();

-- ----------------------------------------------------------------------------
-- 4. Die Sicht zeigt jetzt auf die Summentabelle
-- ----------------------------------------------------------------------------
--
-- Erst weg, dann neu: "create or replace view" kann den Unterbau nicht
-- austauschen. Der Umweg über drop ist der einzige Weg.
--
-- Das `usd::numeric` ist KEIN Schönheitsfehler, sondern nötig, und die Stelle
-- kostet sonst eine halbe Stunde Suchen:
--
-- Die Wanderungen müssen ein zweites Mal durchlaufen können – etwa beim
-- Aufsetzen eines frischen Projekts oder in scripts/test-schema.mjs. Beim
-- zweiten Durchlauf trifft die alte Zeile in 20260823020000_init.sql
-- ("create or replace view public.poll_results ... sum(v.weight_usd)") auf
-- diese Sicht hier. sum() über numeric(20,4) liefert numeric OHNE Längenangabe;
-- die Spalte in der Summentabelle hat aber numeric(20,4). Postgres steigt dann
-- aus mit:
--
--   cannot change data type of view column "usd" from numeric(20,4) to numeric
--
-- Der Cast macht die Spalte hier typgleich mit dem, was init erwartet. Danach
-- ersetzt init die Sicht beim Neulauf kurz durch die langsame Fassung, und
-- diese Wanderung setzt sie unmittelbar darauf wieder auf die Summentabelle –
-- die Reihenfolge nach Dateinamen sorgt dafür.
--
-- security_invoker bleibt an: Die Rechte des Aufrufers gelten, also greift
-- poll_totals_read oben. Ohne diese Zeile liefe die Sicht mit den Rechten
-- ihres Eigentümers und umginge RLS.
-- ----------------------------------------------------------------------------

drop view if exists public.poll_results;
create view public.poll_results
with (security_invoker = on) as
select poll_id, option_id, votes::bigint as votes, usd::numeric as usd
  from public.poll_totals;

grant select on public.poll_results to authenticated;
