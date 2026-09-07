-- ============================================================================
-- Eine Abstimmung, die schon laeuft, aendert ihren Wortlaut nicht mehr
-- ============================================================================
--
-- Der Fall, um den es geht: Ansem legt "A oder B?" an, dreissig Wallets
-- stimmen ab, dann bearbeitet er die Frage zu "C oder D?". Die Stimmen bleiben
-- stehen, die Zahlen bleiben stehen – nur beantworten sie jetzt eine andere
-- Frage. Wer fuer A gestimmt hat, steht hinterher unter C.
--
-- Bis hierher war das erlaubt. polls_admin_write gibt Ansem "for all", und das
-- schliesst update auf jede Spalte ein. Das ist die letzte Stelle im Projekt,
-- an der ein Ergebnis nachtraeglich etwas anderes bedeuten kann, als die
-- Abstimmenden gesehen haben.
--
-- ----------------------------------------------------------------------------
-- Warum ein Trigger und keine Policy
--
-- Eine RLS-Policy sieht mit "using" die alte und mit "with check" die neue
-- Zeile, aber sie kann nicht sagen "diese Spalte darf sich nicht aendern, die
-- daneben schon". Genau das ist hier verlangt: closed und closes_at MUESSEN
-- weiter aenderbar bleiben – eine laufende Abstimmung zu schliessen ist der
-- Normalfall, nicht die Ausnahme. Ein Trigger vergleicht old und new pro
-- Spalte und ist die einzige Stelle, an der das genau geht.
--
-- security definer, weil die Funktion zaehlen muss, wie viele Stimmen es
-- WIRKLICH gibt. Ohne sie zaehlt sie nur die, die der Aufrufer laut RLS sehen
-- darf – und eine Sperre, die man dadurch aushebelt, dass man weniger sehen
-- darf, ist keine.
--
-- ----------------------------------------------------------------------------
-- Was gesperrt wird und was nicht
--
--   gesperrt      Frage umschreiben, sobald eine Stimme da ist
--   gesperrt      Antwortmoeglichkeit umbenennen
--   gesperrt      Antwortmoeglichkeit loeschen (nimmt die Stimmen mit)
--   gesperrt      Antwortmoeglichkeit hinzufuegen (die frueher Abstimmenden
--                 haben sie nie gesehen)
--   erlaubt       schliessen, Frist setzen oder verschieben
--   erlaubt       alles davon, solange NIEMAND abgestimmt hat
--   erlaubt       die ganze Abstimmung loeschen und neu anlegen
--
-- Der letzte Punkt ist Absicht und kein Loch: Loeschen nimmt die Stimmen
-- sichtbar mit. Es ist ein neuer Anfang, keine stille Umdeutung, und genau das
-- ist der Unterschied, um den es hier geht.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Hat diese Abstimmung schon Stimmen?
-- ----------------------------------------------------------------------------
-- exists statt count(*): Bei der ersten gefundenen Zeile ist die Frage
-- beantwortet, und die Antwort haengt nicht daran, wie viele es sind.
create or replace function app.abstimmung_laeuft(p_poll_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.votes where poll_id = p_poll_id);
$$;

comment on function app.abstimmung_laeuft(bigint) is
  'True, wenn zu dieser Abstimmung mindestens eine Stimme vorliegt.';


-- ----------------------------------------------------------------------------
-- Die Frage selbst
-- ----------------------------------------------------------------------------
create or replace function app.frage_nach_erster_stimme_fest()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Nur wenn sich der Wortlaut tatsaechlich aendert. Ein update, das die Frage
  -- mitschreibt ohne sie zu aendern (der Normalfall bei "closed = true" aus
  -- einem Formular heraus), soll durchgehen.
  if new.question is distinct from old.question
     and app.abstimmung_laeuft(old.id) then
    raise exception
      'Die Frage kann nicht mehr geaendert werden, es wurde bereits abgestimmt.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_polls_frage_fest on public.polls;
create trigger trg_polls_frage_fest
  before update on public.polls
  for each row execute function app.frage_nach_erster_stimme_fest();


-- ----------------------------------------------------------------------------
-- Die Antwortmoeglichkeiten
-- ----------------------------------------------------------------------------
-- Drei Wege, eine laufende Abstimmung ueber die Optionen umzudeuten, und alle
-- drei brauchen ihren eigenen Trigger, weil update, delete und insert
-- verschiedene Zeilen sehen (old, old, new).

create or replace function app.option_nach_erster_stimme_fest()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.label is distinct from old.label
     and app.abstimmung_laeuft(old.poll_id) then
    raise exception
      'Die Antwortmoeglichkeit kann nicht mehr umbenannt werden, es wurde bereits abgestimmt.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_optionen_label_fest on public.poll_options;
create trigger trg_optionen_label_fest
  before update on public.poll_options
  for each row execute function app.option_nach_erster_stimme_fest();


create or replace function app.option_nicht_wegloeschen()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Wenn die ganze Abstimmung geloescht wird, raeumt der Fremdschluessel die
  -- Optionen mit ab, und dieser Trigger feuert dabei auch. Das soll er nicht
  -- verhindern: Die Abstimmung als Ganzes zu verwerfen ist erlaubt.
  if exists (select 1 from public.polls where id = old.poll_id)
     and app.abstimmung_laeuft(old.poll_id) then
    raise exception
      'Die Antwortmoeglichkeit kann nicht mehr geloescht werden, es wurde bereits abgestimmt.'
      using errcode = 'check_violation';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_optionen_nicht_loeschen on public.poll_options;
create trigger trg_optionen_nicht_loeschen
  before delete on public.poll_options
  for each row execute function app.option_nicht_wegloeschen();


create or replace function app.option_nicht_nachschieben()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if app.abstimmung_laeuft(new.poll_id) then
    raise exception
      'Es kann keine Antwortmoeglichkeit mehr hinzugefuegt werden, es wurde bereits abgestimmt.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_optionen_nicht_nachschieben on public.poll_options;
create trigger trg_optionen_nicht_nachschieben
  before insert on public.poll_options
  for each row execute function app.option_nicht_nachschieben();


comment on trigger trg_polls_frage_fest on public.polls is
  'Sperrt den Wortlaut der Frage, sobald die erste Stimme vorliegt.';
comment on trigger trg_optionen_label_fest on public.poll_options is
  'Sperrt den Wortlaut einer Antwortmoeglichkeit ab der ersten Stimme.';
comment on trigger trg_optionen_nicht_loeschen on public.poll_options is
  'Verhindert das Loeschen einer Antwortmoeglichkeit ab der ersten Stimme.';
comment on trigger trg_optionen_nicht_nachschieben on public.poll_options is
  'Verhindert das Nachschieben einer Antwortmoeglichkeit ab der ersten Stimme.';
