-- ============================================================================
-- Ansem can remove individual conversations from his inbox
--
-- ----------------------------------------------------------------------------
-- What it does, and what it explicitly does NOT
--
-- Hiding affects ONLY Ansem's view. The other side notices nothing: they
-- still see their history, they can still write, and their messages keep
-- getting stored. Only Ansem's list stops showing the conversation.
--
-- That is a decision, not a convenience. Whoever can write here holds a
-- minimum balance to do it - they paid for access. What that buys is the
-- right to WRITE, not a right to a reply. Taking away their ability to write
-- afterward would be a different thing from "I don't read this anymore", and
-- it would be dishonest about what they paid for.
--
-- ----------------------------------------------------------------------------
-- Why hidden stays HIDDEN, even on a new message
--
-- The list is sorted by balance, not by time - so the order never changes by
-- itself. A new message doesn't bump a conversation up or do anything else;
-- it only changes the preview and the unread counter.
--
-- That also makes "hide" different from "archive". There's no stack for
-- something to fall back into. Whoever gets hidden stays gone until Ansem
-- brings them back. That's the point: you hide someone you no longer want to
-- read, not someone you expect to hear from again in two days.
--
-- The cost of that is stated, not hidden: a later, genuine message is one
-- Ansem then also won't see. That's why the list of hidden conversations is
-- reachable in the UI, not just here.
--
-- ----------------------------------------------------------------------------
-- Why a separate table and not a column
--
-- The obvious choice would be a column on dms, or a flag per wallet. Neither
-- works cleanly:
--
--   * On dms it would hang off the MESSAGE, not the conversation. Every new
--     message would have to carry along that it's also hidden - and that's
--     exactly the kind of thing that goes unnoticed the first time someone
--     forgets it.
--   * On wallets it hangs off the balance, not the conversation. That table
--     describes what someone HAS; it's the wrong place for a decision about
--     what Ansem wants to read.
--
-- A dedicated table with one row per hidden conversation says exactly what's
-- meant, and bringing someone back is a plain delete.
--
-- ----------------------------------------------------------------------------
-- Who is allowed to do this
--
-- Only Ansem, on all four paths: read, create, delete. Without the read
-- policy, anyone could look up who Ansem has hidden - that would be a public
-- list of the people he no longer reads.
-- ============================================================================

create table if not exists public.dm_hidden (
  wallet     text primary key,
  created_at timestamptz not null default now()
);

comment on table public.dm_hidden is
  'Gespraeche, die Ansem aus seinem Posteingang genommen hat. Wirkt nur auf '
  'seine Ansicht: Der andere kann weiter schreiben und merkt nichts.';

alter table public.dm_hidden enable row level security;

drop policy if exists dm_hidden_admin_select on public.dm_hidden;
create policy dm_hidden_admin_select on public.dm_hidden
  for select to authenticated using (app.is_admin());

drop policy if exists dm_hidden_admin_insert on public.dm_hidden;
create policy dm_hidden_admin_insert on public.dm_hidden
  for insert to authenticated with check (app.is_admin());

drop policy if exists dm_hidden_admin_delete on public.dm_hidden;
create policy dm_hidden_admin_delete on public.dm_hidden
  for delete to authenticated using (app.is_admin());

grant select, insert, delete on public.dm_hidden to authenticated;

-- ----------------------------------------------------------------------------
-- The view gets a column instead of a filter
--
-- The obvious choice would be to just leave hidden conversations out of
-- dm_threads. But then they'd be gone for Ansem too, and he could no longer
-- bring them back - the UI needs them to show "3 hidden".
--
-- So the view supplies the flag, and whoever filters is the page's call.
-- That's safe here: dm_threads runs with security_invoker, and the row
-- policy on dms lets through only one's own history or - for Ansem -
-- everything anyway. So a regular user still sees exactly one conversation
-- in this view, their own, and its hidden always reads false for them: the
-- subquery runs under THEIR rights, and dm_hidden hands them back no row.
--
-- That's not an accident, it's why the read policy above is more than
-- privacy: it also makes sure no one can tell from their own entry that they
-- were hidden.
-- ----------------------------------------------------------------------------
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
  (array_agg(d.body       order by d.id desc))[1]     as preview,
  (array_agg(d.from_admin order by d.id desc))[1]     as last_from_admin,
  exists (select 1 from public.dm_hidden h
           where h.wallet = d.wallet)                 as hidden
from public.dms d
left join public.wallets w on w.address = d.wallet
group by d.wallet, w.ui_amount, w.usd_value;

comment on view public.dm_threads is
  'Ein Eintrag je Gespraech: Vorschau, Bestand, wer zuletzt geschrieben hat, '
  'und ob Ansem es aus seinem Posteingang genommen hat.';

grant select on public.dm_threads to authenticated;
