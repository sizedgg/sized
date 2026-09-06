-- ============================================================================
-- Antworten auf einzelne Nachrichten in DMs
--
-- Im Chat gibt es das schon. In den DMs fehlt es an der Stelle, an der es am
-- meisten hilft: Ansems Posteingang. Dort stehen in einem Faden zwanzig
-- Fragen, und eine Antwort ohne Bezug lässt offen, auf welche davon.
--
-- Wie im Chat wird nur die Kennung gespeichert, nie eine Kopie des zitierten
-- Textes. Eine gelöschte Nachricht verschwindet damit auch aus den Zitaten –
-- sonst überlebte sie in jeder Antwort darauf.
-- ============================================================================

alter table public.dms
  add column if not exists reply_to bigint
    references public.dms(id) on delete set null;

comment on column public.dms.reply_to is
  'Kennung der zitierten Nachricht im selben Faden. NULL = keine Antwort.';

create index if not exists dms_reply_to_idx
  on public.dms (reply_to) where reply_to is not null;

-- ----------------------------------------------------------------------------
-- Ein Zitat darf den Faden nicht verlassen
-- ----------------------------------------------------------------------------
-- Der Fremdschlüssel sichert nur, dass die zitierte Nachricht existiert – nicht,
-- dass sie zum selben Gespräch gehört. Ohne diese Prüfung könnte jemand eine
-- Kennung aus einem fremden Faden eintragen.
--
-- Auslesen ließe sich damit nichts: Die RLS-Regel dms_read gibt jedem nur den
-- eigenen Faden, ein fremdes Zitat käme also leer zurück. Aber es entstünden
-- Zeilen, die auf etwas zeigen, das der Betrachter nie sehen darf, und darauf
-- will man sich nicht verlassen müssen. Sauberer ist, dass sie gar nicht erst
-- entstehen.

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

-- Der Name entscheidet die Reihenfolge: BEFORE-Trigger auf derselben Tabelle
-- feuern alphabetisch. "trg_dms_reply" liegt nach "trg_dms_guard" und vor
-- "trg_dms_stamp" – für diese Prüfung ist die Reihenfolge egal, weil sie nur
-- new.wallet gegen die zitierte Zeile hält und beide vom selben Einfügen
-- stammen. Falls hier je eine Prüfung dazukommt, die von einem anderen
-- Trigger gesetzte Felder liest: Reihenfolge zuerst nachsehen.
drop trigger if exists trg_dms_reply on public.dms;
create trigger trg_dms_reply
  before insert or update on public.dms
  for each row execute function app.guard_dm_reply();
