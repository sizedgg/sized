-- ============================================================================
-- Replies to messages
--
-- A message can refer to an earlier one. Only the id of the original message
-- is stored, not its text.
--
-- Why no copy of the quoted text is stored alongside it: Ansem can delete
-- messages. If the text sat as a copy in every reply, a deleted insult or
-- scam attempt would still stand as a quote in the room - reachable no
-- longer through the delete function. With a reference, the quote
-- disappears along with the original.
--
-- ON DELETE SET NULL instead of CASCADE: when the original message is
-- deleted, the reply loses its reference but stays standing. Otherwise
-- deleting a single message would drag whole conversation threads down
-- with it.
-- ============================================================================

alter table public.messages
  add column if not exists reply_to bigint
    references public.messages(id) on delete set null;

comment on column public.messages.reply_to is
  'Kennung der Nachricht, auf die geantwortet wird. NULL = keine Antwort.';

-- Without this index, loading the quoted messages would get slower as the
-- table grows.
create index if not exists messages_reply_to_idx
  on public.messages (reply_to)
  where reply_to is not null;

-- ----------------------------------------------------------------------------
-- Replies may not invent a reference
-- ----------------------------------------------------------------------------
-- The foreign key ensures the quoted message exists. But it doesn't catch
-- two things, and both are relevant here:
--
--   * A reply to itself. Technically impossible on insert, because its own
--     id hasn't been assigned yet - but a later update could still do it.
--     Updates aren't allowed to anyone via RLS anyway; the rule is still
--     here so it stays that way if that ever changes.
--   * A reference older than what's even still shown. That's harmless and
--     deliberately allowed.

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
