-- ============================================================================
-- Antworten auf Nachrichten
--
-- Eine Nachricht kann sich auf eine frühere beziehen. Gespeichert wird nur die
-- Kennung der Ursprungsnachricht, nicht deren Text.
--
-- Warum kein Abbild des zitierten Textes mitgespeichert wird: Ansem kann
-- Nachrichten löschen. Läge der Text als Kopie in jeder Antwort, bliebe eine
-- gelöschte Beleidigung oder ein Betrugsversuch als Zitat in der Runde stehen –
-- und wäre über die Löschfunktion nicht mehr erreichbar. Mit einem Verweis
-- verschwindet das Zitat mit dem Original.
--
-- ON DELETE SET NULL statt CASCADE: Wird die Ursprungsnachricht gelöscht,
-- verliert die Antwort ihren Bezug, bleibt aber stehen. Sonst würde das Löschen
-- einer einzigen Nachricht ganze Gesprächsstränge mitreißen.
-- ============================================================================

alter table public.messages
  add column if not exists reply_to bigint
    references public.messages(id) on delete set null;

comment on column public.messages.reply_to is
  'Kennung der Nachricht, auf die geantwortet wird. NULL = keine Antwort.';

-- Ohne diesen Index würde das Nachladen der zitierten Nachrichten mit der
-- Größe der Tabelle langsamer werden.
create index if not exists messages_reply_to_idx
  on public.messages (reply_to)
  where reply_to is not null;

-- ----------------------------------------------------------------------------
-- Antworten dürfen keinen Bezug erfinden
-- ----------------------------------------------------------------------------
-- Der Fremdschlüssel stellt sicher, dass die zitierte Nachricht existiert.
-- Zwei Dinge fängt er aber nicht ab, und beide sind hier relevant:
--
--   * Eine Antwort auf sich selbst. Technisch unmöglich beim Einfügen, weil
--     die eigene Kennung noch nicht vergeben ist – aber ein späteres Update
--     könnte es. Updates sind per RLS ohnehin niemandem erlaubt; die Regel
--     steht trotzdem hier, damit sie es auch bleibt, falls das je aufgeht.
--   * Ein Bezug, der älter ist als das, was überhaupt noch angezeigt wird.
--     Das ist harmlos und wird bewusst zugelassen.

create or replace function app.guard_reply()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.reply_to is not null and new.reply_to = new.id then
    raise exception 'A message cannot reply to itself';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_messages_reply on public.messages;
create trigger trg_messages_reply
  before insert or update on public.messages
  for each row execute function app.guard_reply();
