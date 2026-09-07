-- ============================================================================
-- Replies to individual messages in DMs
--
-- This already exists in chat. In DMs it's missing at the spot where it
-- helps most: Ansem's inbox. There, a thread can hold twenty questions, and
-- a reply with no reference leaves open which one it's answering.
--
-- As in chat, only the id gets stored, never a copy of the quoted text. A
-- deleted message disappears from the quotes too, then - otherwise it would
-- survive in every reply to it.
-- ============================================================================

alter table public.dms
  add column if not exists reply_to bigint
    references public.dms(id) on delete set null;

comment on column public.dms.reply_to is
  'Kennung der zitierten Nachricht im selben Faden. NULL = keine Antwort.';

create index if not exists dms_reply_to_idx
  on public.dms (reply_to) where reply_to is not null;

-- ----------------------------------------------------------------------------
-- A quote may not leave its thread
-- ----------------------------------------------------------------------------
-- The foreign key only ensures the quoted message exists - not that it
-- belongs to the same conversation. Without this check, someone could enter
-- an id from a thread that isn't theirs.
--
-- Nothing could actually be read out this way: the dms_read RLS rule only
-- ever gives anyone their own thread, so a foreign quote would just come
-- back empty. But it would create rows pointing at something the viewer is
-- never allowed to see, and that's not something to rely on staying safe.
-- Cleaner is for such rows to never exist in the first place.

create or replace function app.guard_dm_reply()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ziel_wallet text;
begin
  if new.reply_to is null then
    return new;
  end if;

  if new.reply_to = new.id then
    raise exception 'A message cannot reply to itself';
  end if;

  select wallet into ziel_wallet from public.dms where id = new.reply_to;

  if ziel_wallet is null or ziel_wallet is distinct from new.wallet then
    raise exception 'You can only reply within the same conversation';
  end if;

  return new;
end;
$$;

-- The name decides the order: BEFORE triggers on the same table fire
-- alphabetically. "trg_dms_reply" sits after "trg_dms_guard" and before
-- "trg_dms_stamp" - for this check the order doesn't matter, since it only
-- compares new.wallet against the quoted row, and both come from the same
-- insert. If a check is ever added here that reads a field set by another
-- trigger: check the order first.
drop trigger if exists trg_dms_reply on public.dms;
create trigger trg_dms_reply
  before insert or update on public.dms
  for each row execute function app.guard_dm_reply();
